import type {
  PresenceUser,
} from "../../../domain/noteDetail";
import {
  realtimeConnectionManager,
  type RealtimeConnectionManager,
} from "./RealtimeConnectionManager";
import {
  mockRealtimeChannel,
  type MockRealtimeChannel,
} from "./mockRealtimeChannel";

export interface MockRealtimePresenceServiceOptions {
  manager?: RealtimeConnectionManager;
  channel?: MockRealtimeChannel;
  intervalMs?: number;
  now?: () => string;
}

const PRESENCE_USERS = [
  {
    id: "realtime-reviewer-1",
    displayName: "Jordan Lee",
    role: "REVIEWER",
  },
  {
    id: "realtime-clinician-1",
    displayName: "Dr. Casey Morgan",
    role: "CLINICIAN",
  },
] as const;

export class MockRealtimePresenceService {
  private readonly manager:
    RealtimeConnectionManager;

  private readonly channel:
    MockRealtimeChannel;

  private readonly intervalMs:
    number;

  private readonly now: () => string;

  private timer:
    | ReturnType<typeof setInterval>
    | null = null;

  private unsubscribeActiveNotes:
    | (() => void)
    | null = null;

  private activeNoteIds:
    readonly string[] = [];

  private tickNumber = 0;

  constructor(
    options:
      MockRealtimePresenceServiceOptions = {},
  ) {
    this.manager =
      options.manager ??
      realtimeConnectionManager;

    this.channel =
      options.channel ??
      mockRealtimeChannel;

    this.intervalMs =
      Math.max(
        1_000,
        Math.floor(
          options.intervalMs ??
            8_000,
        ),
      );

    this.now =
      options.now ??
      (() => new Date().toISOString());
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }

    this.unsubscribeActiveNotes =
      this.manager
        .subscribeToActiveNoteIds(
          noteIds => {
            this.activeNoteIds = [
              ...noteIds,
            ];

            this.publishPresence();
          },
        );

    this.timer =
      globalThis.setInterval(
        () => {
          this.publishPresence();
        },
        this.intervalMs,
      );
  }

  stop(): void {
    if (this.timer !== null) {
      globalThis.clearInterval(
        this.timer,
      );

      this.timer = null;
    }

    this.unsubscribeActiveNotes?.();
    this.unsubscribeActiveNotes =
      null;

    this.activeNoteIds = [];
  }

  private publishPresence(): void {
    if (
      this.activeNoteIds.length === 0
    ) {
      return;
    }

    const occurredAt = this.now();

    for (
      const [
        noteIndex,
        noteId,
      ] of
      this.activeNoteIds.entries()
    ) {
      const presence =
        this.createPresence(
          noteIndex,
          occurredAt,
        );

      this.channel.publish({
        type:
          "note.presence_changed",
        noteId,
        occurredAt,
        presence,
      });
    }

    this.tickNumber += 1;
  }

  private createPresence(
    noteIndex: number,
    occurredAt: string,
  ): PresenceUser[] {
    const firstUser =
      PRESENCE_USERS[
        (this.tickNumber +
          noteIndex) %
          PRESENCE_USERS.length
      ];

    const entries:
      PresenceUser[] = [
        {
          user: {
            ...firstUser,
          },
          activity:
            this.tickNumber % 2 === 0
              ? "VIEWING"
              : "EDITING",
          lastSeenAt: occurredAt,
        },
      ];

    if (
      (this.tickNumber +
        noteIndex) %
        3 ===
      0
    ) {
      const secondUser =
        PRESENCE_USERS[
          (this.tickNumber +
            noteIndex +
            1) %
            PRESENCE_USERS.length
        ];

      entries.push({
        user: {
          ...secondUser,
        },
        activity: "VIEWING",
        lastSeenAt: occurredAt,
      });
    }

    return entries;
  }
}

export const mockRealtimePresenceService =
  new MockRealtimePresenceService();
