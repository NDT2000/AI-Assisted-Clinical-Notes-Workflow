import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
} from "react-router-dom";
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

vi.mock("../../hooks/useNoteDetail", () => ({
  useNoteDetail: vi.fn(),
}));

import { useNoteDetail } from "../../hooks/useNoteDetail";
import { NoteDetailPage } from "../../pages/NoteDetailPage";

const useNoteDetailMock =
  vi.mocked(useNoteDetail);

const retryMock = vi.fn();

function createNoteDetail(): NoteDetail {
  const firstVersion: NoteVersionDetail = {
    versionId: "version-1",
    noteId: "note-1",
    revisionNumber: 1,
    parentVersionId: null,

    content: {
      subjective: "Patient reports pain.",
      objective: "Vital signs are stable.",
      assessment:
        "Initial clinical assessment.",
      plan: "Begin treatment.",
    },

    authorId: "clinician-1",
    authorRole: "CLINICIAN",
    authorDisplayName:
      "Dr. Maya Brooks",
    createdAt:
      "2026-07-29T10:00:00.000Z",
  };

  const currentVersion: NoteVersionDetail = {
    versionId: "version-2",
    noteId: "note-1",
    revisionNumber: 2,
    parentVersionId: "version-1",

    content: {
      subjective:
        "Patient reports reduced pain.",
      objective:
        "Vital signs remain stable.",
      assessment:
        "Symptoms are improving.",
      plan:
        "Continue treatment and follow up.",
    },

    authorId: "reviewer-1",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Alex Reviewer",
    createdAt:
      "2026-07-29T10:30:00.000Z",
  };

  return {
    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId: "version-2",
      assignedReviewerId:
        "reviewer-1",
      createdAt:
        "2026-07-29T09:45:00.000Z",
      updatedAt:
        "2026-07-29T10:30:00.000Z",
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

    versions: [
      firstVersion,
      currentVersion,
    ],

    presence: [
      {
        user: {
          id: "reviewer-1",
          displayName:
            "Alex Reviewer",
          role: "REVIEWER",
        },
        activity: "EDITING",
        lastSeenAt:
          "2026-07-29T10:31:00.000Z",
      },
    ],

    timeline: [
      {
        eventId: "event-1",
        noteId: "note-1",
        versionId: "version-1",
        fromStatus: "GENERATING",
        toStatus:
          "READY_FOR_REVIEW",
        actorId: "clinician-1",
        actorRole: "CLINICIAN",
        actorDisplayName:
          "Dr. Maya Brooks",
        occurredAt:
          "2026-07-29T10:00:00.000Z",
      },
      {
        eventId: "event-2",
        noteId: "note-1",
        versionId: "version-2",
        fromStatus:
          "READY_FOR_REVIEW",
        toStatus: "IN_REVIEW",
        actorId: "reviewer-1",
        actorRole: "REVIEWER",
        actorDisplayName:
          "Alex Reviewer",
        occurredAt:
          "2026-07-29T10:30:00.000Z",
      },
    ],
  };
}

function renderPage(): void {
  render(
    <MemoryRouter
      initialEntries={[
        "/notes/note-1",
      ]}
    >
      <Routes>
        <Route
          path="/notes/:noteId"
          element={<NoteDetailPage />}
        />

        <Route
          path="/notes"
          element={<div>Notes list</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NoteDetailPage", () => {
  beforeEach(() => {
    useNoteDetailMock.mockReset();
    retryMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the loading state", () => {
    useNoteDetailMock.mockReturnValue({
      state: {
        status: "loading",
        note: null,
        message: null,
      },
      retry: retryMock,
    });

    renderPage();

    expect(
      screen.getByRole("status"),
    ).toHaveTextContent(
      "Loading note details",
    );
  });

  it("renders the unauthorized state", () => {
    useNoteDetailMock.mockReturnValue({
      state: {
        status: "unauthorized",
        note: null,
        message:
          "You are not authorized to view this note.",
      },
      retry: retryMock,
    });

    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Access denied",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent(
      "You are not authorized to view this note.",
    );
  });

  it("renders the not-found state", () => {
    useNoteDetailMock.mockReturnValue({
      state: {
        status: "not-found",
        note: null,
        message:
          "Note note-1 was not found.",
      },
      retry: retryMock,
    });

    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Note not found",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent(
      "Note note-1 was not found.",
    );
  });

  it("renders the error state and retries", () => {
    useNoteDetailMock.mockReturnValue({
      state: {
        status: "error",
        note: null,
        message:
          "Simulated network failure.",
      },
      retry: retryMock,
    });

    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Unable to load note",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent(
      "Simulated network failure.",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Try again",
      }),
    );

    expect(
      retryMock,
    ).toHaveBeenCalledTimes(1);
  });

  it("renders the complete note detail layout", () => {
    const note = createNoteDetail();

    useNoteDetailMock.mockReturnValue({
      state: {
        status: "success",
        note,
        message: null,
      },
      retry: retryMock,
    });

    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Patient One",
        level: 1,
      }),
    ).toBeInTheDocument();

    /*
     * "In Review" appears in the page header
     * and in the review timeline.
     */
    expect(
      screen.getAllByText("In Review"),
    ).toHaveLength(2);

    const patientSessionSection = screen
      .getByRole("heading", {
        name: "Patient and session",
      })
      .closest("section");

    expect(
      patientSessionSection,
    ).not.toBeNull();

    /*
     * The MRN is also shown in the page header.
     * Scope this query to the patient/session card.
     */
    expect(
      within(
        patientSessionSection!,
      ).getByText("MRN-0000001"),
    ).toBeInTheDocument();

    expect(
      within(
        patientSessionSection!,
      ).getByText(
        "Dr. Maya Brooks",
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", {
        name: "SOAP note",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByDisplayValue(
        "Patient reports reduced pain.",
      ),
    ).toHaveAttribute("readonly");

    expect(
      screen.getByDisplayValue(
        "Vital signs remain stable.",
      ),
    ).toHaveAttribute("readonly");

    expect(
      screen.getByDisplayValue(
        "Symptoms are improving.",
      ),
    ).toHaveAttribute("readonly");

    expect(
      screen.getByDisplayValue(
        "Continue treatment and follow up.",
      ),
    ).toHaveAttribute("readonly");

    const presenceSection = screen
      .getByRole("heading", {
        name: "Presence",
      })
      .closest("section");

    expect(
      presenceSection,
    ).not.toBeNull();

    expect(
      within(
        presenceSection!,
      ).getByText("Editing"),
    ).toBeInTheDocument();

    expect(
      within(
        presenceSection!,
      ).getByText(
        "Alex Reviewer",
      ),
    ).toBeInTheDocument();

    const versionHistorySection = screen
      .getByRole("heading", {
        name: "Version history",
      })
      .closest("section");

    expect(
      versionHistorySection,
    ).not.toBeNull();

    expect(
      within(
        versionHistorySection!,
      ).getByText("Revision 2"),
    ).toBeInTheDocument();

    expect(
      within(
        versionHistorySection!,
      ).getByText("Current"),
    ).toBeInTheDocument();

    expect(
      within(
        versionHistorySection!,
      ).getByText("Revision 1"),
    ).toBeInTheDocument();

    expect(
      within(
        versionHistorySection!,
      ).getByText(
        "Dr. Maya Brooks",
      ),
    ).toBeInTheDocument();

    const timelineSection = screen
      .getByRole("heading", {
        name: "Review timeline",
      })
      .closest("section");

    expect(
      timelineSection,
    ).not.toBeNull();

    /*
     * Ready For Review is the destination
     * of the first event and the source
     * of the second event.
     */
    expect(
      within(
        timelineSection!,
      ).getAllByText(
        "Ready For Review",
      ),
    ).toHaveLength(2);

    expect(
      within(
        timelineSection!,
      ).getByText("Generating"),
    ).toBeInTheDocument();

    expect(
      within(
        timelineSection!,
      ).getByText("In Review"),
    ).toBeInTheDocument();
  });

  it("renders empty presence and timeline states", () => {
    const note = createNoteDetail();

    useNoteDetailMock.mockReturnValue({
      state: {
        status: "success",
        note: {
          ...note,
          presence: [],
          timeline: [],
        },
        message: null,
      },
      retry: retryMock,
    });

    renderPage();

    const presenceSection = screen
      .getByRole("heading", {
        name: "Presence",
      })
      .closest("section");

    expect(
      presenceSection,
    ).not.toBeNull();

    expect(
      within(
        presenceSection!,
      ).getByText(
        /No other users are currently active/i,
      ),
    ).toBeInTheDocument();

    const timelineSection = screen
      .getByRole("heading", {
        name: "Review timeline",
      })
      .closest("section");

    expect(
      timelineSection,
    ).not.toBeNull();

    expect(
      within(
        timelineSection!,
      ).getByText(
        /No workflow events have been recorded/i,
      ),
    ).toBeInTheDocument();
  });
});