import type { Note, } from "../../../../domain/noteAttributes";
import type { PatientInformation, UserSummary, } from "../../../../domain/noteDetail";
import {
  formatNoteStatus,
} from "../../../../shared/formatters";

interface NoteDetailHeaderProps {
  note: Note;
  patient: PatientInformation;
  assignedReviewer: UserSummary | null;
  revisionNumber: number;
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
          {formatNoteStatus(note.status)}
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