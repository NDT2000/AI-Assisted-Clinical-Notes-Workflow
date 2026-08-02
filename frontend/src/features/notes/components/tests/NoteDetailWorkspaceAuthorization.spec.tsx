import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
import type {
  TransitionNoteActor,
} from "../../../../domain/noteTransition";
import type {
  AutosaveSnapshot,
} from "../../autosave/AutosaveCoordinator";

const autosaveMocks =
  vi.hoisted(() => ({
    updateDraft:
      vi.fn(),
    retry:
      vi.fn(),
    resolveConflict:
      vi.fn(),
    adoptServerVersion:
      vi.fn(() => true),
  }));

vi.mock(
  "../../hooks/useNoteAutosave",
  () => ({
    useNoteAutosave: vi.fn(
      () => ({
        snapshot: {
          status: "idle",
          hasPendingChanges:
            false,
          error: null,
        } as AutosaveSnapshot,
        conflict: null,
        updateDraft:
          autosaveMocks
            .updateDraft,
        retry:
          autosaveMocks.retry,
        resolveConflict:
          autosaveMocks
            .resolveConflict,
        adoptServerVersion:
          autosaveMocks
            .adoptServerVersion,
      }),
    ),
  }),
);

vi.mock(
  "../../hooks/useNoteTransition",
  () => ({
    useNoteTransition:
      vi.fn(() => ({
        state: {
          status: "idle",
          trigger: null,
          message: null,
          currentVersion:
            null,
        },
        execute:
          vi.fn(
            async () => null,
          ),
      })),
  }),
);

vi.mock(
  "../../realtime/useRealtimeSubscription",
  () => ({
    useRealtimeSubscription:
      vi.fn(),
  }),
);

import { NoteDetailWorkspace, } from "../note-detail/NoteDetailWorkspace";

function createActor(
  role:
    TransitionNoteActor["role"],
  id: string,
): TransitionNoteActor {
  return {
    id,
    displayName:
      `${role} Actor`,
    role,
    ...(role === "REVIEWER" ||
    role === "ADMIN"
      ? {
          mfaVerified: true,
        }
      : {}),
  };
}

function createNoteDetail({
  status = "IN_REVIEW",
  assignedReviewerId =
    "reviewer-1",
}: {
  status?:
    NoteDetail["note"]["status"];
  assignedReviewerId?:
    string | null;
} = {}): NoteDetail {
  const currentVersion:
    NoteVersionDetail = {
    versionId: "version-1",
    noteId: "note-1",
    revisionNumber: 1,
    parentVersionId: null,
    content: {
      subjective:
        "Original subjective content.",
      objective:
        "Original objective content.",
      assessment:
        "Original assessment content.",
      plan:
        "Original plan content.",
    },
    authorId: "clinician-1",
    authorRole: "CLINICIAN",
    authorDisplayName:
      "Current Clinician",
    createdAt:
      "2026-08-02T10:00:00.000Z",
  };

  return {
    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status,
      currentVersionId:
        currentVersion.versionId,
      assignedReviewerId,
      createdAt:
        "2026-08-02T09:00:00.000Z",
      updatedAt:
        "2026-08-02T10:00:00.000Z",
    },
    patient: {
      id: "patient-1",
      displayName:
        "Patient One",
      dateOfBirth:
        "1990-01-01",
      medicalRecordNumber:
        "MRN-0000001",
    },
    session: {
      id: "session-1",
      startedAt:
        "2026-08-02T09:00:00.000Z",
      endedAt:
        "2026-08-02T09:45:00.000Z",
      clinician: {
        id: "clinician-1",
        displayName:
          "Current Clinician",
        role: "CLINICIAN",
      },
    },
    assignedReviewer:
      assignedReviewerId ===
      null
        ? null
        : {
            id:
              assignedReviewerId,
            displayName:
              "Assigned Reviewer",
            role: "REVIEWER",
          },
    currentVersion,
    versions: [
      currentVersion,
    ],
    presence: [],
    timeline: [],
  };
}

function getSubjectiveField():
  HTMLTextAreaElement {
  return screen.getByRole(
    "textbox",
    {
      name: "Subjective",
    },
  ) as HTMLTextAreaElement;
}

describe(
  "NoteDetailWorkspace authorization",
  () => {
    beforeEach(() => {
      autosaveMocks
        .updateDraft
        .mockReset();

      autosaveMocks.retry
        .mockReset();

      autosaveMocks
        .resolveConflict
        .mockReset();

      autosaveMocks
        .adoptServerVersion
        .mockReset();

      autosaveMocks
        .adoptServerVersion
        .mockReturnValue(true);
    });

    afterEach(() => {
      cleanup();
    });

    it(
      "allows the assigned reviewer to edit an in-review note",
      () => {
        render(
          <NoteDetailWorkspace
            detail={
              createNoteDetail()
            }
            actor={
              createActor(
                "REVIEWER",
                "reviewer-1",
              )
            }
          />,
        );

        const field =
          getSubjectiveField();

        expect(
          field,
        ).not.toHaveAttribute(
          "readonly",
        );

        fireEvent.change(
          field,
          {
            target: {
              value:
                "Updated subjective content.",
            },
          },
        );

        expect(
          autosaveMocks
            .updateDraft,
        ).toHaveBeenCalled();
      },
    );

    it(
      "keeps an unassigned reviewer read-only and explains why",
      () => {
        render(
          <NoteDetailWorkspace
            detail={
              createNoteDetail()
            }
            actor={
              createActor(
                "REVIEWER",
                "reviewer-2",
              )
            }
          />,
        );

        const field =
          getSubjectiveField();

        expect(
          field,
        ).toHaveAttribute(
          "readonly",
        );

        expect(
          screen.getByRole(
            "status",
            {
              name:
                "Editing permission",
            },
          ),
        ).toHaveTextContent(
          "Only the assigned reviewer can edit this note.",
        );

        fireEvent.change(
          field,
          {
            target: {
              value:
                "Attempted unauthorized edit.",
            },
          },
        );

        expect(
          autosaveMocks
            .updateDraft,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "keeps a read-only auditor from editing",
      () => {
        render(
          <NoteDetailWorkspace
            detail={
              createNoteDetail()
            }
            actor={
              createActor(
                "READONLY_AUDITOR",
                "auditor-1",
              )
            }
          />,
        );

        expect(
          getSubjectiveField(),
        ).toHaveAttribute(
          "readonly",
        );

        expect(
          screen.getByRole(
            "status",
            {
              name:
                "Editing permission",
            },
          ),
        ).toHaveTextContent(
          "Read-only auditors cannot edit note content.",
        );
      },
    );

    it(
      "allows a clinician to correct a rejected note",
      () => {
        render(
          <NoteDetailWorkspace
            detail={
              createNoteDetail({
                status:
                  "REJECTED",
              })
            }
            actor={
              createActor(
                "CLINICIAN",
                "clinician-1",
              )
            }
          />,
        );

        expect(
          getSubjectiveField(),
        ).not.toHaveAttribute(
          "readonly",
        );
      },
    );

    it(
      "keeps a locked note read-only even for an administrator",
      () => {
        render(
          <NoteDetailWorkspace
            detail={
              createNoteDetail({
                status: "LOCKED",
                assignedReviewerId:
                  null,
              })
            }
            actor={
              createActor(
                "ADMIN",
                "admin-1",
              )
            }
          />,
        );

        expect(
          getSubjectiveField(),
        ).toHaveAttribute(
          "readonly",
        );

        expect(
          screen.getByRole(
            "status",
            {
              name:
                "Editing permission",
            },
          ),
        ).toHaveTextContent(
          "Locked notes are read-only.",
        );
      },
    );
  },
);
