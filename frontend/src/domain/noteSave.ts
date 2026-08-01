import type { Note, SoapContent, UserRole, } from "./noteAttributes";
import type { NoteVersionDetail, } from "./noteDetail";

// The basic template for saving information abou the person handling the version save request
export interface SaveNoteVersionActor {
  id: string;
  displayName: string;
  role: UserRole;
}

// The request body for saving a note version.
export interface SaveNoteVersionRequestBody {
  baseVersionId: string;

  clientMutationId: string;

  content: SoapContent;
}

// The basic template for a successful saving of a note version.
export interface SaveNoteVersionResponse {
  clientMutationId: string;
  note: Note;
  savedVersion: NoteVersionDetail;
}

// Possible error codes for saving a note version.
export type SaveNoteVersionErrorCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "version_conflict"
  | "idempotency_conflict"
  | "internal_error";

// the basic template for a standard error response.
export interface SaveNoteVersionStandardErrorResponse {
  error: Exclude<
    SaveNoteVersionErrorCode,
    "version_conflict"
  >;
  message: string;
}

// the basic template for a version confict response.
export interface SaveNoteVersionConflictResponse {
  error: "version_conflict";
  message: string;
  currentVersion: NoteVersionDetail;
}

// The possible values of response if saving of note version is unsuccessful.
export type SaveNoteVersionErrorResponse =
  | SaveNoteVersionStandardErrorResponse
  | SaveNoteVersionConflictResponse;