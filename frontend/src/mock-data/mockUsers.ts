import type { Actor } from "../domain/actor";
import type { UserRole } from "../domain/noteAttributes";
import type { Reviewer } from "../domain/reviewers";

/*
 * The synthetic users of the mock server and tests. They match the
 * backend's seeded users, so a user id means the same person in both.
 */

export const MOCK_REVIEWERS: readonly Reviewer[] = [
  { id: "reviewer-1", displayName: "Alex Kim" },
  { id: "reviewer-2", displayName: "Sam Rivera" },
  { id: "reviewer-3", displayName: "Drew Patel" },
  { id: "reviewer-4", displayName: "Robin Chen" },
  { id: "reviewer-5", displayName: "Jules Martin" },
];

const CLINICIAN: Actor = {
  id: "clinician-1",
  displayName: "Dr. Maya Brooks",
  role: "CLINICIAN",
};

const REVIEWERS: Actor[] = MOCK_REVIEWERS.map((reviewer) => ({
  ...reviewer,
  role: "REVIEWER",
  mfaVerified: true,
}));

const ADMIN: Actor = {
  id: "admin-1",
  displayName: "Jordan Lee",
  role: "ADMIN",
  mfaVerified: true,
};

const AUDITOR: Actor = {
  id: "auditor-1",
  displayName: "Taylor Morgan",
  role: "READONLY_AUDITOR",
};

export const MOCK_USERS: readonly Actor[] = [
  CLINICIAN,
  ...REVIEWERS,
  ADMIN,
  AUDITOR,
];

/* One user per role; tests are signed in as the reviewer by default. */
export const MOCK_ACTORS: Record<UserRole, Actor> = {
  CLINICIAN,
  REVIEWER: REVIEWERS[0],
  ADMIN,
  READONLY_AUDITOR: AUDITOR,
};
