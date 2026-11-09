import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionStore } from "../../../../auth/session";
import { RealtimeConnectionManager } from "../RealtimeConnectionManager";
import type {
  MockRealtimeConnectOptions,
  NoteRealtimeEvent,
  PresenceAnnouncement,
  RealtimeChannel,
} from "../realtimeTypes";
import { EDITING_IDLE_MS, useNotePresence } from "../useNotePresence";
import {
  CLOSE_UNAUTHENTICATED,
  REPEAT_INTERVAL_MS,
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
    expect(REPEAT_INTERVAL_MS).toBeLessThan(30_000);
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
    presence: (PresenceAnnouncement | null)[];
  }[] = [];

  connect(options: MockRealtimeConnectOptions) {
    const record = {
      options,
      noteIds: [] as string[][],
      presence: [] as (PresenceAnnouncement | null)[],
    };
    this.connections.push(record);
    return {
      id: `connection-${this.connections.length}`,
      updateNoteIds(noteIds: readonly string[]) {
        record.noteIds.push([...noteIds]);
      },
      setPresence(presence: PresenceAnnouncement | null) {
        record.presence.push(presence);
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

describe("presence on the live connection", () => {
  async function ready() {
    const setup_ = setup(["token-1"]);
    const connection = setup_.channel.connect(setup_.options);
    const [socket] = setup_.sockets;
    return { ...setup_, connection, socket };
  }

  function presenceMessages(socket: FakeSocket) {
    return socket.sent.filter((message) => message.type === "presence");
  }

  it("announces the open note once ready, and repeats it", async () => {
    const { connection, socket, tick } = await ready();

    // Before the server is ready, it waits.
    connection.setPresence?.({ noteId: "note-1", activity: "VIEWING" });
    socket.open();
    await flush();
    expect(presenceMessages(socket)).toEqual([]);

    socket.receive({ type: "ready", userId: "reviewer-1", latestCursor: 0 });
    tick();
    await flush();

    expect(presenceMessages(socket)).toEqual([
      { type: "presence", noteId: "note-1", activity: "VIEWING" },
      { type: "presence", noteId: "note-1", activity: "VIEWING" },
    ]);
    expect(REPEAT_INTERVAL_MS).toBeLessThanOrEqual(15_000);
  });

  it("sends changes, and closing the note once", async () => {
    const { connection, socket, tick } = await ready();
    socket.open();
    await flush();
    socket.receive({ type: "ready", userId: "reviewer-1", latestCursor: 0 });

    connection.setPresence?.(null); // nothing was open: nothing to say
    connection.setPresence?.({ noteId: "note-1", activity: "EDITING" });
    connection.setPresence?.(null);
    tick(); // nothing open: no repeat

    expect(presenceMessages(socket)).toEqual([
      { type: "presence", noteId: "note-1", activity: "EDITING" },
      { type: "presence", noteId: null },
    ]);
  });

  it("announces again on every new connection", () => {
    const channel = new ServerLikeChannel();
    const { manager, runTimer } = managerWith(channel);
    manager.subscribe(["note-1"], vi.fn());

    manager.setPresence({ noteId: "note-1", activity: "VIEWING" });
    channel.last.onDisconnect(new Error("network"));
    runTimer();

    expect(channel.connections.map((record) => record.presence)).toEqual([
      [{ noteId: "note-1", activity: "VIEWING" }],
      [{ noteId: "note-1", activity: "VIEWING" }],
    ]);
  });
});

describe("useNotePresence", () => {
  function fakeManager() {
    const calls: (PresenceAnnouncement | null)[] = [];
    return {
      calls,
      manager: {
        setPresence: (presence: PresenceAnnouncement | null) => {
          calls.push(presence);
        },
      } as unknown as RealtimeConnectionManager,
    };
  }

  it("views on open, edits while typing, views again when idle", () => {
    vi.useFakeTimers();
    try {
      const { calls, manager } = fakeManager();
      const { result, unmount } = renderHook(() =>
        useNotePresence("note-1", manager),
      );

      act(() => {
        result.current();
        result.current(); // still editing: nothing new
      });
      act(() => {
        vi.advanceTimersByTime(EDITING_IDLE_MS);
      });
      unmount();

      expect(calls).toEqual([
        { noteId: "note-1", activity: "VIEWING" },
        { noteId: "note-1", activity: "EDITING" },
        { noteId: "note-1", activity: "VIEWING" },
        null,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

