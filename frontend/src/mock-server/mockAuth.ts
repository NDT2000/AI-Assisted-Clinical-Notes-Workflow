import type { Actor } from "../domain/actor";
import type { UserRole } from "../domain/noteAttributes";

/*
 * Stand-in access tokens for the mock server. A token simply carries the
 * actor, so handlers know who is asking, as the real API learns it from a
 * signed token. Unsigned: for the in-browser mock and tests only.
 */

const TOKEN_PREFIX = "mock.";

const USER_ROLES: readonly UserRole[] = [
  "CLINICIAN",
  "REVIEWER",
  "ADMIN",
  "READONLY_AUDITOR",
];

export function createMockToken(actor: Actor): string {
  return (
    TOKEN_PREFIX +
    btoa(encodeURIComponent(JSON.stringify(actor)))
  );
}

/* Headers for calling the mock handlers directly, as in tests. */
export function mockAuthHeaders(
  actor: Actor,
): Record<string, string> {
  return {
    authorization: `Bearer ${createMockToken(actor)}`,
  };
}

function isActor(value: unknown): value is Actor {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.displayName === "string" &&
    candidate.displayName.trim().length > 0 &&
    USER_ROLES.includes(candidate.role as UserRole) &&
    (candidate.mfaVerified === undefined ||
      typeof candidate.mfaVerified === "boolean")
  );
}

/* The actor a request's bearer token carries, or null. */
export function getMockActor(request: Request): Actor | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer mock\.(.+)$/.exec(authorization);

  if (match === null) {
    return null;
  }

  try {
    const decoded: unknown = JSON.parse(
      decodeURIComponent(atob(match[1])),
    );

    return isActor(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
