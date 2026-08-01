import type { Note, } from "../../../../domain/noteAttributes";
import type { PatientInformation, UserSummary, } from "../../../../domain/noteDetail";

interface NoteDetailHeaderProps {
  note: Note;
  patient: PatientInformation;
  assignedReviewer: UserSummary | null;
  revisionNumber: number;
}

function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1),
    )
    .join(" ");
}

export function NoteDetailHeader({
  note,
  patient,
  assignedReviewer,
  revisionNumber,
}: NoteDetailHeaderProps) {
  return (
    <header className="note-detail-header">
      <div className="note-detail-header-content">
        <h1>{patient.displayName}</h1>

        <div className="note-detail-header-meta">
          <span>
            MRN: {patient.medicalRecordNumber}
          </span>

          <span>
            Note: {note.id}
          </span>

          <span>
            Revision: {revisionNumber}
          </span>
        </div>
      </div>

      <div className="note-detail-status-area">
        <span className="note-status-badge">
          {formatStatus(note.status)}
        </span>

        <span>
          Reviewer:{" "}
          {assignedReviewer?.displayName ??
            "Unassigned"}
        </span>
      </div>
    </header>
  );
}