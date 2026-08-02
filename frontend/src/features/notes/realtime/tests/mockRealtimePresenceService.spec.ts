import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  TransitionNoteActor,
} from "../../../../domain/noteTransition";
import {
  RealtimeConnectionManager,
} from "../RealtimeConnectionManager";
import {
  MockRealtimeChannel,
} from "../mockRealtimeChannel";
import {
  MockRealtimePresenceService,
  type PresenceBroadcastChannelLike,
} from "../mockRealtimePresenceService";

class InMemoryBroadcastHub {
  private readonly ports =
    new Set<InMemoryBroadcastPort>();

  createPort():
    InMemoryBroadcastPort {
    const port =
      new InMemoryBroadcastPort(
        this,
      );

    this.ports.add(port);

    return port;
  }

  deliver(
    sender: InMemoryBroadcastPort,
    message: unknown,
  ): void {
    for (const port of this.ports) {
      if (
        port === sender ||
        port.closed
      ) {
        continue;
      }

      port.onmessage?.(
        new MessageEvent(
          "message",
          {
            data: message,
          },
        ),
      );
    }
  }

  remove(
    port: InMemoryBroadcastPort,
  ): void {
    this.ports.delete(port);
  }
}

class InMemoryBroadcastPort
  implements
    PresenceBroadcastChannelLike {
  onmessage:
    | ((
        event: MessageEvent<unknown>,
      ) => void)
    | null = null;

  closed = false;

  private readonly hub:
    InMemoryBroadcastHub;

  constructor(
    hub: InMemoryBroadcastHub,
  ) {
    this.hub = hub;
  }

  postMessage(
    message: Parameters<
      PresenceBroadcastChannelLike[
        "postMessage"
      ]
    >[0],
  ): void {
    if (this.closed) {
      return;
    }

    this.hub.deliver(
      this,
      message,
    );
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.hub.remove(this);
  }
}

const ALEX: TransitionNoteActor = {
  id: "reviewer-1",
  displayName: "Alex Kim",
  role: "REVIEWER",
  mfaVerified: true,
};

const MAYA: TransitionNoteActor = {
  id: "clinician-1",
  displayName: "Dr. Maya Brooks",
  role: "CLINICIAN",
};

describe(
  "MockRealtimePresenceService",
  () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it(
      "shows only real sessions from other tabs",
      () => {
        const hub =
          new InMemoryBroadcastHub();

        const firstChannel =
          new MockRealtimeChannel();

        const secondChannel =
          new MockRealtimeChannel();

        const firstManager =
          new RealtimeConnectionManager({
            channel:
              firstChannel,
          });

        const secondManager =
          new RealtimeConnectionManager({
            channel:
              secondChannel,
          });

        const firstPresence:
          string[][] = [];

        const secondPresence:
          string[][] = [];

        const firstSubscription =
          firstManager.subscribe(
            ["note-1"],
            event => {
              if (
                event.type !==
                "note.presence_changed"
              ) {
                return;
              }

              firstPresence.push(
                event.presence.map(
                  entry =>
                    entry.user
                      .displayName,
                ),
              );
            },
          );

        const secondSubscription =
          secondManager.subscribe(
            ["note-1"],
            event => {
              if (
                event.type !==
                "note.presence_changed"
              ) {
                return;
              }

              secondPresence.push(
                event.presence.map(
                  entry =>
                    entry.user
                      .displayName,
                ),
              );
            },
          );

        const firstService =
          new MockRealtimePresenceService({
            channel:
              firstChannel,
            sessionId:
              "tab-1",
            createBroadcastChannel:
              () =>
                hub.createPort(),
          });

        const secondService =
          new MockRealtimePresenceService({
            channel:
              secondChannel,
            sessionId:
              "tab-2",
            createBroadcastChannel:
              () =>
                hub.createPort(),
          });

        firstService.start();
        secondService.start();

        const firstSession =
          firstService.openNote(
            "note-1",
            ALEX,
          );

        expect(
          firstPresence.at(-1),
        ).toEqual([]);

        const secondSession =
          secondService.openNote(
            "note-1",
            MAYA,
          );

        expect(
          firstPresence.at(-1),
        ).toEqual([
          "Dr. Maya Brooks",
        ]);

        expect(
          secondPresence.at(-1),
        ).toEqual([
          "Alex Kim",
        ]);

        expect(
          firstPresence
            .flat()
            .includes(
              "Dr. Casey Morgan",
            ),
        ).toBe(false);

        secondSession.disconnect();

        expect(
          firstPresence.at(-1),
        ).toEqual([]);

        firstSession.disconnect();
        firstService.stop();
        secondService.stop();

        firstSubscription.disconnect();
        secondSubscription.disconnect();

        firstManager.dispose();
        secondManager.dispose();
      },
    );

    it(
      "reports editing only while another tab is actively editing",
      () => {
        const hub =
          new InMemoryBroadcastHub();

        const firstChannel =
          new MockRealtimeChannel();

        const secondChannel =
          new MockRealtimeChannel();

        const firstManager =
          new RealtimeConnectionManager({
            channel:
              firstChannel,
          });

        const receivedActivities:
          string[] = [];

        const subscription =
          firstManager.subscribe(
            ["note-1"],
            event => {
              if (
                event.type !==
                  "note.presence_changed" ||
                event.presence[0] ===
                  undefined
              ) {
                return;
              }

              receivedActivities.push(
                event.presence[0]
                  .activity,
              );
            },
          );

        const firstService =
          new MockRealtimePresenceService({
            channel:
              firstChannel,
            sessionId:
              "tab-1",
            editingIdleMs: 1_000,
            createBroadcastChannel:
              () =>
                hub.createPort(),
          });

        const secondService =
          new MockRealtimePresenceService({
            channel:
              secondChannel,
            sessionId:
              "tab-2",
            editingIdleMs: 1_000,
            createBroadcastChannel:
              () =>
                hub.createPort(),
          });

        firstService.start();
        secondService.start();

        firstService.openNote(
          "note-1",
          ALEX,
        );

        const secondSession =
          secondService.openNote(
            "note-1",
            MAYA,
          );

        expect(
          receivedActivities.at(-1),
        ).toBe("VIEWING");

        secondSession.markEditing();

        expect(
          receivedActivities.at(-1),
        ).toBe("EDITING");

        vi.advanceTimersByTime(
          1_000,
        );

        expect(
          receivedActivities.at(-1),
        ).toBe("VIEWING");

        firstService.stop();
        secondService.stop();

        subscription.disconnect();
        firstManager.dispose();
      },
    );
  },
);