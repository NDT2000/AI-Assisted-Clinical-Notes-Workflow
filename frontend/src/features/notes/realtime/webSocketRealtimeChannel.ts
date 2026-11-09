import { API_BASE_URL } from "../../../api/apiConfig";
import {
  session as defaultSession,
  type SessionStore,
} from "../../../auth/session";
import type {
  MockRealtimeConnectOptions,
  MockRealtimeConnection,
  NoteRealtimeEvent,
  PresenceAnnouncement,
  RealtimeChannel,
} from "./realtimeTypes";

/*
 * Note events from the server's live connection (/api/realtime).
 *
 * The access token is the first message, never part of the URL, and a
 * renewed token is sent on the same connection before the old one runs
 * out. Changing the followed notes re-subscribes on the open connection.
 * The open note's presence is announced on it too, and repeated so the
 * server knows the tab is still there.
 * The protocol is described in backend/src/clinical_notes_api/realtime/
 * router.py.
 */

// How often the token is checked and presence repeated. Shorter than the
// session's 30-second renewal margin, so a renewed token reaches the
// server before the previous one expires; and half the server's 30-second
// presence time to live, so one late repeat does not drop the user.
export const REPEAT_INTERVAL_MS = 15_000;

// Close codes the server uses.
export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_FORBIDDEN = 4403;

export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketRealtimeChannelOptions {
  url?: () => string;
  session?: SessionStore;
  createSocket?: (url: string) => WebSocketLike;
  setInterval?: (callback: () => void, delayMs: number) => unknown;
  clearInterval?: (timer: unknown) => void;
}

type ServerMessage =
  | { type: "ready"; userId: string; latestCursor: number }
  | { type: "event"; event: NoteRealtimeEvent }
  | { type: "caughtUp"; cursor: number }
  | { type: "resetRequired"; noteIds: string[] }
  | { type: "error"; code: string; message: string }
  | { type: "ping" };

export function realtimeUrl(): string {
  const base =
    API_BASE_URL !== "" ? API_BASE_URL : window.location.origin;
  return `${base.replace(/^http/, "ws")}/api/realtime`;
}

function closeReason(event: CloseEvent): string {
  switch (event.code) {
    case CLOSE_UNAUTHENTICATED:
      return "The live connection needs a new sign-in token.";
    case CLOSE_FORBIDDEN:
      return "This account can no longer receive live updates.";
    default:
      return event.reason || "The live connection was interrupted.";
  }
}

export class WebSocketRealtimeChannel implements RealtimeChannel {
  readonly updatesNoteIdsInPlace = true;

  readonly reportsCaughtUp = true;

  private nextId = 1;

  private readonly options: WebSocketRealtimeChannelOptions;

  constructor(options: WebSocketRealtimeChannelOptions = {}) {
    this.options = options;
  }

  connect(options: MockRealtimeConnectOptions): MockRealtimeConnection {
    const id = `realtime-socket-${this.nextId}`;
    this.nextId += 1;

    const session = this.options.session ?? defaultSession;
    const setTimer =
      this.options.setInterval ??
      ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
    const clearTimer =
      this.options.clearInterval ??
      ((timer) =>
        globalThis.clearInterval(timer as ReturnType<typeof setInterval>));
    const socket = (
      this.options.createSocket ??
      ((url: string) => new WebSocket(url) as WebSocketLike)
    )((this.options.url ?? realtimeUrl)());

    let noteIds = [...options.noteIds];
    let latestCursor = 0;
    let isReady = false;
    let isClosedByUs = false;
    let sentToken: string | null = null;
    let tokenTimer: unknown = null;
    let presence: PresenceAnnouncement | null = null;

    function send(message: unknown): void {
      socket.send(JSON.stringify(message));
    }

    function subscribe(): void {
      send({
        type: "subscribe",
        noteIds,
        afterCursor:
          options.resolveAfterCursor?.(latestCursor) ??
          options.afterCursor,
      });
    }

    function sendPresence(): void {
      send(
        presence === null
          ? { type: "presence", noteId: null }
          : {
              type: "presence",
              noteId: presence.noteId,
              activity: presence.activity,
            },
      );
    }

    function stop(): void {
      if (tokenTimer !== null) {
        clearTimer(tokenTimer);
        tokenTimer = null;
      }
    }

    function fail(reason: Error): void {
      if (isClosedByUs) {
        return;
      }
      isClosedByUs = true;
      stop();
      socket.close(1000);
      options.onDisconnect(reason);
    }

    async function sendToken(): Promise<void> {
      let token: string | null;
      try {
        token = await session.getAccessToken();
      } catch {
        return; // offline: the connection is about to drop anyway
      }
      if (isClosedByUs) {
        return;
      }
      if (token === null) {
        fail(new Error("Sign in to receive live updates."));
        return;
      }
      if (token !== sentToken) {
        sentToken = token;
        send({ type: "auth", token });
      }
    }

    socket.onopen = () => {
      void sendToken();
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case "ready":
          isReady = true;
          latestCursor = Math.max(latestCursor, message.latestCursor);
          subscribe();
          if (presence !== null) {
            sendPresence();
          }
          tokenTimer = setTimer(() => {
            void sendToken();
            if (presence !== null) {
              sendPresence();
            }
          }, REPEAT_INTERVAL_MS);
          return;
        case "event":
          latestCursor = Math.max(latestCursor, message.event.cursor);
          options.onEvent(message.event);
          return;
        case "caughtUp":
          latestCursor = Math.max(latestCursor, message.cursor);
          options.onCaughtUp?.(message.cursor);
          return;
        case "resetRequired":
          options.onResetRequired?.(message.noteIds);
          return;
        default:
          // ping, or an error about one message: nothing to do.
          return;
      }
    };

    socket.onclose = (event) => {
      stop();
      if (isClosedByUs) {
        return;
      }
      isClosedByUs = true;
      if (event.code === CLOSE_UNAUTHENTICATED) {
        // Reconnecting will need a token the server accepts.
        void session.renewAfterRejection().catch(() => null);
      }
      options.onDisconnect(new Error(closeReason(event)));
    };

    socket.onerror = () => {
      // A close event follows, with the reason.
    };

    return {
      id,
      updateNoteIds(nextNoteIds) {
        noteIds = [...nextNoteIds];
        if (isReady && !isClosedByUs) {
          subscribe();
        }
      },
      setPresence(nextPresence) {
        const hadPresence = presence !== null;
        presence = nextPresence;
        if (
          isReady &&
          !isClosedByUs &&
          (nextPresence !== null || hadPresence)
        ) {
          sendPresence();
        }
      },
      disconnect() {
        if (isClosedByUs) {
          return;
        }
        isClosedByUs = true;
        stop();
        socket.close(1000);
      },
    };
  }
}

export const webSocketRealtimeChannel = new WebSocketRealtimeChannel();
