import "fake-indexeddb/auto";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  NoteDetail,
  NoteVersionDetail,
} from "../../../../domain/noteDetail";

vi.mock(
  "../../api/getNoteDetail",
  async () => {
    const actual =
      await vi.importActual<
        typeof import(
          "../../api/getNoteDetail"
        )
      >("../../api/getNoteDetail");

    return {
      ...actual,
      getNoteDetail: vi.fn(),
    };
  },
);

import {
  getNoteDetail,
  NoteDetailRequestError,
} from "../../api/getNoteDetail";

import {
  resetOfflineDatabaseForTests,
} from "../offlineDatabase";

import {
  cacheNoteDetail,
  getCachedNoteDetail,
} from "../offlineRepository";

import {
  OfflineNoteDetailUnavailableError,
  readNoteDetail,
} from "../readNoteDetail";

const getNoteDetailMock =
  vi.mocked(getNoteDetail);

function createVersion(
  noteId: string,
  revisionNumber = 1,
): NoteVersionDetail {
  return {
    versionId:
      `${noteId}-version-${revisionNumber}`,

    noteId,
    revisionNumber,

    parentVersionId:
      revisionNumber > 1
        ? `${noteId}-version-${revisionNumber - 1}`
        : null,

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

    authorId: "clinician-1",
    authorRole: "CLINICIAN",
    authorDisplayName: "Dr. Clinician",

    createdAt:
      "2026-08-01T12:00:00.000Z",
  };
}

function createNoteDetail(
  noteId: string,
): NoteDetail {
  const currentVersion =
    createVersion(noteId);

  return {
    note: {
      id: noteId,

      patientId: `${noteId}-patient`,
      sessionId: `${noteId}-session`,

      status: "IN_REVIEW",

      currentVersionId:
        currentVersion.versionId,

      assignedReviewerId: "reviewer-1",

      createdAt:
        "2026-08-01T11:00:00.000Z",

      updatedAt:
        "2026-08-01T12:00:00.000Z",
    },

    patient: {
      id: `${noteId}-patient`,
      displayName: "Test Patient",
      dateOfBirth: "1990-01-01",
      medicalRecordNumber: "MRN-TEST",
    },

    session: {
      id: `${noteId}-session`,

      startedAt:
        "2026-08-01T10:00:00.000Z",

      endedAt:
        "2026-08-01T10:30:00.000Z",

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

function setNavigatorOnline(
  online: boolean,
): void {
  Object.defineProperty(
    window.navigator,
    "onLine",
    {
      configurable: true,
      value: online,
    },
  );
}

beforeEach(() => {
  getNoteDetailMock.mockReset();
  setNavigatorOnline(true);
});

afterEach(async () => {
  setNavigatorOnline(true);

  await resetOfflineDatabaseForTests();
});

describe("readNoteDetail", () => {
  it("returns the server note and caches it after a successful read", async () => {
    const note =
      createNoteDetail("note-1");

    getNoteDetailMock.mockResolvedValueOnce(
      note,
    );

    const result = await readNoteDetail(
      "note-1",
      "REVIEWER",
    );

    expect(result).toEqual({
      note,
      source: "network",
      cachedAt: null,
    });

    await expect(
      getCachedNoteDetail("note-1"),
    ).resolves.toEqual(note);

    expect(
      getNoteDetailMock,
    ).toHaveBeenCalledWith(
      "note-1",
      "REVIEWER",
      undefined,
    );
  });

  it("serves a cached note without sending a request when the browser is offline", async () => {
    const note =
      createNoteDetail("note-1");

    await cacheNoteDetail(note, 100);

    setNavigatorOnline(false);

    const result = await readNoteDetail(
      "note-1",
      "REVIEWER",
    );

    expect(result).toEqual({
      note,
      source: "cache",
      cachedAt: 100,
    });

    expect(
      getNoteDetailMock,
    ).not.toHaveBeenCalled();
  });

  it("falls back to the cache after a network TypeError", async () => {
    const note =
      createNoteDetail("note-1");

    await cacheNoteDetail(note, 200);

    getNoteDetailMock.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    const result = await readNoteDetail(
      "note-1",
      "REVIEWER",
    );

    expect(result).toEqual({
      note,
      source: "cache",
      cachedAt: 200,
    });
  });

  it("does not hide an HTTP server error with cached content", async () => {
    const note =
      createNoteDetail("note-1");

    await cacheNoteDetail(note, 300);

    const requestError =
      new NoteDetailRequestError({
        status: 503,
        code: "internal_error",
        message:
          "Simulated server failure.",
      });

    getNoteDetailMock.mockRejectedValueOnce(
      requestError,
    );

    await expect(
      readNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    ).rejects.toBe(requestError);
  });

  it("does not hide an authorization error with cached content", async () => {
    const note =
      createNoteDetail("note-1");

    await cacheNoteDetail(note, 400);

    const requestError =
      new NoteDetailRequestError({
        status: 403,
        code: "forbidden",
        message:
          "You are not authorized to view this note.",
      });

    getNoteDetailMock.mockRejectedValueOnce(
      requestError,
    );

    await expect(
      readNoteDetail(
        "note-1",
        "READONLY_AUDITOR",
      ),
    ).rejects.toBe(requestError);
  });

  it("throws a clear error when the note has never been cached", async () => {
    setNavigatorOnline(false);

    await expect(
      readNoteDetail(
        "note-uncached",
        "REVIEWER",
      ),
    ).rejects.toEqual(
      new OfflineNoteDetailUnavailableError(
        "note-uncached",
      ),
    );
  });

  it("does not use cached content after request cancellation", async () => {
    const note =
      createNoteDetail("note-1");

    await cacheNoteDetail(note, 500);

    const controller =
      new AbortController();

    controller.abort();

    await expect(
      readNoteDetail(
        "note-1",
        "REVIEWER",
        controller.signal,
      ),
    ).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(
      getNoteDetailMock,
    ).not.toHaveBeenCalled();
  });
});