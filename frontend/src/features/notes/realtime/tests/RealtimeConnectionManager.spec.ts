import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  NoteVersionDetail,
} from "../../../../domain/noteDetail";
import type {
  SaveNoteVersionResponse,
} from "../../../../domain/noteSave";
import {
  RealtimeConnectionManager,
} from "../RealtimeConnectionManager";
import {
  MockRealtimeChannel,
} from "../mockRealtimeChannel";

class ManualTimer {
  private nextId = 1;

  private readonly callbacks =
    new Map<
      number,
      () => void
    >();

  readonly delays: number[] = [];

  setTimeout = (
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> => {
    const id = this.nextId;
    this.nextId += 1;

    this.callbacks.set(
      id,
      callback,
    );

    this.delays.push(delayMs);

    return id as unknown as
      ReturnType<typeof setTimeout>;
  };

  clearTimeout = (
    timer:
      ReturnType<typeof setTimeout>,
  ): void => {
    this.callbacks.delete(
      timer as unknown as number,
    );
  };

  runNext(): void {
    const first =
      this.callbacks.entries().next()
        .value as
        | [
            number,
            () => void,
          ]
        | undefined;

    if (first === undefined) {
      throw new Error(
        "Expected a scheduled timer.",
      );
    }

    const [id, callback] =
      first;

    this.callbacks.delete(id);
    callback();
  }
}

function createVersion(
  noteId: string,
  revisionNumber: number,
): NoteVersionDetail {
  return {
    versionId:
      `version-${revisionNumber}`,
    noteId,
    revisionNumber,
    parentVersionId:
      revisionNumber === 1
        ? null
        : `version-${
            revisionNumber - 1
          }`,
    content: {
      subjective:
        `Subjective ${revisionNumber}`,
      objective:
        `Objective ${revisionNumber}`,
      assessment:
        `Assessment ${revisionNumber}`,
      plan:
        `Plan ${revisionNumber}`,
    },
    authorId: "reviewer-1",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Reviewer One",
    createdAt:
      "2026-08-02T12:00:00.000Z",
  };
}

function createSaveResponse(
  noteId: string,
  revisionNumber: number,
): SaveNoteVersionResponse {
  const savedVersion =
    createVersion(
      noteId,
      revisionNumber,
    );

  return {
    clientMutationId:
      `mutation-${revisionNumber}`,
    note: {
      id: noteId,
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId:
        savedVersion.versionId,
      assignedReviewerId:
        "reviewer-1",
      createdAt:
        "2026-08-02T11:00:00.000Z",
      updatedAt:
        savedVersion.createdAt,
    },
    savedVersion,
  };
}

describe(
  "RealtimeConnectionManager",
  () => {
    it(
      "deduplicates duplicate event deliveries",
      () => {
        const channel =
          new MockRealtimeChannel();

        const manager =
          new RealtimeConnectionManager({
            channel,
          });

        const onEvent = vi.fn();

        const subscription =
          manager.subscribe(
            ["note-1"],
            onEvent,
          );

        const event =
          channel.publish({
            type:
              "note.version_added",
            noteId: "note-1",
            response:
              createSaveResponse(
                "note-1",
                2,
              ),
            eventId:
              "version-event-1",
          });

        channel.duplicateEvent(
          event.eventId,
        );

        expect(onEvent).toHaveBeenCalledTimes(
          1,
        );

        subscription.disconnect();
        manager.dispose();
      },
    );

    it(
      "replays a dropped event from the last note cursor after reconnect",
      () => {
        const channel =
          new MockRealtimeChannel();

        const timer =
          new ManualTimer();

        const manager =
          new RealtimeConnectionManager({
            channel,
            timers: {
              setTimeout:
                timer.setTimeout,
              clearTimeout:
                timer.clearTimeout,
              random: () => 0,
            },
          });

        const received:
          number[] = [];

        const subscription =
          manager.subscribe(
            ["note-1"],
            event => {
              received.push(
                event.cursor,
              );
            },
          );

        const first =
          channel.publish({
            type:
              "note.version_added",
            noteId: "note-1",
            response:
              createSaveResponse(
                "note-1",
                2,
              ),
          });

        channel.dropNextDeliveriesForAll();

        const missed =
          channel.publish({
            type:
              "note.version_added",
            noteId: "note-1",
            response:
              createSaveResponse(
                "note-1",
                3,
              ),
          });

        channel.forceDisconnectAll();

        expect(received).toEqual([
          first.cursor,
        ]);

        timer.runNext();

        expect(received).toEqual([
          first.cursor,
          missed.cursor,
        ]);

        subscription.disconnect();
        manager.dispose();
      },
    );

    it(
      "uses exponential backoff with jitter support",
      () => {
        const channel =
          new MockRealtimeChannel();

        channel.failNextConnections(2);

        const timer =
          new ManualTimer();

        const manager =
          new RealtimeConnectionManager({
            channel,
            baseReconnectDelayMs:
              250,
            maxReconnectDelayMs:
              2_000,
            jitterRatio: 0.25,
            timers: {
              setTimeout:
                timer.setTimeout,
              clearTimeout:
                timer.clearTimeout,
              random: () => 0,
            },
          });

        const subscription =
          manager.subscribe(
            ["note-1"],
            vi.fn(),
          );

        expect(timer.delays).toEqual([
          250,
        ]);

        timer.runNext();

        expect(timer.delays).toEqual([
          250,
          500,
        ]);

        timer.runNext();

        expect(
          manager.getSnapshot()
            .status,
        ).toBe("connected");

        subscription.disconnect();
        manager.dispose();
      },
    );

    it(
      "keeps one transport connection for multiple logical subscribers and cleans it up",
      () => {
        const channel =
          new MockRealtimeChannel();

        const manager =
          new RealtimeConnectionManager({
            channel,
          });

        const first =
          manager.subscribe(
            ["note-1"],
            vi.fn(),
          );

        const second =
          manager.subscribe(
            ["note-2"],
            vi.fn(),
          );

        expect(
          channel.getConnectionCount(),
        ).toBe(1);

        expect(
          manager.getActiveNoteIds(),
        ).toEqual([
          "note-1",
          "note-2",
        ]);

        first.disconnect();

        expect(
          channel.getConnectionCount(),
        ).toBe(1);

        second.disconnect();

        expect(
          channel.getConnectionCount(),
        ).toBe(0);

        manager.dispose();
      },
    );
  },
);
