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

export interface TransitionNoteRequestBody {
  baseVersionId: string;
  trigger: UserNoteActionTrigger;
  rejectionReason?: string;
}

export interface TransitionNoteResponse {
  note: Note;
  timelineEvent: ReviewTimelineEvent;
  currentVersion: NoteVersionDetail;
}