import type {
  Trigger,
} from "../../../domain/noteAttributes";
import type {
  PresenceUser,
} from "../../../domain/noteDetail";
import type {
  SaveNoteVersionResponse,
} from "../../../domain/noteSave";
import type {
  TransitionNoteResponse,
} from "../../../domain/noteTransition";

export interface RealtimeEventBase {
  eventId: string;
  cursor: number;
  noteId: string;
  occurredAt: string;
}

export interface NoteStatusChangedRealtimeEvent
  extends RealtimeEventBase {
  type: "note.status_changed";
  trigger: Trigger;
  response: TransitionNoteResponse;
}

export interface NoteVersionAddedRealtimeEvent
  extends RealtimeEventBase {
  type: "note.version_added";
  response: SaveNoteVersionResponse;
}

export interface NotePresenceChangedRealtimeEvent
  extends RealtimeEventBase {
  type: "note.presence_changed";
  presence: readonly PresenceUser[];
}

export type NoteRealtimeEvent =
  | NoteStatusChangedRealtimeEvent
  | NoteVersionAddedRealtimeEvent
  | NotePresenceChangedRealtimeEvent;

export interface PublishStatusChangedRealtimeEvent {
  type: "note.status_changed";
  noteId: string;
  trigger: Trigger;
  response: TransitionNoteResponse;
  eventId?: string;
  occurredAt?: string;
}

export interface PublishVersionAddedRealtimeEvent {
  type: "note.version_added";
  noteId: string;
  response: SaveNoteVersionResponse;
  eventId?: string;
  occurredAt?: string;
}

export interface PublishPresenceChangedRealtimeEvent {
  type: "note.presence_changed";
  noteId: string;
  presence: readonly PresenceUser[];
  eventId?: string;
  occurredAt?: string;
}

export type PublishNoteRealtimeEvent =
  | PublishStatusChangedRealtimeEvent
  | PublishVersionAddedRealtimeEvent
  | PublishPresenceChangedRealtimeEvent;

export interface MockRealtimeConnectOptions {
  noteIds: readonly string[];
  afterCursor: number;
  onEvent: (
    event: NoteRealtimeEvent,
  ) => void;
  onDisconnect: (
    reason: Error,
  ) => void;
  /*
   * The server's channel only: once it says where its log is, the cursor
   * to catch up from (notes just loaded start from there).
   */
  resolveAfterCursor?: (
    latestCursor: number,
  ) => number;
  /* Missed events have been sent; what follows is live. */
  onCaughtUp?: (cursor: number) => void;
  /* Too much changed for these notes: reload them. */
  onResetRequired?: (
    noteIds: readonly string[],
  ) => void;
}

/* Where events come from: the server, or the in-browser stand-in. */
export interface RealtimeChannel {
  connect(
    options: MockRealtimeConnectOptions,
  ): MockRealtimeConnection;
  /*
   * True when changing the followed notes needs no new connection
   * (updateNoteIds re-subscribes on the open one).
   */
  readonly updatesNoteIdsInPlace?: boolean;
  /* True when the channel says when catching up is done (onCaughtUp). */
  readonly reportsCaughtUp?: boolean;
}

export interface MockRealtimeConnection {
  readonly id: string;

  updateNoteIds(
    noteIds: readonly string[],
  ): void;

  disconnect(): void;
}

export type RealtimeConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface RealtimeConnectionSnapshot {
  status: RealtimeConnectionStatus;
  activeNoteIds: readonly string[];
  lastCursor: number;
  reconnectAttempt: number;
  nextReconnectDelayMs: number | null;
  lastError: string | null;
}

export interface RealtimeEventMeta {
  /* Sent while catching up after a reconnection: it was missed. */
  missed: boolean;
}

export type RealtimeEventListener = (
  event: NoteRealtimeEvent,
  meta: RealtimeEventMeta,
) => void;

export type RealtimeResetListener = (
  noteIds: readonly string[],
) => void;

export interface RealtimeLogicalSubscription {
  readonly id: string;

  updateNoteIds(
    noteIds: readonly string[],
  ): void;

  disconnect(): void;
}
