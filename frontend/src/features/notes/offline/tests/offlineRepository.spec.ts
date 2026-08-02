import "fake-indexeddb/auto";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  NoteDetail,
  NoteVersionDetail,
} from "../../../../domain/noteDetail";

import {
  resetOfflineDatabaseForTests,
} from "../offlineDatabase";

import { queueLatestSaveForNote, } from "../offlineRepository";

import {
  MAX_CACHED_NOTE_DETAILS,
  cacheNoteDetail,
  countCachedNoteDetails,
  countQueuedSaves,
  countReplayableSaves,
  enqueueSave,
  getCachedNoteDetail,
  getCachedNoteDetailRecord,
  getOldestQueuedSave,
  getQueuedSaves,
  markSaveConflict,
  recordSaveAttemptFailure,
  removeQueuedSave,
} from "../offlineRepository";

function createVersion(
  noteId: string,
  revisionNumber: number,
): NoteVersionDetail {
  const versionId =
    `${noteId}-version-${revisionNumber}`;

  return {
    versionId,
    noteId,
    revisionNumber,

    parentVersionId:
      revisionNumber > 1
        ? `${noteId}-version-${revisionNumber - 1}`
        : null,

    content: {
      subjective: `Subjective ${revisionNumber}`,
      objective: `Objective ${revisionNumber}`,
      assessment: `Assessment ${revisionNumber}`,
      plan: `Plan ${revisionNumber}`,
    },

    authorId: "clinician-1",
    authorRole: "CLINICIAN",
    authorDisplayName: "Dr. Clinician",

    createdAt: "2026-08-01T12:00:00.000Z",
  };
}

function createNoteDetail(
  noteId: string,
  revisionNumber = 1,
): NoteDetail {
  const currentVersion = createVersion(
    noteId,
    revisionNumber,
  );

  return {
    note: {
      id: noteId,
      patientId: `${noteId}-patient`,
      sessionId: `${noteId}-session`,

      status: "IN_REVIEW",

      currentVersionId:
        currentVersion.versionId,

      assignedReviewerId: "reviewer-1",

      createdAt: "2026-08-01T11:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    },

    patient: {
      id: `${noteId}-patient`,
      displayName: "Test Patient",
      dateOfBirth: "1990-01-01",
      medicalRecordNumber: "MRN-TEST",
    },

    session: {
      id: `${noteId}-session`,
      startedAt: "2026-08-01T10:00:00.000Z",
      endedAt: "2026-08-01T10:30:00.000Z",

      clinician: {
        id: "clinician-1",
        displayName: "Dr. Clinician",
        role: "CLINICIAN",
      },
    },

    assignedReviewer: {
      id: "reviewer-1",
      displayName: "Dr. Reviewer",
      role: "REVIEWER",
    },

    currentVersion,
    versions: [currentVersion],

    timeline: [],
    presence: [],
  };
}

function createSaveInput(
  noteId: string,
  clientMutationId: string,
  queuedAt: number,
) {
  return {
    noteId,

    actor: {
      id: "reviewer-1",
      displayName: "Dr. Reviewer",
      role: "REVIEWER" as const,
    },

    request: {
      baseVersionId: `${noteId}-version-1`,
      clientMutationId,

      content: {
        subjective: `Subjective ${clientMutationId}`,
        objective: `Objective ${clientMutationId}`,
        assessment: `Assessment ${clientMutationId}`,
        plan: `Plan ${clientMutationId}`,
      },
    },

    queuedAt,
  };
}

afterEach(async () => {
  await resetOfflineDatabaseForTests();
});

describe("offlineRepository", () => {

  it("coalesces repeated offline saves for the same note", async () => {
    const first =
      await queueLatestSaveForNote(
        createSaveInput(
          "note-1",
          "mutation-1",
          100,
        ),
      );

    const latest =
      await queueLatestSaveForNote(
        createSaveInput(
          "note-1",
          "mutation-2",
          200,
        ),
      );

    expect(latest.sequence).toBe(
      first.sequence,
    );

    await expect(
      countQueuedSaves(),
    ).resolves.toBe(1);

    const entries =
      await getQueuedSaves();

    expect(entries).toHaveLength(1);

    expect(
      entries[0]?.request.clientMutationId,
    ).toBe("mutation-2");

    expect(
      entries[0]?.request.content.subjective,
    ).toBe("Subjective mutation-2");

    expect(entries[0]?.queuedAt).toBe(200);
  });

  it("retains cross-note FIFO order when a queued draft is replaced", async () => {
    const firstNote =
      await queueLatestSaveForNote(
        createSaveInput(
          "note-1",
          "note-1-original",
          100,
        ),
      );

    const secondNote =
      await queueLatestSaveForNote(
        createSaveInput(
          "note-2",
          "note-2-original",
          200,
        ),
      );

    const updatedFirstNote =
      await queueLatestSaveForNote(
        createSaveInput(
          "note-1",
          "note-1-latest",
          300,
        ),
      );

    expect(
      updatedFirstNote.sequence,
    ).toBe(firstNote.sequence);

    const entries =
      await getQueuedSaves();

    expect(
      entries.map((entry) => ({
        noteId: entry.noteId,
        mutationId:
          entry.request.clientMutationId,
      })),
    ).toEqual([
      {
        noteId: "note-1",
        mutationId: "note-1-latest",
      },
      {
        noteId: "note-2",
        mutationId: "note-2-original",
      },
    ]);

    expect(secondNote.sequence).toBeGreaterThan(
      firstNote.sequence,
    );
  });

  it("does not replace a conflict-blocked save", async () => {
    const original =
      await queueLatestSaveForNote(
        createSaveInput(
          "note-1",
          "mutation-conflict",
          100,
        ),
      );

    await markSaveConflict(
      original.sequence,
      {
        message:
          "The server version changed.",

        currentVersion:
          createVersion("note-1", 3),

        commonAncestor:
          createVersion("note-1", 1),
      },
      200,
    );

    const newQueuedSave =
      await queueLatestSaveForNote(
        createSaveInput(
          "note-1",
          "mutation-after-conflict",
          300,
        ),
      );

    expect(
      newQueuedSave.sequence,
    ).not.toBe(original.sequence);

    const entries =
      await getQueuedSaves();

    expect(entries).toHaveLength(2);

    expect(
      entries[0]?.state,
    ).toBe("blocked-conflict");

    expect(
      entries[1]?.request.clientMutationId,
    ).toBe("mutation-after-conflict");
  });

  it("persists saves in FIFO insertion order", async () => {
    const first = await enqueueSave(
      createSaveInput(
        "note-1",
        "mutation-1",
        100,
      ),
    );

    const second = await enqueueSave(
      createSaveInput(
        "note-1",
        "mutation-2",
        200,
      ),
    );

    expect(first.sequence).toBeLessThan(
      second.sequence,
    );

    const entries = await getQueuedSaves();

    expect(
      entries.map(
        (entry) =>
          entry.request.clientMutationId,
      ),
    ).toEqual([
      "mutation-1",
      "mutation-2",
    ]);

    await expect(
      getOldestQueuedSave(),
    ).resolves.toEqual(first);

    await expect(
      countQueuedSaves(),
    ).resolves.toBe(2);

    await expect(
      countReplayableSaves(),
    ).resolves.toBe(2);
  });

  it("removes an acknowledged save from the queue", async () => {
    const first = await enqueueSave(
      createSaveInput(
        "note-1",
        "mutation-1",
        100,
      ),
    );

    const second = await enqueueSave(
      createSaveInput(
        "note-1",
        "mutation-2",
        200,
      ),
    );

    await removeQueuedSave(first.sequence);

    await expect(
      countQueuedSaves(),
    ).resolves.toBe(1);

    await expect(
      getOldestQueuedSave(),
    ).resolves.toEqual(second);
  });

  it("records replay failures without replacing the mutation id", async () => {
    const entry = await enqueueSave(
      createSaveInput(
        "note-1",
        "mutation-original",
        100,
      ),
    );

    const updated =
      await recordSaveAttemptFailure(
        entry.sequence,
        "Network unavailable",
        300,
      );

    expect(updated).toMatchObject({
      sequence: entry.sequence,
      state: "queued",
      retryCount: 1,
      lastAttemptAt: 300,
      lastError: "Network unavailable",
    });

    expect(
      updated?.request.clientMutationId,
    ).toBe("mutation-original");

    expect(
      updated?.request.baseVersionId,
    ).toBe("note-1-version-1");
  });

  it("blocks a conflicted entry from automatic replay", async () => {
    const entry = await enqueueSave(
      createSaveInput(
        "note-1",
        "mutation-conflict",
        100,
      ),
    );

    const currentVersion = createVersion(
      "note-1",
      3,
    );

    const commonAncestor = createVersion(
      "note-1",
      1,
    );

    const updated = await markSaveConflict(
      entry.sequence,
      {
        message:
          "The server version changed.",

        currentVersion,
        commonAncestor,
      },
      400,
    );

    expect(updated).toMatchObject({
      sequence: entry.sequence,
      state: "blocked-conflict",
      lastAttemptAt: 400,
      lastError:
        "The server version changed.",
    });

    expect(updated?.conflict).toEqual({
      message:
        "The server version changed.",

      currentVersion,
      commonAncestor,
    });

    await expect(
      countQueuedSaves(),
    ).resolves.toBe(1);

    await expect(
      countReplayableSaves(),
    ).resolves.toBe(0);

    await expect(
      getOldestQueuedSave(),
    ).resolves.toBeNull();
  });

  it("stores and replaces a cached note detail", async () => {
    const firstDetail = createNoteDetail(
      "note-1",
      1,
    );

    const updatedDetail = createNoteDetail(
      "note-1",
      2,
    );

    await cacheNoteDetail(firstDetail, 100);
    await cacheNoteDetail(updatedDetail, 200);

    const cached =
      await getCachedNoteDetail("note-1");

    const record =
      await getCachedNoteDetailRecord(
        "note-1",
      );

    expect(
      cached?.currentVersion.revisionNumber,
    ).toBe(2);

    expect(record?.cachedAt).toBe(200);

    await expect(
      countCachedNoteDetails(),
    ).resolves.toBe(1);
  });

  it("keeps only the most recently cached note details", async () => {
    for (
      let index = 0;
      index < MAX_CACHED_NOTE_DETAILS + 1;
      index += 1
    ) {
      await cacheNoteDetail(
        createNoteDetail(`note-${index}`),
        index,
      );
    }

    await expect(
      countCachedNoteDetails(),
    ).resolves.toBe(
      MAX_CACHED_NOTE_DETAILS,
    );

    await expect(
      getCachedNoteDetail("note-0"),
    ).resolves.toBeNull();

    await expect(
      getCachedNoteDetail(
        `note-${MAX_CACHED_NOTE_DETAILS}`,
      ),
    ).resolves.not.toBeNull();
  });
});