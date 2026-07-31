import type {
  Note,
  SoapContent,
  UserRole,
} from "./noteAttributes";
import type {
  NoteVersionDetail,
} from "./noteDetail";

export interface SaveNoteVersionActor {
  id: string;
  displayName: string;
  role: UserRole;
}

export interface SaveNoteVersionRequestBody {
  baseVersionId: string;

  clientMutationId: string;

  content: SoapContent;
}

export interface SaveNoteVersionResponse {
  clientMutationId: string;
  note: Note;
  savedVersion: NoteVersionDetail;
}

export type SaveNoteVersionErrorCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "version_conflict"
  | "internal_error";

export interface SaveNoteVersionStandardErrorResponse {
  error: Exclude<
    SaveNoteVersionErrorCode,
    "version_conflict"
  >;
  message: string;
}

export interface SaveNoteVersionConflictResponse {
  error: "version_conflict";
  message: string;
  currentVersion: NoteVersionDetail;
}

export type SaveNoteVersionErrorResponse =
  | SaveNoteVersionStandardErrorResponse
  | SaveNoteVersionConflictResponse;