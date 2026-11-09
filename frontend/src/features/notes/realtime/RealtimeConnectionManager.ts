import { USE_MOCK_API } from "../../../api/apiConfig";
import {
  mockRealtimeChannel,
} from "./mockRealtimeChannel";
import type {
  MockRealtimeConnection,
  NoteRealtimeEvent,
  PresenceAnnouncement,
  RealtimeChannel,
  RealtimeConnectionSnapshot,
  RealtimeEventListener,
  RealtimeLogicalSubscription,
  RealtimeResetListener,
} from "./realtimeTypes";
import {
  webSocketRealtimeChannel,
} from "./webSocketRealtimeChannel";

interface LogicalSubscriptionRecord {
  id: string;
  noteIds: Set<string>;
  onEvent: RealtimeEventListener;
  onReset?: RealtimeResetListener;
}

interface TimerDependencies {
  setTimeout: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;

  clearTimeout: (
    timer:
      ReturnType<typeof setTimeout>,
  ) => void;

  random: () => number;
}

export interface RealtimeConnectionManagerOptions {
  channel?: RealtimeChannel;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  jitterRatio?: number;
  maxRememberedEventIds?: number;
  timers?: Partial<TimerDependencies>;
}

const DEFAULT_BASE_RECONNECT_DELAY_MS =
  250;

const DEFAULT_MAX_RECONNECT_DELAY_MS =
  8_000;

const DEFAULT_JITTER_RATIO = 0.25;

const DEFAULT_MAX_REMEMBERED_EVENT_IDS =
  10_000;

function normalizeNoteIds(
  noteIds: readonly string[],
): string[] {
  return [
    ...new Set(
      noteIds.filter(
        noteId =>
          noteId.trim().length > 0,
      ),
    ),
  ].sort();
}

function getErrorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return "The real-time connection was interrupted.";
}

export class RealtimeConnectionManager {
  private readonly channel:
    RealtimeChannel;

  private readonly baseReconnectDelayMs:
    number;

  private readonly maxReconnectDelayMs:
    number;

  private readonly jitterRatio:
    number;

  private readonly maxRememberedEventIds:
    number;

  private readonly timers:
    TimerDependencies;

  private readonly subscriptions =
    new Map<
      string,
      LogicalSubscriptionRecord
    >();

  private readonly snapshotListeners =
    new Set<() => void>();

  private readonly activeNoteIdListeners =
    new Set<
      (
        noteIds: readonly string[],
      ) => void
    >();

  private readonly lastCursorByNoteId =
    new Map<string, number>();

  private readonly seenEventIds =
    new Set<string>();

  private readonly seenEventIdOrder:
    string[] = [];

  private connection:
    MockRealtimeConnection | null = null;

  private reconnectTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  private nextSubscriptionId = 1;

  private reconnectAttempt = 0;

  // Set when a connection drops: until caught up again, the events that
  // arrive are ones the user missed.
  private hasDropped = false;

  private catchingUp = false;

  // The note this tab has open, sent again on every new connection.
  private presence:
    PresenceAnnouncement | null = null;

  private snapshot:
    RealtimeConnectionSnapshot = {
      status: "disconnected",
      activeNoteIds: [],
      lastCursor: 0,
      reconnectAttempt: 0,
      nextReconnectDelayMs: null,
      lastError: null,
    };

  constructor(
    options:
      RealtimeConnectionManagerOptions = {},
  ) {
    this.channel =
      options.channel ??
      mockRealtimeChannel;

    this.baseReconnectDelayMs =
      Math.max(
        1,
        Math.floor(
          options.baseReconnectDelayMs ??
            DEFAULT_BASE_RECONNECT_DELAY_MS,
        ),
      );

    this.maxReconnectDelayMs =
      Math.max(
        this.baseReconnectDelayMs,
        Math.floor(
          options.maxReconnectDelayMs ??
            DEFAULT_MAX_RECONNECT_DELAY_MS,
        ),
      );

    this.jitterRatio =
      Math.max(
        0,
        options.jitterRatio ??
          DEFAULT_JITTER_RATIO,
      );

    this.maxRememberedEventIds =
      Math.max(
        1,
        Math.floor(
          options.maxRememberedEventIds ??
            DEFAULT_MAX_REMEMBERED_EVENT_IDS,
        ),
      );

    this.timers = {
      setTimeout:
        options.timers?.setTimeout ??
        ((callback, delayMs) =>
          globalThis.setTimeout(
            callback,
            delayMs,
          )),

      clearTimeout:
        options.timers?.clearTimeout ??
        (timer =>
          globalThis.clearTimeout(
            timer,
          )),

      random:
        options.timers?.random ??
        Math.random,
    };
  }

  getSnapshot =
    (): RealtimeConnectionSnapshot =>
      this.snapshot;

  subscribeToSnapshot = (
    listener: () => void,
  ): (() => void) => {
    this.snapshotListeners.add(
      listener,
    );

    return () => {
      this.snapshotListeners.delete(
        listener,
      );
    };
  };

  subscribeToActiveNoteIds(
    listener: (
      noteIds: readonly string[],
    ) => void,
  ): () => void {
    this.activeNoteIdListeners.add(
      listener,
    );

    listener(
      this.snapshot.activeNoteIds,
    );

    return () => {
      this.activeNoteIdListeners.delete(
        listener,
      );
    };
  }

  subscribe(
    noteIds: readonly string[],
    onEvent: RealtimeEventListener,
    onReset?: RealtimeResetListener,
  ): RealtimeLogicalSubscription {
    const id =
      `realtime-logical-${this.nextSubscriptionId}`;

    this.nextSubscriptionId += 1;

    const record:
      LogicalSubscriptionRecord = {
        id,
        noteIds: new Set(
          normalizeNoteIds(
            noteIds,
          ),
        ),
        onEvent,
        onReset,
      };

    this.subscriptions.set(
      id,
      record,
    );

    this.refreshConnection();

    return {
      id,

      updateNoteIds:
        nextNoteIds => {
          if (
            !this.subscriptions.has(id)
          ) {
            return;
          }

          record.noteIds =
            new Set(
              normalizeNoteIds(
                nextNoteIds,
              ),
            );

          this.refreshConnection();
        },

      disconnect: () => {
        if (
          !this.subscriptions.delete(id)
        ) {
          return;
        }

        this.refreshConnection();
      },
    };
  }

  /* Tell the server which note this tab has open (null: none). */
  setPresence(
    presence: PresenceAnnouncement | null,
  ): void {
    this.presence = presence;
    this.connection?.setPresence?.(
      presence,
    );
  }

  getActiveNoteIds(): readonly string[] {
    return this.snapshot.activeNoteIds;
  }

  forceReconnect(): void {
    if (
      this.snapshot.activeNoteIds
        .length === 0
    ) {
      return;
    }

    this.connection?.disconnect();
    this.connection = null;
    this.hasDropped = true;

    this.scheduleReconnect(
      new Error(
        "The real-time connection was manually restarted.",
      ),
    );
  }

  dispose(): void {
    this.clearReconnectTimer();

    this.connection?.disconnect();
    this.connection = null;

    this.subscriptions.clear();
    this.lastCursorByNoteId.clear();
    this.seenEventIds.clear();
    this.seenEventIdOrder.length = 0;
    this.reconnectAttempt = 0;
    this.hasDropped = false;
    this.catchingUp = false;

    this.updateSnapshot({
      status: "disconnected",
      activeNoteIds: [],
      lastCursor: 0,
      reconnectAttempt: 0,
      nextReconnectDelayMs: null,
      lastError: null,
    });

    this.notifyActiveNoteIds();
  }

  private refreshConnection(): void {
    const previousNoteIds =
      this.snapshot.activeNoteIds;

    const activeNoteIds =
      this.collectActiveNoteIds();

    const changed =
      previousNoteIds.length !==
        activeNoteIds.length ||
      previousNoteIds.some(
        (noteId, index) =>
          noteId !==
          activeNoteIds[index],
      );

    this.updateSnapshot({
      activeNoteIds,
    });

    if (changed) {
      this.notifyActiveNoteIds();
    }

    if (activeNoteIds.length === 0) {
      this.clearReconnectTimer();

      this.connection?.disconnect();
      this.connection = null;
      this.reconnectAttempt = 0;

      this.updateSnapshot({
        status: "disconnected",
        reconnectAttempt: 0,
        nextReconnectDelayMs: null,
        lastError: null,
      });

      return;
    }

    if (this.connection !== null) {
      this.connection.updateNoteIds(
        activeNoteIds,
      );

      // The server's channel re-subscribes on the open connection; the
      // stand-in needs a new one to replay for added notes.
      if (
        changed &&
        !this.channel.updatesNoteIdsInPlace
      ) {
        this.reconnectImmediately();
      }

      return;
    }

    if (this.reconnectTimer !== null) {
      return;
    }

    this.connectNow();
  }

  private collectActiveNoteIds(): string[] {
    const noteIds =
      new Set<string>();

    for (
      const subscription of
      this.subscriptions.values()
    ) {
      for (
        const noteId of
        subscription.noteIds
      ) {
        noteIds.add(noteId);
      }
    }

    return [...noteIds].sort();
  }

  private getReplayCursor(
    noteIds: readonly string[],
  ): number {
    if (noteIds.length === 0) {
      return 0;
    }

    return Math.min(
      ...noteIds.map(
        noteId =>
          this.lastCursorByNoteId.get(
            noteId,
          ) ?? 0,
      ),
    );
  }

  private connectNow(): void {
    const activeNoteIds =
      this.collectActiveNoteIds();

    if (activeNoteIds.length === 0) {
      return;
    }

    this.clearReconnectTimer();

    this.updateSnapshot({
      status:
        this.reconnectAttempt > 0
          ? "reconnecting"
          : "connecting",
      reconnectAttempt:
        this.reconnectAttempt,
      nextReconnectDelayMs: null,
    });

    try {
      this.catchingUp = this.hasDropped;

      const connection =
        this.channel.connect({
          noteIds: activeNoteIds,

          afterCursor:
            this.getReplayCursor(
              activeNoteIds,
            ),

          onEvent:
            this.handleEvent,

          onDisconnect:
            this.handleDisconnect,

          resolveAfterCursor:
            this.resolveAfterCursor,

          onCaughtUp:
            this.handleCaughtUp,

          onResetRequired:
            this.handleResetRequired,
        });

      if (!this.channel.reportsCaughtUp) {
        // The stand-in replays synchronously while connecting.
        this.catchingUp = false;
        this.hasDropped = false;
      }

      this.connection = connection;
      this.reconnectAttempt = 0;

      if (this.presence !== null) {
        connection.setPresence?.(
          this.presence,
        );
      }

      this.updateSnapshot({
        status: "connected",
        reconnectAttempt: 0,
        nextReconnectDelayMs: null,
        lastError: null,
      });
    } catch (error) {
      this.connection = null;
      this.catchingUp = false;

      this.scheduleReconnect(error);
    }
  }

  private reconnectImmediately(): void {
    this.clearReconnectTimer();

    this.connection?.disconnect();
    this.connection = null;

    this.connectNow();
  }

  private readonly handleEvent = (
    event: NoteRealtimeEvent,
  ): void => {
    const previousCursor =
      this.lastCursorByNoteId.get(
        event.noteId,
      ) ?? 0;

    this.lastCursorByNoteId.set(
      event.noteId,
      Math.max(
        previousCursor,
        event.cursor,
      ),
    );

    this.updateSnapshot({
      lastCursor: Math.max(
        this.snapshot.lastCursor,
        event.cursor,
      ),
    });

    if (
      this.seenEventIds.has(
        event.eventId,
      )
    ) {
      return;
    }

    this.rememberEventId(
      event.eventId,
    );

    const meta = {
      missed: this.catchingUp,
    };

    for (
      const subscription of
      this.subscriptions.values()
    ) {
      if (
        subscription.noteIds.has(
          event.noteId,
        )
      ) {
        subscription.onEvent(
          event,
          meta,
        );
      }
    }
  };

  /*
   * Notes followed for the first time start from where the server's log
   * is now: their data was just loaded, so older events are not news.
   */
  private readonly resolveAfterCursor = (
    latestCursor: number,
  ): number => {
    const activeNoteIds =
      this.collectActiveNoteIds();

    for (const noteId of activeNoteIds) {
      if (
        !this.lastCursorByNoteId.has(
          noteId,
        )
      ) {
        this.lastCursorByNoteId.set(
          noteId,
          latestCursor,
        );
      }
    }

    return this.getReplayCursor(
      activeNoteIds,
    );
  };

  private readonly handleCaughtUp = (
    cursor: number,
  ): void => {
    for (
      const noteId of
      this.collectActiveNoteIds()
    ) {
      this.lastCursorByNoteId.set(
        noteId,
        Math.max(
          this.lastCursorByNoteId.get(
            noteId,
          ) ?? 0,
          cursor,
        ),
      );
    }

    this.catchingUp = false;
    this.hasDropped = false;

    this.updateSnapshot({
      lastCursor: Math.max(
        this.snapshot.lastCursor,
        cursor,
      ),
    });
  };

  private readonly handleResetRequired = (
    noteIds: readonly string[],
  ): void => {
    const reset = new Set(noteIds);

    for (
      const subscription of
      this.subscriptions.values()
    ) {
      const affected = [
        ...subscription.noteIds,
      ].filter(noteId =>
        reset.has(noteId),
      );

      if (affected.length > 0) {
        subscription.onReset?.(
          affected,
        );
      }
    }
  };

  private readonly handleDisconnect = (
    reason: Error,
  ): void => {
    this.connection = null;
    this.hasDropped = true;
    this.catchingUp = false;

    if (
      this.collectActiveNoteIds()
        .length === 0
    ) {
      return;
    }

    this.scheduleReconnect(reason);
  };

  private scheduleReconnect(
    error: unknown,
  ): void {
    if (
      this.collectActiveNoteIds()
        .length === 0 ||
      this.reconnectTimer !== null
    ) {
      return;
    }

    this.reconnectAttempt += 1;

    const exponentialDelay =
      Math.min(
        this.maxReconnectDelayMs,
        this.baseReconnectDelayMs *
          2 **
            (this.reconnectAttempt - 1),
      );

    const jitter =
      Math.floor(
        exponentialDelay *
          this.jitterRatio *
          this.timers.random(),
      );

    const delayMs =
      exponentialDelay + jitter;

    this.updateSnapshot({
      status: "reconnecting",
      reconnectAttempt:
        this.reconnectAttempt,
      nextReconnectDelayMs:
        delayMs,
      lastError:
        getErrorMessage(error),
    });

    this.reconnectTimer =
      this.timers.setTimeout(
        () => {
          this.reconnectTimer = null;
          this.connectNow();
        },
        delayMs,
      );
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) {
      return;
    }

    this.timers.clearTimeout(
      this.reconnectTimer,
    );

    this.reconnectTimer = null;
  }

  private rememberEventId(
    eventId: string,
  ): void {
    this.seenEventIds.add(eventId);
    this.seenEventIdOrder.push(eventId);

    while (
      this.seenEventIdOrder.length >
      this.maxRememberedEventIds
    ) {
      const oldest =
        this.seenEventIdOrder.shift();

      if (oldest !== undefined) {
        this.seenEventIds.delete(
          oldest,
        );
      }
    }
  }

  private updateSnapshot(
    update:
      Partial<RealtimeConnectionSnapshot>,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      ...update,
    };

    for (
      const listener of
      this.snapshotListeners
    ) {
      listener();
    }
  }

  private notifyActiveNoteIds(): void {
    for (
      const listener of
      this.activeNoteIdListeners
    ) {
      listener(
        this.snapshot.activeNoteIds,
      );
    }
  }
}

/*
 * Tests use the in-browser stand-in; the app uses the server's live
 * connection, for note changes and presence alike.
 */
export const realtimeConnectionManager =
  new RealtimeConnectionManager({
    channel: USE_MOCK_API
      ? mockRealtimeChannel
      : webSocketRealtimeChannel,
  });
