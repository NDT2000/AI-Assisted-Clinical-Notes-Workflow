import type { Note, NoteVersion, ReviewEvent, UserRole, } from "./noteAttributes";

export interface UserSummary {
  id: string;
  displayName: string;
  role: UserRole;
}

export interface PatientInformation {
  id: string;
  displayName: string;
  dateOfBirth: string;
  medicalRecordNumber: string;
}

export interface SessionInformation {
  id: string;
  startedAt: string;
  endedAt: string;
  clinician: UserSummary;
}

export type PresenceActivity =
  | "VIEWING"
  | "EDITING";

export interface PresenceUser {
  user: UserSummary;
  activity: PresenceActivity;
  lastSeenAt: string;
}

export type NoteVersionDetail =
  NoteVersion & {
    authorDisplayName: string;
  };

export type ReviewTimelineEvent =
  ReviewEvent & {
    actorDisplayName: string;
  };

export interface NoteDetail {
  note: Note;

  patient: PatientInformation;
  session: SessionInformation;

  assignedReviewer: UserSummary | null;

  currentVersion: NoteVersionDetail;
  versions: NoteVersionDetail[];

  timeline: ReviewTimelineEvent[];
  presence: PresenceUser[];
}