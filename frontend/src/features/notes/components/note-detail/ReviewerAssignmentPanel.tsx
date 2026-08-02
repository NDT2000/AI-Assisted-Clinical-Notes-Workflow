import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  NoteStatus,
} from "../../../../domain/noteAttributes";
import type {
  TransitionNoteActor,
} from "../../../../domain/noteTransition";
import {
  REVIEWERS,
} from "../../../../mock-data/generateNoteSummary";
import {
  postAssignReviewer,
} from "../../api/bulkActions";
import "./ReviewerAssignmentPanel.css";

export interface ReviewerAssignmentValue {
  id: string;
  displayName: string;
  role: "REVIEWER";
}

interface ReviewerAssignmentPanelProps {
  noteId: string;
  status: NoteStatus;
  actor: TransitionNoteActor;
  assignedReviewer:
    ReviewerAssignmentValue | null;
  onAssigned: (
    reviewer:
      ReviewerAssignmentValue | null,
  ) => void;
}

function getDisabledReason(
  status: NoteStatus,
): string | null {
  switch (status) {
    case "READY_FOR_REVIEW":
    case "AMENDED":
      return null;

    case "GENERATING":
      return "Generation is still in progress. Assignment becomes available after the note reaches Ready for Review.";

    case "FAILED":
      return "Regenerate the note before assigning a reviewer.";

    case "IN_REVIEW":
      return "Return the note to the review queue before changing reviewer ownership.";

    case "REJECTED":
      return "A clinician must correct and resubmit the note before reviewer assignment.";

    case "APPROVED":
      return "Approved notes do not have an active reviewer assignment.";

    case "LOCKED":
      return "Locked notes are final and cannot be reassigned.";
  }
}

export function ReviewerAssignmentPanel({
  noteId,
  status,
  actor,
  assignedReviewer,
  onAssigned,
}: ReviewerAssignmentPanelProps) {
  const [
    selectedReviewerId,
    setSelectedReviewerId,
  ] = useState(
    assignedReviewer?.id ?? "",
  );

  const [isSaving, setIsSaving] =
    useState(false);

  const [message, setMessage] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    setSelectedReviewerId(
      assignedReviewer?.id ?? "",
    );
  }, [assignedReviewer]);

  const disabledReason =
    getDisabledReason(status);

  const selectedReviewer =
    useMemo(
      () =>
        REVIEWERS.find(
          (reviewer) =>
            reviewer.id ===
            selectedReviewerId,
        ) ?? null,
      [selectedReviewerId],
    );

  if (actor.role !== "ADMIN") {
    return null;
  }

  const currentReviewerId =
    assignedReviewer?.id ?? "";

  const hasChanged =
    selectedReviewerId !==
    currentReviewerId;

  async function handleSave() {
    if (
      disabledReason !== null ||
      !hasChanged ||
      isSaving
    ) {
      return;
    }

    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response =
        await postAssignReviewer(
          [noteId],
          selectedReviewer,
          actor,
        );

      if (
        !response.updated.includes(
          noteId,
        )
      ) {
        throw new Error(
          "The server did not permit reviewer assignment for this note.",
        );
      }

      const nextReviewer =
        selectedReviewer === null
          ? null
          : {
              ...selectedReviewer,
              role:
                "REVIEWER" as const,
            };

      onAssigned(nextReviewer);

      setMessage(
        nextReviewer === null
          ? "Reviewer assignment removed."
          : `${nextReviewer.displayName} is now assigned to this note.`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update reviewer assignment.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      className="reviewer-assignment-panel"
      aria-labelledby="reviewer-assignment-heading"
    >
      <div className="reviewer-assignment-panel__heading">
        <div>
          <p className="reviewer-assignment-panel__eyebrow">
            Administrator control
          </p>

          <h2 id="reviewer-assignment-heading">
            Reviewer assignment
          </h2>
        </div>

        <span>
          {assignedReviewer?.displayName ??
            "Unassigned"}
        </span>
      </div>

      <div className="reviewer-assignment-panel__controls">
        <div>
          <label htmlFor="detail-reviewer-assignment">
            Assigned reviewer
          </label>

          <select
            id="detail-reviewer-assignment"
            value={selectedReviewerId}
            disabled={
              disabledReason !== null ||
              isSaving
            }
            aria-describedby={
              disabledReason !== null
                ? "reviewer-assignment-disabled-reason"
                : undefined
            }
            onChange={(event) => {
              setSelectedReviewerId(
                event.target.value,
              );
              setMessage(null);
              setError(null);
            }}
          >
            <option value="">
              Unassigned
            </option>

            {REVIEWERS.map(
              (reviewer) => (
                <option
                  key={reviewer.id}
                  value={reviewer.id}
                >
                  {
                    reviewer.displayName
                  }
                </option>
              ),
            )}
          </select>
        </div>

        <button
          type="button"
          disabled={
            disabledReason !== null ||
            !hasChanged ||
            isSaving
          }
          onClick={() =>
            void handleSave()
          }
        >
          {isSaving
            ? "Updating…"
            : "Update assignment"}
        </button>
      </div>

      {disabledReason !== null && (
        <p
          id="reviewer-assignment-disabled-reason"
          className="reviewer-assignment-panel__reason"
        >
          {disabledReason}
        </p>
      )}

      {message !== null && (
        <p
          className="reviewer-assignment-panel__success"
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      )}

      {error !== null && (
        <p
          className="reviewer-assignment-panel__error"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}
