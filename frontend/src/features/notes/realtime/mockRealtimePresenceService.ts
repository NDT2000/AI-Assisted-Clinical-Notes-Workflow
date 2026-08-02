import type {
  PresenceActivity,
  PresenceUser,
  UserSummary,
} from "../../../domain/noteDetail";
import type {
  TransitionNoteActor,
} from "../../../domain/noteTransition";
import type {
  RealtimeConnectionManager,
} from "./RealtimeConnectionManager";
import {
  mockRealtimeChannel,
  type MockRealtimeChannel,
} from "./mockRealtimeChannel";

const BROADCAST_CHANNEL_NAME =
  "clinical-notes-presence-v1";

const DEFAULT_HEARTBEAT_MS =
  4_000;

const DEFAULT_STALE_AFTER_MS =
  12_000;

const DEFAULT_EDITING_IDLE_MS =
  3_000;

interface PresenceSessionRecord {
  sessionId: string;
  noteId: string;
  user: UserSummary;
  activity: PresenceActivity;
  lastSeenAt: string;
}

type PresenceBroadcastMessage =
  | {
      type: "presence.upsert";
      session: PresenceSessionRecord;
    }
  | {
      type: "presence.leave";
      sessionId: string;
    }
  | {
      type: "presence.query";
      requesterSessionId: string;
    };

export interface PresenceBroadcastChannelLike {
  onmessage:
    | ((
        event: MessageEvent<unknown>,
      ) => void)
    | null;

  postMessage(
    message: PresenceBroadcastMessage,
  ): void;

  close(): void;
}

export interface MockRealtimePresenceServiceOptions {
  channel?: MockRealtimeChannel;

  manager?:
    RealtimeConnectionManager;

  intervalMs?: number;

  heartbeatMs?: number;

  staleAfterMs?: number;

  editingIdleMs?: number;

  now?: () => string;

  sessionId?: string;

  createBroadcastChannel?: (
    name: string,
  ) =>
    | PresenceBroadcastChannelLike
    | null;
}

export interface PresenceSessionHandle {
  markEditing(): void;
  disconnect(): void;
}

function createSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    "presence-session-" +
    Math.random()
      .toString(36)
      .slice(2) +
    "-" +
    Date.now().toString(36)
  );
}

function createDefaultBroadcastChannel(
  name: string,
): PresenceBroadcastChannelLike | null {
  if (
    typeof BroadcastChannel ===
    "undefined"
  ) {
    return null;
  }

  return new BroadcastChannel(name);
}

function isUserSummary(
  value: unknown,
): value is UserSummary {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const candidate =
    value as Partial<UserSummary>;

  return (
    typeof candidate.id ===
      "string" &&
    typeof candidate.displayName ===
      "string" &&
    (candidate.role ===
      "CLINICIAN" ||
      candidate.role ===
        "REVIEWER" ||
      candidate.role === "ADMIN" ||
      candidate.role ===
        "READONLY_AUDITOR")
  );
}

function isPresenceSessionRecord(
  value: unknown,
): value is PresenceSessionRecord {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const candidate =
    value as Partial<PresenceSessionRecord>;

  return (
    typeof candidate.sessionId ===
      "string" &&
    typeof candidate.noteId ===
      "string" &&
    isUserSummary(
      candidate.user,
    ) &&
    (candidate.activity ===
      "VIEWING" ||
      candidate.activity ===
        "EDITING") &&
    typeof candidate.lastSeenAt ===
      "string"
  );
}

function isPresenceBroadcastMessage(
  value: unknown,
): value is PresenceBroadcastMessage {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const candidate =
    value as {
      type?: unknown;
      session?: unknown;
      sessionId?: unknown;
      requesterSessionId?: unknown;
    };

  if (
    candidate.type ===
    "presence.upsert"
  ) {
    return isPresenceSessionRecord(
      candidate.session,
    );
  }

  if (
    candidate.type ===
    "presence.leave"
  ) {
    return (
      typeof candidate.sessionId ===
      "string"
    );
  }

  if (
    candidate.type ===
    "presence.query"
  ) {
    return (
      typeof candidate
        .requesterSessionId ===
      "string"
    );
  }

  return false;
}

function toUserSummary(
  actor: TransitionNoteActor,
): UserSummary {
  return {
    id: actor.id,
    displayName:
      actor.displayName,
    role: actor.role,
  };
}

function copySession(
  session: PresenceSessionRecord,
): PresenceSessionRecord {
  return {
    ...session,
    user: {
      ...session.user,
    },
  };
}

export class MockRealtimePresenceService {
  private readonly channel:
    MockRealtimeChannel;

  private readonly heartbeatMs:
    number;

  private readonly staleAfterMs:
    number;

  private readonly editingIdleMs:
    number;

  private readonly now: () => string;

  private readonly sessionId:
    string;

  private readonly createBroadcastChannel:
    (
      name: string,
    ) =>
      | PresenceBroadcastChannelLike
      | null;

  private broadcastChannel:
    PresenceBroadcastChannelLike | null =
      null;

  private heartbeatTimer:
    | ReturnType<typeof setInterval>
    | null = null;

  private editingIdleTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  private localSession:
    PresenceSessionRecord | null =
      null;

  private localRegistration = 0;

  private readonly remoteSessions =
    new Map<
      string,
      PresenceSessionRecord
    >();

  constructor(
    options:
      MockRealtimePresenceServiceOptions = {},
  ) {
    this.channel =
      options.channel ??
      mockRealtimeChannel;

    this.heartbeatMs =
      Math.max(
        1_000,
        Math.floor(
          options.heartbeatMs ??
            options.intervalMs ??
            DEFAULT_HEARTBEAT_MS,
        ),
      );

    this.staleAfterMs =
      Math.max(
        this.heartbeatMs * 2,
        Math.floor(
          options.staleAfterMs ??
            DEFAULT_STALE_AFTER_MS,
        ),
      );

    this.editingIdleMs =
      Math.max(
        250,
        Math.floor(
          options.editingIdleMs ??
            DEFAULT_EDITING_IDLE_MS,
        ),
      );

    this.now =
      options.now ??
      (() =>
        new Date().toISOString());

    this.sessionId =
      options.sessionId ??
      createSessionId();

    this.createBroadcastChannel =
      options.createBroadcastChannel ??
      createDefaultBroadcastChannel;
  }

  start(): void {
    if (
      this.heartbeatTimer !==
        null ||
      this.broadcastChannel !==
        null
    ) {
      return;
    }

    this.broadcastChannel =
      this.createBroadcastChannel(
        BROADCAST_CHANNEL_NAME,
      );

    if (
      this.broadcastChannel !==
      null
    ) {
      this.broadcastChannel.onmessage =
        event => {
          this.handleBroadcastMessage(
            event.data,
          );
        };

      this.postMessage({
        type: "presence.query",
        requesterSessionId:
          this.sessionId,
      });
    }

    this.heartbeatTimer =
      globalThis.setInterval(
        () => {
          this.sendHeartbeat();
        },
        this.heartbeatMs,
      );
  }

  stop(): void {
    this.clearEditingIdleTimer();

    if (
      this.localSession !== null
    ) {
      const noteId =
        this.localSession.noteId;

      this.postMessage({
        type: "presence.leave",
        sessionId:
          this.sessionId,
      });

      this.localSession = null;
      this.publishPresence(noteId);
    }

    if (
      this.heartbeatTimer !==
      null
    ) {
      globalThis.clearInterval(
        this.heartbeatTimer,
      );

      this.heartbeatTimer = null;
    }

    if (
      this.broadcastChannel !==
      null
    ) {
      this.broadcastChannel.onmessage =
        null;

      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    const affectedNoteIds =
      new Set(
        Array.from(
          this.remoteSessions.values(),
          session =>
            session.noteId,
        ),
      );

    this.remoteSessions.clear();

    for (
      const noteId of
      affectedNoteIds
    ) {
      this.publishPresence(noteId);
    }
  }

  openNote(
    noteId: string,
    actor: TransitionNoteActor,
  ): PresenceSessionHandle {
    this.start();

    this.closeLocalSession();

    this.localRegistration += 1;

    const registration =
      this.localRegistration;

    this.localSession = {
      sessionId:
        this.sessionId,
      noteId,
      user: toUserSummary(actor),
      activity: "VIEWING",
      lastSeenAt: this.now(),
    };

    this.publishPresence(noteId);
    this.broadcastLocalSession();

    this.postMessage({
      type: "presence.query",
      requesterSessionId:
        this.sessionId,
    });

    let disconnected = false;

    return {
      markEditing: () => {
        if (
          disconnected ||
          registration !==
            this.localRegistration
        ) {
          return;
        }

        this.markEditing();
      },

      disconnect: () => {
        if (disconnected) {
          return;
        }

        disconnected = true;

        if (
          registration !==
          this.localRegistration
        ) {
          return;
        }

        this.closeLocalSession();
      },
    };
  }

  markEditing(): void {
    if (
      this.localSession === null
    ) {
      return;
    }

    this.localSession = {
      ...this.localSession,
      activity: "EDITING",
      lastSeenAt: this.now(),
    };

    this.broadcastLocalSession();
    this.clearEditingIdleTimer();

    this.editingIdleTimer =
      globalThis.setTimeout(
        () => {
          this.editingIdleTimer =
            null;

          if (
            this.localSession ===
            null
          ) {
            return;
          }

          this.localSession = {
            ...this.localSession,
            activity: "VIEWING",
            lastSeenAt:
              this.now(),
          };

          this.broadcastLocalSession();
        },
        this.editingIdleMs,
      );
  }

  private closeLocalSession(): void {
    if (
      this.localSession === null
    ) {
      return;
    }

    const noteId =
      this.localSession.noteId;

    this.clearEditingIdleTimer();

    this.postMessage({
      type: "presence.leave",
      sessionId: this.sessionId,
    });

    this.localSession = null;
    this.localRegistration += 1;

    this.publishPresence(noteId);
  }

  private sendHeartbeat(): void {
    this.expireStaleSessions();

    if (
      this.localSession === null
    ) {
      return;
    }

    this.localSession = {
      ...this.localSession,
      lastSeenAt: this.now(),
    };

    this.broadcastLocalSession();
  }

  private broadcastLocalSession(): void {
    if (
      this.localSession === null
    ) {
      return;
    }

    this.postMessage({
      type: "presence.upsert",
      session: copySession(
        this.localSession,
      ),
    });
  }

  private postMessage(
    message: PresenceBroadcastMessage,
  ): void {
    this.broadcastChannel?.postMessage(
      message,
    );
  }

  private handleBroadcastMessage(
    value: unknown,
  ): void {
    if (
      !isPresenceBroadcastMessage(
        value,
      )
    ) {
      return;
    }

    if (
      value.type ===
      "presence.query"
    ) {
      if (
        value.requesterSessionId !==
        this.sessionId
      ) {
        this.broadcastLocalSession();
      }

      return;
    }

    if (
      value.type ===
      "presence.leave"
    ) {
      if (
        value.sessionId ===
        this.sessionId
      ) {
        return;
      }

      const removed =
        this.remoteSessions.get(
          value.sessionId,
        );

      if (removed === undefined) {
        return;
      }

      this.remoteSessions.delete(
        value.sessionId,
      );

      this.publishPresence(
        removed.noteId,
      );

      return;
    }

    const session =
      value.session;

    if (
      session.sessionId ===
      this.sessionId
    ) {
      return;
    }

    const previous =
      this.remoteSessions.get(
        session.sessionId,
      );

    this.remoteSessions.set(
      session.sessionId,
      copySession(session),
    );

    if (
      previous !== undefined &&
      previous.noteId !==
        session.noteId
    ) {
      this.publishPresence(
        previous.noteId,
      );
    }

    this.publishPresence(
      session.noteId,
    );
  }

  private expireStaleSessions(): void {
    const nowTimestamp =
      Date.parse(this.now());

    if (
      !Number.isFinite(
        nowTimestamp,
      )
    ) {
      return;
    }

    const affectedNoteIds =
      new Set<string>();

    for (
      const [
        remoteSessionId,
        session,
      ] of
      this.remoteSessions
    ) {
      const lastSeenTimestamp =
        Date.parse(
          session.lastSeenAt,
        );

      if (
        !Number.isFinite(
          lastSeenTimestamp,
        ) ||
        nowTimestamp -
          lastSeenTimestamp <=
          this.staleAfterMs
      ) {
        continue;
      }

      this.remoteSessions.delete(
        remoteSessionId,
      );

      affectedNoteIds.add(
        session.noteId,
      );
    }

    for (
      const noteId of
      affectedNoteIds
    ) {
      this.publishPresence(noteId);
    }
  }

  private publishPresence(
    noteId: string,
  ): void {
    const sessions =
      Array.from(
        this.remoteSessions.values(),
      ).filter(
        session =>
          session.noteId === noteId,
      );

    const presenceByUserId =
      new Map<
        string,
        PresenceUser
      >();

    for (
      const session of sessions
    ) {
      const existing =
        presenceByUserId.get(
          session.user.id,
        );

      if (
        existing === undefined ||
        session.activity ===
          "EDITING" ||
        Date.parse(
          session.lastSeenAt,
        ) >
          Date.parse(
            existing.lastSeenAt,
          )
      ) {
        presenceByUserId.set(
          session.user.id,
          {
            user: {
              ...session.user,
            },
            activity:
              session.activity,
            lastSeenAt:
              session.lastSeenAt,
          },
        );
      }
    }

    const presence =
      Array.from(
        presenceByUserId.values(),
      ).sort(
        (
          firstPresence,
          secondPresence,
        ) => {
          if (
            firstPresence.activity !==
            secondPresence.activity
          ) {
            return firstPresence
              .activity === "EDITING"
              ? -1
              : 1;
          }

          return firstPresence
            .user.displayName.localeCompare(
              secondPresence
                .user.displayName,
            );
        },
      );

    this.channel.publish({
      type:
        "note.presence_changed",
      noteId,
      occurredAt: this.now(),
      presence,
    });
  }

  private clearEditingIdleTimer(): void {
    if (
      this.editingIdleTimer ===
      null
    ) {
      return;
    }

    globalThis.clearTimeout(
      this.editingIdleTimer,
    );

    this.editingIdleTimer = null;
  }
}

export const mockRealtimePresenceService =
  new MockRealtimePresenceService();
