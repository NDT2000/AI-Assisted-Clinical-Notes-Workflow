import {
  useState,
} from "react";

import type {
  Reviewer,
} from "../../../../domain/reviewers";
import {
  useReviewers,
} from "../../../users/reviewerDirectory";

interface BulkActionBarProps {
  selectedCount: number;
  eligibleForRegenerationCount: number;
  ineligibleForRegenerationCount: number;
  isBusy: boolean;
  error: string | null;
  onAssignReviewer: (
    reviewer: Reviewer | null,
  ) => void;
  onRegenerate: () => void;
  onClearSelection: () => void;
}

export function BulkActionBar({
  selectedCount,
  eligibleForRegenerationCount,
  ineligibleForRegenerationCount,
  isBusy,
  error,
  onAssignReviewer,
  onRegenerate,
  onClearSelection,
}: BulkActionBarProps) {
  const reviewers = useReviewers();

  const [
    selectedReviewerId,
    setSelectedReviewerId,
  ] = useState("");

  function handleAssignClick() {
    const reviewer =
      reviewers.find(
        candidate =>
          candidate.id ===
          selectedReviewerId,
      ) ?? null;

    onAssignReviewer(reviewer);
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
    >
      <p>{selectedCount} selected</p>

      <select
        aria-label="Reviewer to assign"
        value={selectedReviewerId}
        onChange={event =>
          setSelectedReviewerId(
            event.target.value,
          )
        }
        disabled={isBusy}
      >
        <option value="">
          Choose reviewer…
        </option>

        {reviewers.map(reviewer => (
          <option
            key={reviewer.id}
            value={reviewer.id}
          >
            {reviewer.displayName}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={handleAssignClick}
        disabled={
          isBusy ||
          selectedReviewerId === ""
        }
      >
        Assign reviewer
      </button>

      <button
        type="button"
        onClick={onRegenerate}
        disabled={
          isBusy ||
          eligibleForRegenerationCount ===
            0
        }
        title={
          eligibleForRegenerationCount ===
          0
            ? "Only FAILED notes are eligible for regeneration."
            : undefined
        }
      >
        Request regeneration (
        {eligibleForRegenerationCount})
      </button>

      {ineligibleForRegenerationCount >
        0 && (
        <p>
          {
            ineligibleForRegenerationCount
          }{" "}
          selected note
          {ineligibleForRegenerationCount ===
          1
            ? ""
            : "s"}{" "}
          not eligible for regeneration
          (not FAILED).
        </p>
      )}

      <button
        type="button"
        onClick={onClearSelection}
        disabled={isBusy}
      >
        Clear selection
      </button>

      {error !== null && (
        <p role="alert">{error}</p>
      )}
    </div>
  );
}
