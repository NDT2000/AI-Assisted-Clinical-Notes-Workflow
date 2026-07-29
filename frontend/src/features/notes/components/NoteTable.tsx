import type { NoteSummary } from "../../../domain/noteSummary";
import { Link } from "react-router-dom";

interface NotesTableProps {
  notes: NoteSummary[];
}

export function NotesTable({
  notes,
}: NotesTableProps) {
  return (
    <table>
      <thead>
        <tr>
          <th>Patient</th>
          <th>Status</th>
          <th>Assigned reviewer</th>
          <th>Revision</th>
          <th>Updated time</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        {notes.map((note) => (
          <tr key={note.id}>
            <td>
              {note.patient.displayName}
            </td>

            <td>
              {note.status}
            </td>

            <td>
              {note.assignedReviewer?.displayName ??
                "Unassigned"}
            </td>

            <td>
              {note.currentVersion.revision}
            </td>

            <td>
              {new Date(
                note.updatedAt,
              ).toLocaleString()}
            </td>

            <td>
              <Link to={`/notes/${note.id}`}>
                Open
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}