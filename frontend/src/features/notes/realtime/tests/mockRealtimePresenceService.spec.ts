import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  RealtimeConnectionManager,
} from "../RealtimeConnectionManager";
import {
  MockRealtimeChannel,
} from "../mockRealtimeChannel";
import {
  MockRealtimePresenceService,
} from "../mockRealtimePresenceService";

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
      "publishes live presence only for subscribed notes and stops cleanly",
      () => {
        const channel =
          new MockRealtimeChannel();

        const manager =
          new RealtimeConnectionManager({
            channel,
          });

        const received:
          string[] = [];

        const subscription =
          manager.subscribe(
            ["note-1"],
            event => {
              if (
                event.type ===
                "note.presence_changed"
              ) {
                received.push(
                  event.noteId,
                );
              }
            },
          );

        const service =
          new MockRealtimePresenceService({
            manager,
            channel,
            intervalMs: 1_000,
            now: () =>
              "2026-08-02T12:00:00.000Z",
          });

        service.start();

        expect(received).toEqual([
          "note-1",
        ]);

        vi.advanceTimersByTime(
          1_000,
        );

        expect(received).toEqual([
          "note-1",
          "note-1",
        ]);

        service.stop();

        vi.advanceTimersByTime(
          2_000,
        );

        expect(received).toEqual([
          "note-1",
          "note-1",
        ]);

        subscription.disconnect();
        manager.dispose();
      },
    );
  },
);
