import { cleanup, fireEvent, render, screen, within, } from "@testing-library/react";
import { afterEach, describe, expect, it, } from "vitest";

import type { NoteDetail, NoteVersionDetail, } from "../../../../domain/noteDetail";
import { NoteDetailWorkspace } from "../note-detail/NoteDetailWorkspace";

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
  it("initially renders all SOAP sections as clean", () => {
    render(
      <NoteDetailWorkspace
        detail={createNoteDetail()}
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

    /*
     * Change Plan as well.
     */
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

    /*
     * Restore Subjective to its saved value.
     * Subjective should become clean while
     * Plan remains dirty.
     */
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

    /*
     * Even if a change event is triggered manually,
     * the controlled editor must ignore it.
     */
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