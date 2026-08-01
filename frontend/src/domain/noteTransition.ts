import type { Note, Trigger, UserRole, } from "./noteAttributes";
import type { NoteVersionDetail, ReviewTimelineEvent, } from "./noteDetail";

export const USER_NOTE_ACTION_TRIGGERS = [
  "REGENERATE",
  "START_REVIEW",
  "RETURN_TO_QUEUE",
  "APPROVE",
  "REJECT",
  "RESUBMIT",
  "AMEND",
] as const satisfies readonly Trigger[];

export type UserNoteActionTrigger =
  (typeof USER_NOTE_ACTION_TRIGGERS)[number];

export interface TransitionNoteActor {
  id: string;
  displayName: string;
  role: UserRole;
  mfaVerified?: boolean;
}

export interface TransitionNoteCommand {
  baseVersionId: string;
  trigger: UserNoteActionTrigger;
  rejectionReason?: string;
}

export interface TransitionNoteRequestBody extends TransitionNoteCommand {
  clientMutationId: string;
}

export interface TransitionNoteResponse {
  clientMutationId: string;
  note: Note;
  timelineEvent: ReviewTimelineEvent;
  currentVersion: NoteVersionDetail;
}

export type TransitionNoteErrorCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "version_conflict"
  | "idempotency_conflict"
  | "transition_not_allowed"
  | "internal_error";

export interface TransitionNoteStandardErrorResponse {
  error: Exclude<
    TransitionNoteErrorCode,
    "version_conflict"
  >;
  message: string;
}

export interface TransitionNoteConflictResponse {
  error: "version_conflict";
  message: string;
  currentVersion: NoteVersionDetail;
}

export type TransitionNoteErrorResponse =
  | TransitionNoteStandardErrorResponse
  | TransitionNoteConflictResponse;