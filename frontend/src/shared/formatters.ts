import type {
  NoteStatus,
  UserRole,
} from "../domain/noteAttributes";

/* "READY_FOR_REVIEW" → "Ready For Review" */
export function formatNoteStatus(
  status: NoteStatus,
): string {
  return status
    .toLowerCase()
    .split("_")
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(" ");
}

export function formatRole(
  role: UserRole,
): string {
  switch (role) {
    case "CLINICIAN":
      return "Clinician";
    case "REVIEWER":
      return "Reviewer";
    case "ADMIN":
      return "Administrator";
    case "READONLY_AUDITOR":
      return "Read-only auditor";
  }
}

/* An ISO timestamp in the viewer's locale and time zone. */
export function formatDateTime(
  value: string,
): string {
  return new Date(
    value,
  ).toLocaleString();
}
