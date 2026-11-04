import type {
  Actor,
} from "../domain/actor";
import type {
  UserRole,
} from "../domain/noteAttributes";
import {
  REVIEWERS,
} from "../domain/reviewers";

const CLINICIAN_ACTOR:
  Actor = {
    id: "clinician-1",
    displayName: "Dr. Maya Brooks",
    role: "CLINICIAN",
  };

const REVIEWER_ACTORS:
  Actor[] =
    REVIEWERS.map((reviewer) => ({
      id: reviewer.id,
      displayName:
        reviewer.displayName,
      role: "REVIEWER",
      mfaVerified: true,
    }));

const DEFAULT_REVIEWER_ACTOR:
  Actor =
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
  Actor = {
    id: "admin-1",
    displayName:
      "Jordan Lee",
    role: "ADMIN",
    mfaVerified: true,
  };

const AUDITOR_ACTOR:
  Actor = {
    id: "auditor-1",
    displayName:
      "Taylor Morgan",
    role:
      "READONLY_AUDITOR",
  };

export const DEMO_ACTORS:
  readonly Actor[] = [
    CLINICIAN_ACTOR,
    ...REVIEWER_ACTORS,
    ADMIN_ACTOR,
    AUDITOR_ACTOR,
  ];

export const MOCK_ACTORS:
  Record<
    UserRole,
    Actor
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
): Actor | null {
  return (
    DEMO_ACTORS.find(
      (actor) =>
        actor.id === actorId,
    ) ?? null
  );
}
