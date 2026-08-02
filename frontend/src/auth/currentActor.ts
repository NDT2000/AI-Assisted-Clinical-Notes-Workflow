import type {
  UserRole,
} from "../domain/noteAttributes";
import type {
  TransitionNoteActor,
} from "../domain/noteTransition";
import {
  REVIEWERS,
} from "../mock-data/generateNoteSummary";

const CLINICIAN_ACTOR:
  TransitionNoteActor = {
    id: "clinician-1",
    displayName: "Dr. Maya Brooks",
    role: "CLINICIAN",
  };

const REVIEWER_ACTORS:
  TransitionNoteActor[] =
    REVIEWERS.map((reviewer) => ({
      id: reviewer.id,
      displayName:
        reviewer.displayName,
      role: "REVIEWER",
      mfaVerified: true,
    }));

const DEFAULT_REVIEWER_ACTOR:
  TransitionNoteActor =
    REVIEWER_ACTORS.find(
      (actor) =>
        actor.id === "reviewer-1",
    ) ?? {
      id: "reviewer-1",
      displayName: "Alex Kim",
      role: "REVIEWER",
      mfaVerified: true,
    };

const ADMIN_ACTOR:
  TransitionNoteActor = {
    id: "admin-1",
    displayName:
      "Jordan Lee",
    role: "ADMIN",
    mfaVerified: true,
  };

const AUDITOR_ACTOR:
  TransitionNoteActor = {
    id: "auditor-1",
    displayName:
      "Taylor Morgan",
    role:
      "READONLY_AUDITOR",
  };

export const DEMO_ACTORS:
  readonly TransitionNoteActor[] = [
    CLINICIAN_ACTOR,
    ...REVIEWER_ACTORS,
    ADMIN_ACTOR,
    AUDITOR_ACTOR,
  ];

export const MOCK_ACTORS:
  Record<
    UserRole,
    TransitionNoteActor
  > = {
  CLINICIAN: CLINICIAN_ACTOR,
  REVIEWER:
    DEFAULT_REVIEWER_ACTOR,
  ADMIN: ADMIN_ACTOR,
  READONLY_AUDITOR:
    AUDITOR_ACTOR,
};

export const CURRENT_ACTOR =
  MOCK_ACTORS.REVIEWER;

export function getDemoActorById(
  actorId: string,
): TransitionNoteActor | null {
  return (
    DEMO_ACTORS.find(
      (actor) =>
        actor.id === actorId,
    ) ?? null
  );
}
