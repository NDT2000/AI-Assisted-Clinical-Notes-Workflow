import type {
  UserRole,
} from "../domain/noteAttributes";
import type {
  TransitionNoteActor,
} from "../domain/noteTransition";

export const MOCK_ACTORS:
  Record<
    UserRole,
    TransitionNoteActor
  > = {
  CLINICIAN: {
    id: "clinician-1",
    displayName:
      "Current Clinician",
    role: "CLINICIAN",
  },

  REVIEWER: {
    id: "reviewer-1",
    displayName:
      "Current Reviewer",
    role: "REVIEWER",
    mfaVerified: true,
  },

  ADMIN: {
    id: "admin-1",
    displayName:
      "Current Administrator",
    role: "ADMIN",
    mfaVerified: true,
  },

  READONLY_AUDITOR: {
    id: "auditor-1",
    displayName:
      "Current Auditor",
    role:
      "READONLY_AUDITOR",
  },
};

export const CURRENT_ACTOR =
  MOCK_ACTORS.REVIEWER;
