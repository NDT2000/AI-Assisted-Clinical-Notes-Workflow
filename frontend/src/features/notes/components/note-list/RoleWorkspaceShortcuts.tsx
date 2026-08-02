import type {
  NoteStatus,
} from "../../../../domain/noteAttributes";
import type {
  TransitionNoteActor,
} from "../../../../domain/noteTransition";
import "./RoleWorkspaceShortcuts.css";

interface WorkspaceView {
  id: string;
  label: string;
  description: string;
  statuses: NoteStatus[];
  reviewerId: string;
}

interface RoleWorkspaceShortcutsProps {
  actor: TransitionNoteActor;
  activeStatuses: NoteStatus[];
  activeReviewerId: string;
  onApplyView: (
    statuses: NoteStatus[],
    reviewerId: string,
  ) => void;
}

function getWorkspaceTitle(
  actor: TransitionNoteActor,
): string {
  switch (actor.role) {
    case "CLINICIAN":
      return "Clinician workspace";
    case "REVIEWER":
      return "Reviewer workspace";
    case "ADMIN":
      return "Administrator workspace";
    case "READONLY_AUDITOR":
      return "Auditor workspace";
  }
}

function getWorkspaceDescription(
  actor: TransitionNoteActor,
): string {
  switch (actor.role) {
    case "CLINICIAN":
      return "Find notes that can be corrected, resubmitted, or regenerated.";
    case "REVIEWER":
      return "Find notes that can be started or are already assigned to you.";
    case "ADMIN":
      return "Find notes that need assignment, regeneration, or active review.";
    case "READONLY_AUDITOR":
      return "Review notes and history without changing clinical content.";
  }
}

function getWorkspaceViews(
  actor: TransitionNoteActor,
): WorkspaceView[] {
  switch (actor.role) {
    case "CLINICIAN":
      return [
        {
          id: "rejected",
          label: "Rejected notes",
          description:
            "Notes available for correction and resubmission.",
          statuses: ["REJECTED"],
          reviewerId: "",
        },
        {
          id: "failed",
          label: "Failed generation",
          description:
            "Failed notes that may be regenerated.",
          statuses: ["FAILED"],
          reviewerId: "",
        },
        {
          id: "amended",
          label: "Amendments",
          description:
            "Amended notes that may need clinical changes.",
          statuses: ["AMENDED"],
          reviewerId: "",
        },
      ];

    case "REVIEWER":
      return [
        {
          id: "ready",
          label: "Ready to review",
          description:
            "Notes that can be started by a reviewer.",
          statuses: [
            "READY_FOR_REVIEW",
            "AMENDED",
          ],
          reviewerId: "",
        },
        {
          id: "assigned",
          label: "Assigned to me",
          description:
            "Notes assigned to the selected reviewer.",
          statuses: [],
          reviewerId: actor.id,
        },
        {
          id: "editable",
          label: "My editable notes",
          description:
            "In-review notes assigned to the selected reviewer.",
          statuses: ["IN_REVIEW"],
          reviewerId: actor.id,
        },
      ];

    case "ADMIN":
      return [
        {
          id: "ready",
          label: "Ready or amended",
          description:
            "Notes where reviewer assignment may be managed.",
          statuses: [
            "READY_FOR_REVIEW",
            "AMENDED",
          ],
          reviewerId: "",
        },
        {
          id: "failed",
          label: "Failed notes",
          description:
            "Failed notes that may be regenerated.",
          statuses: ["FAILED"],
          reviewerId: "",
        },
        {
          id: "active",
          label: "Active review",
          description:
            "Notes currently being reviewed.",
          statuses: ["IN_REVIEW"],
          reviewerId: "",
        },
      ];

    case "READONLY_AUDITOR":
      return [
        {
          id: "approved",
          label: "Approved notes",
          description:
            "Approved notes available for read-only review.",
          statuses: ["APPROVED"],
          reviewerId: "",
        },
        {
          id: "locked",
          label: "Locked notes",
          description:
            "Final locked notes available for audit.",
          statuses: ["LOCKED"],
          reviewerId: "",
        },
        {
          id: "all",
          label: "All notes",
          description:
            "Review the complete notes list.",
          statuses: [],
          reviewerId: "",
        },
      ];
  }
}

function haveSameStatuses(
  first: NoteStatus[],
  second: NoteStatus[],
): boolean {
  if (first.length !== second.length) {
    return false;
  }

  const secondSet =
    new Set(second);

  return first.every((status) =>
    secondSet.has(status),
  );
}

export function RoleWorkspaceShortcuts({
  actor,
  activeStatuses,
  activeReviewerId,
  onApplyView,
}: RoleWorkspaceShortcutsProps) {
  const views =
    getWorkspaceViews(actor);

  return (
    <section
      className="role-workspace"
      aria-labelledby="role-workspace-title"
    >
      <div className="role-workspace__heading">
        <div>
          <p className="role-workspace__eyebrow">
            Viewing as {actor.displayName}
          </p>

          <h2 id="role-workspace-title">
            {getWorkspaceTitle(actor)}
          </h2>

          <p>
            {getWorkspaceDescription(actor)}
          </p>
        </div>

        <button
          className="role-workspace__clear"
          type="button"
          onClick={() =>
            onApplyView([], "")
          }
          disabled={
            activeStatuses.length === 0 &&
            activeReviewerId === ""
          }
        >
          Show all notes
        </button>
      </div>

      <div
        className="role-workspace__views"
        aria-label="Workspace shortcuts"
      >
        {views.map((view) => {
          const isActive =
            haveSameStatuses(
              activeStatuses,
              view.statuses,
            ) &&
            activeReviewerId ===
              view.reviewerId;

          return (
            <button
              key={view.id}
              className="role-workspace__view"
              type="button"
              aria-pressed={isActive}
              onClick={() =>
                onApplyView(
                  view.statuses,
                  view.reviewerId,
                )
              }
            >
              <strong>
                {view.label}
              </strong>

              <span>
                {view.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
