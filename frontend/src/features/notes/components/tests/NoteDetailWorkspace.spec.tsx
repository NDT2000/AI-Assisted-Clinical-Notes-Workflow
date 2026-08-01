import { act, cleanup, fireEvent, render, screen, within, } from "@testing-library/react";
import  userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi, } from "vitest";

const autosaveMocks = vi.hoisted(() => ({
  updateDraft: vi.fn(),
  retry: vi.fn(),

  snapshot: {
    status: "idle",
    hasPendingChanges: false,
    error: null,
  } as AutosaveSnapshot,

  onSaveSuccess: undefined as
    | ((result: AutosaveSuccess) => void)
    | undefined,
}));

vi.mock(
  "../../hooks/useNoteAutosave",
  () => ({
    useNoteAutosave: vi.fn(
      (options: {
        onSaveSuccess: (
          result: AutosaveSuccess,
        ) => void;
      }) => {
        autosaveMocks.onSaveSuccess =
          options.onSaveSuccess;

        return {
          snapshot: 
            autosaveMocks.snapshot,
          updateDraft:
            autosaveMocks.updateDraft,
          retry: autosaveMocks.retry,
        };
      },
    ),
  }),
);

import type { NoteDetail, NoteVersionDetail, } from "../../../../domain/noteDetail";
import { NoteDetailWorkspace } from "../note-detail/NoteDetailWorkspace";
import type { SaveNoteVersionActor } from "../../../../domain/noteSave";
import type {AutosaveSuccess, AutosaveSnapshot} from "../../autosave/AutosaveCoordinator";

const actor: SaveNoteVersionActor = {
  id: "reviewer-1",
  displayName: "Test Reviewer",
  role: "REVIEWER",
};

type NoteStatus =
  NoteDetail["note"]["status"];

interface SoapSectionElements {
  field: HTMLTextAreaElement;
  section: HTMLElement;
}

function createNoteDetail(
  status: NoteStatus = "IN_REVIEW",
): NoteDetail {
  const currentVersion: NoteVersionDetail = {
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
      "Dr. Maya Brooks",
    createdAt:
      "2026-07-29T10:00:00.000Z",
  };

  return {
    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status,
      currentVersionId:
        currentVersion.versionId,
      assignedReviewerId:
        "reviewer-1",
      createdAt:
        "2026-07-29T09:45:00.000Z",
      updatedAt:
        "2026-07-29T10:00:00.000Z",
    },

    patient: {
      id: "patient-1",
      displayName: "Patient One",
      dateOfBirth: "1990-01-01",
      medicalRecordNumber:
        "MRN-0000001",
    },

    session: {
      id: "session-1",
      startedAt:
        "2026-07-29T09:00:00.000Z",
      endedAt:
        "2026-07-29T09:45:00.000Z",

      clinician: {
        id: "clinician-1",
        displayName:
          "Dr. Maya Brooks",
        role: "CLINICIAN",
      },
    },

    assignedReviewer: {
      id: "reviewer-1",
      displayName: "Alex Reviewer",
      role: "REVIEWER",
    },

    currentVersion,
    versions: [currentVersion],
    presence: [],
    timeline: [],
  };
}

function getSoapSection(
  name:
    | "Subjective"
    | "Objective"
    | "Assessment"
    | "Plan",
): SoapSectionElements {
  const field = screen.getByRole(
    "textbox",
    {
      name,
    },
  ) as HTMLTextAreaElement;

  const section =
    field.closest<HTMLElement>(
      ".soap-section",
    );

  if (!section) {
    throw new Error(
      `Expected a SOAP section for ${name}.`,
    );
  }

  return {
    field,
    section,
  };
}

afterEach(() => {
  cleanup();
});

describe("NoteDetailWorkspace", () => {
  beforeEach(() => {
    autosaveMocks.updateDraft.mockReset();
    autosaveMocks.retry.mockReset();
    autosaveMocks.snapshot = {
      status: "idle",
      hasPendingChanges: false,
      error: null,
    };
    autosaveMocks.onSaveSuccess =
      undefined;
  });

  it(
    "shows a save failure and allows the user to retry",
    async () => {
      const user = userEvent.setup();
      const detail = createNoteDetail();

      autosaveMocks.snapshot = {
        status: "save-failed",
        hasPendingChanges: true,
        error: new Error(
          "The save request failed.",
        ),
      };

      render(
        <NoteDetailWorkspace
          detail={detail}
          actor={actor}
        />,
      );

      expect(
        screen.getByRole("alert"),
      ).toHaveTextContent(
        /save failed/i,
      );

      const retryButton =
        screen.getByRole("button", {
          name: /try again/i,
        });

      await user.click(retryButton);

      expect(
        autosaveMocks.retry,
      ).toHaveBeenCalledTimes(1);
    },
  );

  it(
    "queues the complete SOAP draft and clears dirty state after a successful save",
    async () => {
      const user = userEvent.setup();
      const detail = createNoteDetail();

      render(
        <NoteDetailWorkspace
          detail={detail}
          actor={actor}
        />,
      );

      const subjectiveInput =
        screen.getByRole("textbox", {
          name: /subjective/i,
        });

      await user.clear(subjectiveInput);
      await user.type(
        subjectiveInput,
        "Updated subjective content",
      );

      const savedContent = {
        ...detail.currentVersion.content,
        subjective:
          "Updated subjective content",
      };

      expect(
        autosaveMocks.updateDraft,
      ).toHaveBeenLastCalledWith(
        savedContent,
      );

      expect(
        screen.getByText("Unsaved changes", {
          selector: ".soap-dirty-indicator",
        }),
      ).toBeInTheDocument();

      const savedVersion = {
        ...detail.currentVersion,
        versionId: "version-saved-2",
        revisionNumber:
          detail.currentVersion
            .revisionNumber + 1,
        parentVersionId:
          detail.currentVersion
            .versionId,
        content: savedContent,
        createdAt:
          "2026-07-31T21:00:00.000Z",
      };

      const saveResult: AutosaveSuccess = {
        savedContent,

        response: {
          clientMutationId:
            "mutation-test-1",

          note: {
            ...detail.note,
            currentVersionId:
              savedVersion.versionId,
            updatedAt:
              savedVersion.createdAt,
          },

          savedVersion,
        },
      };

      act(() => {
        autosaveMocks.onSaveSuccess?.(
          saveResult,
        );
      });

      expect(
        screen.queryByText(
          /unsaved changes/i,
        ),
      ).not.toBeInTheDocument();

      const versionHistory =
        screen.getByRole("region", {
          name: /version history/i,
        });

      expect(
        within(versionHistory).getByRole(
          "button",
          {
            name: new RegExp(
              `Revision ${savedVersion.revisionNumber}`,
              "i",
            ),
          },
        ),
      ).toBeInTheDocument();

      expect(subjectiveInput).toHaveValue(
        "Updated subjective content",
      );
    },
  );

  it(
    "shows an older version as read-only without replacing the current draft",
    async () => {
      const user = userEvent.setup();
      const originalDetail =
        createNoteDetail();

      const historicalVersion = {
        ...originalDetail.currentVersion,
        versionId: "version-1",
        revisionNumber: 1,
        parentVersionId: null,
        content: {
          subjective:
            "Historical subjective content",
          objective:
            "Historical objective content",
          assessment:
            "Historical assessment content",
          plan:
            "Historical plan content",
        },
        createdAt:
          "2026-07-30T10:00:00.000Z",
      };

      const currentVersion = {
        ...originalDetail.currentVersion,
        versionId: "version-2",
        revisionNumber: 2,
        parentVersionId:
          historicalVersion.versionId,
        createdAt:
          "2026-07-31T10:00:00.000Z",
      };

      const detail = {
        ...originalDetail,

        note: {
          ...originalDetail.note,
          currentVersionId:
            currentVersion.versionId,
        },

        currentVersion,

        versions: [
          historicalVersion,
          currentVersion,
        ],
      };

      render(
        <NoteDetailWorkspace
          detail={detail}
          actor={actor}
        />,
      );

      const subjectiveInput =
        screen.getByRole("textbox", {
          name: /subjective/i,
        });

      await user.clear(subjectiveInput);
      await user.type(
        subjectiveInput,
        "Unsaved current draft content",
      );

      expect(subjectiveInput).toHaveValue(
        "Unsaved current draft content",
      );

      const versionHistory =
        screen.getByRole("region", {
          name: /version history/i,
        });

      await user.click(
        within(versionHistory).getByRole(
          "button",
          {
            name: new RegExp(
              `Revision ${historicalVersion.revisionNumber}`,
              "i",
            ),
          },
        ),
      );

      expect(
        screen.getByText(
          new RegExp(
            `Viewing revision ${historicalVersion.revisionNumber}`,
            "i",
          ),
        ),
      ).toBeInTheDocument();

      const historicalSubjectiveInput =
        screen.getByRole("textbox", {
          name: /subjective/i,
        });

      expect(
        historicalSubjectiveInput,
      ).toHaveValue(
        historicalVersion.content.subjective,
      );

      expect(
        historicalSubjectiveInput,
      ).toHaveAttribute("readonly");

      await user.click(
        within(versionHistory).getByRole(
          "button",
          {
            name: new RegExp(
              `Revision ${detail.currentVersion.revisionNumber}`,
              "i",
            ),
          },
        ),
      );

      const restoredDraftInput =
        screen.getByRole("textbox", {
          name: /subjective/i,
        });

      expect(restoredDraftInput).toHaveValue(
        "Unsaved current draft content",
      );

      expect(
        restoredDraftInput,
      ).not.toHaveAttribute("readonly");
    },
  );

  it("initially renders all SOAP sections as clean", () => {
    render(
      <NoteDetailWorkspace
        detail={createNoteDetail()}
        actor={actor}
      />,
    );

    expect(
      screen.queryByText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();
  });

  it("tracks each dirty SOAP section independently", () => {
    render(
      <NoteDetailWorkspace
        detail={createNoteDetail()}
        actor={actor}
      />,
    );

    const subjective =
      getSoapSection("Subjective");

    const objective =
      getSoapSection("Objective");

    const assessment =
      getSoapSection("Assessment");

    const plan =
      getSoapSection("Plan");

    expect(
      subjective.field,
    ).not.toHaveAttribute("readonly");

    expect(
      objective.field,
    ).not.toHaveAttribute("readonly");

    expect(
      assessment.field,
    ).not.toHaveAttribute("readonly");

    expect(
      plan.field,
    ).not.toHaveAttribute("readonly");

    /*
     * Change only Subjective.
     */
    fireEvent.change(
      subjective.field,
      {
        target: {
          value:
            "Updated subjective content.",
        },
      },
    );

    expect(
      subjective.field,
    ).toHaveValue(
      "Updated subjective content.",
    );

    expect(
      within(
        subjective.section,
      ).getByText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();

    expect(
      within(
        objective.section,
      ).queryByText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();

    expect(
      within(
        assessment.section,
      ).queryByText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();

    expect(
      within(
        plan.section,
      ).queryByText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();

    fireEvent.change(
      plan.field,
      {
        target: {
          value:
            "Updated plan content.",
        },
      },
    );

    expect(
      plan.field,
    ).toHaveValue(
      "Updated plan content.",
    );

    expect(
      within(
        subjective.section,
      ).getByText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();

    expect(
      within(
        plan.section,
      ).getByText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();

    fireEvent.change(
      subjective.field,
      {
        target: {
          value:
            "Original subjective content.",
        },
      },
    );

    expect(
      subjective.field,
    ).toHaveValue(
      "Original subjective content.",
    );

    expect(
      within(
        subjective.section,
      ).queryByText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();

    expect(
      within(
        plan.section,
      ).getByText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();
  });

  it("can mark all four SOAP sections dirty independently", () => {
    render(
      <NoteDetailWorkspace
        detail={createNoteDetail()}
        actor={actor}
      />,
    );

    const subjective =
      getSoapSection("Subjective");

    const objective =
      getSoapSection("Objective");

    const assessment =
      getSoapSection("Assessment");

    const plan =
      getSoapSection("Plan");

    fireEvent.change(
      subjective.field,
      {
        target: {
          value:
            "Updated subjective.",
        },
      },
    );

    fireEvent.change(
      objective.field,
      {
        target: {
          value:
            "Updated objective.",
        },
      },
    );

    fireEvent.change(
      assessment.field,
      {
        target: {
          value:
            "Updated assessment.",
        },
      },
    );

    fireEvent.change(
      plan.field,
      {
        target: {
          value:
            "Updated plan.",
        },
      },
    );

    expect(
      screen.getAllByText(
        "Unsaved changes",
      ),
    ).toHaveLength(4);
  });

  it("keeps SOAP sections read-only when the note is not in review", () => {
    render(
      <NoteDetailWorkspace
        detail={createNoteDetail(
          "READY_FOR_REVIEW",
        )}
        actor={actor}
      />,
    );

    const subjective =
      getSoapSection("Subjective");

    const objective =
      getSoapSection("Objective");

    const assessment =
      getSoapSection("Assessment");

    const plan =
      getSoapSection("Plan");

    expect(
      subjective.field,
    ).toHaveAttribute("readonly");

    expect(
      objective.field,
    ).toHaveAttribute("readonly");

    expect(
      assessment.field,
    ).toHaveAttribute("readonly");

    expect(
      plan.field,
    ).toHaveAttribute("readonly");

    expect(
      screen.getByText("Read only"),
    ).toBeInTheDocument();

    fireEvent.change(
      subjective.field,
      {
        target: {
          value:
            "Attempted edit.",
        },
      },
    );

    expect(
      subjective.field,
    ).toHaveValue(
      "Original subjective content.",
    );

    expect(
      screen.queryByText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();
  });
});