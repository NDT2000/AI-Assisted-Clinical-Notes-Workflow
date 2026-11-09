import { describe, expect, it, vi } from "vitest";

import { SessionStore } from "../../../../auth/session";
import { createAppRealtimeChannel } from "../appRealtimeChannel";
import { RealtimeConnectionManager } from "../RealtimeConnectionManager";
import type {
  MockRealtimeConnectOptions,
  NoteRealtimeEvent,
  RealtimeChannel,
} from "../realtimeTypes";
import {
  CLOSE_UNAUTHENTICATED,
  TOKEN_CHECK_INTERVAL_MS,
  WebSocketRealtimeChannel,
  realtimeUrl,
  type WebSocketLike,
} from "../webSocketRealtimeChannel";

class FakeSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  serverCloses(code: number): void {
    this.onclose?.({ code, reason: "" } as CloseEvent);
  }
}

function event(cursor: number, noteId = "note-1"): NoteRealtimeEvent {
  return {
    type: "note.presence_changed",
    eventId: `event-${cursor}`,
    cursor,
    noteId,
    occurredAt: "2026-11-09T12:00:00.000Z",
    presence: [],
  };
}

function setup(tokens: (string | null)[] = ["token-1"]) {
  const session = new SessionStore({ useMockTokens: false });
  session.signInForTests({
    id: "reviewer-1",
    displayName: "Alex Kim",
    role: "REVIEWER",
  });
  const getToken = vi.spyOn(session, "getAccessToken");
  for (const token of tokens) {
    getToken.mockResolvedValueOnce(token);
  }
  getToken.mockResolvedValue(tokens.at(-1) ?? null);
  const renew = vi
    .spyOn(session, "renewAfterRejection")
    .mockResolvedValue("token-renewed");

  const sockets: FakeSocket[] = [];
  let tick: (() => void) | null = null;
  const channel = new WebSocketRealtimeChannel({
    session,
    url: () => "ws://test/api/realtime",
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
  });

  const options = {
    noteIds: ["note-1"],
    afterCursor: 0,
    onEvent: vi.fn(),
    onDisconnect: vi.fn(),
    resolveAfterCursor: vi.fn((latest: number) => latest),
    onCaughtUp: vi.fn(),
    onResetRequired: vi.fn(),
  };

  return {
    channel,
    options,
    sockets,
    renew,
    tick: () => tick?.(),
    hasTimer: () => tick !== null,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("WebSocketRealtimeChannel", () => {
  it("sends the token first, then follows the notes from the log position", async () => {
    const { channel, options, sockets } = setup();

    channel.connect(options);
    const [socket] = sockets;
    expect(socket.url).toBe("ws://test/api/realtime");
    socket.open();
    await flush();

    expect(socket.sent).toEqual([{ type: "auth", token: "token-1" }]);

    socket.receive({ type: "ready", userId: "reviewer-1", latestCursor: 41 });

    expect(options.resolveAfterCursor).toHaveBeenCalledWith(41);
    expect(socket.sent[1]).toEqual({
      type: "subscribe",
      noteIds: ["note-1"],
      afterCursor: 41,
    });
  });

  it("passes on events, caught up and reset", async () => {
    const { channel, options, sockets } = setup();
    channel.connect(options);
    const [socket] = sockets;
    socket.open();
    await flush();
    socket.receive({ type: "ready", userId: "reviewer-1", latestCursor: 0 });

    socket.receive({ type: "event", event: event(5) });
    socket.receive({ type: "ping" });
    socket.receive({ type: "caughtUp", cursor: 5 });
    socket.receive({ type: "resetRequired", noteIds: ["note-1"] });
    socket.onmessage?.({ data: "not json" } as MessageEvent<string>);

    expect(options.onEvent).toHaveBeenCalledWith(event(5));
    expect(options.onCaughtUp).toHaveBeenCalledWith(5);
    expect(options.onResetRequired).toHaveBeenCalledWith(["note-1"]);
  });

  it("re-subscribes on the open connection when the notes change", async () => {
    const { channel, options, sockets } = setup();
    const connection = channel.connect(options);
    const [socket] = sockets;

    // Before ready, there is nothing to change yet.
    connection.updateNoteIds(["note-2"]);
    socket.open();
    await flush();
    socket.receive({ type: "ready", userId: "reviewer-1", latestCursor: 7 });
    connection.updateNoteIds(["note-2", "note-3"]);

    expect(sockets).toHaveLength(1);
    expect(socket.sent.at(-1)).toEqual({
      type: "subscribe",
      noteIds: ["note-2", "note-3"],
      afterCursor: 7,
    });
  });

  it("sends a renewed token on the same connection", async () => {
    const { channel, options, sockets, tick } = setup([
      "token-1",
      "token-1",
      "token-2",
    ]);
    channel.connect(options);
    const [socket] = sockets;
    socket.open();
    await flush();
    socket.receive({ type: "ready", userId: "reviewer-1", latestCursor: 0 });

    tick(); // the same token: nothing to send
    await flush();
    tick(); // renewed
    await flush();

    const auths = socket.sent.filter((message) => message.type === "auth");
    expect(auths).toEqual([
      { type: "auth", token: "token-1" },
      { type: "auth", token: "token-2" },
    ]);
    expect(TOKEN_CHECK_INTERVAL_MS).toBeLessThan(30_000);
  });

  it("renews the token and reports the drop when the server says it expired", async () => {
    const { channel, options, sockets, renew, hasTimer } = setup();
    channel.connect(options);
    const [socket] = sockets;
    socket.open();
    await flush();
    socket.receive({ type: "ready", userId: "reviewer-1", latestCursor: 0 });

    socket.serverCloses(CLOSE_UNAUTHENTICATED);

    expect(renew).toHaveBeenCalledTimes(1);
    expect(options.onDisconnect).toHaveBeenCalledTimes(1);
    expect(options.onDisconnect.mock.calls[0][0].message).toContain(
      "new sign-in token",
    );
    expect(hasTimer()).toBe(false);
  });

  it("gives up without a session", async () => {
    const { channel, options, sockets } = setup([null]);
    channel.connect(options);
    sockets[0].open();
    await flush();

    expect(sockets[0].closedWith).toBe(1000);
    expect(options.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("closes quietly when the app disconnects", async () => {
    const { channel, options, sockets } = setup();
    const connection = channel.connect(options);
    sockets[0].open();
    await flush();

    connection.disconnect();
    sockets[0].serverCloses(1000);

    expect(sockets[0].closedWith).toBe(1000);
    expect(options.onDisconnect).not.toHaveBeenCalled();
  });

  it("builds the address from the page's own origin", () => {
    expect(realtimeUrl()).toBe(
      `${window.location.origin.replace(/^http/, "ws")}/api/realtime`,
    );
  });
});

// --- The manager with a server-like channel ---------------------------------

class ServerLikeChannel implements RealtimeChannel {
  readonly updatesNoteIdsInPlace = true;
  readonly reportsCaughtUp = true;
  connections: {
    options: MockRealtimeConnectOptions;
    noteIds: readonly string[][];
  }[] = [];

  connect(options: MockRealtimeConnectOptions) {
    const record = { options, noteIds: [] as string[][] };
    this.connections.push(record);
    return {
      id: `connection-${this.connections.length}`,
      updateNoteIds(noteIds: readonly string[]) {
        record.noteIds.push([...noteIds]);
      },
      disconnect() {},
    };
  }

  get last() {
    return this.connections[this.connections.length - 1].options;
  }
}

function managerWith(channel: RealtimeChannel) {
  const timers: (() => void)[] = [];
  const manager = new RealtimeConnectionManager({
    channel,
    timers: {
      setTimeout: (callback) => {
        timers.push(callback);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => undefined,
      random: () => 0,
    },
  });
  return { manager, runTimer: () => timers.shift()?.() };
}

describe("RealtimeConnectionManager with the server's channel", () => {
  it("starts new notes from the log position, not from the beginning", () => {
    const channel = new ServerLikeChannel();
    const { manager } = managerWith(channel);
    manager.subscribe(["note-1"], vi.fn());

    expect(channel.last.resolveAfterCursor?.(120)).toBe(120);
  });

  it("changes the followed notes without reconnecting", () => {
    const channel = new ServerLikeChannel();
    const { manager } = managerWith(channel);
    const subscription = manager.subscribe(["note-1"], vi.fn());

    subscription.updateNoteIds(["note-1", "note-2"]);

    expect(channel.connections).toHaveLength(1);
    expect(channel.connections[0].noteIds).toEqual([["note-1", "note-2"]]);
  });

  it("marks events missed after a drop, until caught up", () => {
    const channel = new ServerLikeChannel();
    const { manager, runTimer } = managerWith(channel);
    const onEvent = vi.fn();
    manager.subscribe(["note-1"], onEvent);
    channel.last.resolveAfterCursor?.(10);

    channel.last.onEvent(event(11));
    channel.last.onDisconnect(new Error("network"));
    runTimer();

    // The reconnection catches up from the last event seen.
    expect(channel.last.resolveAfterCursor?.(20)).toBe(11);
    channel.last.onEvent(event(12));
    channel.last.onCaughtUp?.(12);
    channel.last.onEvent(event(13));

    expect(onEvent.mock.calls.map(([sent, meta]) => [sent.cursor, meta.missed]))
      .toEqual([
        [11, false],
        [12, true],
        [13, false],
      ]);
  });

  it("tells the notes' subscribers to reload when too much changed", () => {
    const channel = new ServerLikeChannel();
    const { manager } = managerWith(channel);
    const onReset = vi.fn();
    const otherReset = vi.fn();
    manager.subscribe(["note-1"], vi.fn(), onReset);
    manager.subscribe(["note-2"], vi.fn(), otherReset);

    channel.last.onResetRequired?.(["note-1"]);

    expect(onReset).toHaveBeenCalledWith(["note-1"]);
    expect(otherReset).not.toHaveBeenCalled();
  });
});

describe("createAppRealtimeChannel", () => {
  it("takes note changes from the server and only presence from the tabs", () => {
    const server = new ServerLikeChannel();
    const local = new ServerLikeChannel();
    const channel = createAppRealtimeChannel(server, local);
    const onEvent = vi.fn();

    const connection = channel.connect({
      noteIds: ["note-1"],
      afterCursor: 0,
      onEvent,
      onDisconnect: vi.fn(),
    });
    local.last.onEvent(event(99));
    local.last.onEvent({
      ...event(98),
      type: "note.version_added",
    } as unknown as NoteRealtimeEvent);
    connection.updateNoteIds(["note-2"]);

    expect(channel.updatesNoteIdsInPlace).toBe(true);
    // Presence never moves the server cursor.
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].cursor).toBe(0);
    expect(server.connections[0].noteIds).toEqual([["note-2"]]);
    expect(local.connections[0].noteIds).toEqual([["note-2"]]);
  });
});
