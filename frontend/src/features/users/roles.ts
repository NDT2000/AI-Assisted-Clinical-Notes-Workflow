import type { UserRole } from "../../domain/noteAttributes";

/* Every role, in the order the admin page lists them. */
export const ROLES: readonly UserRole[] = [
  "CLINICIAN",
  "REVIEWER",
  "ADMIN",
  "READONLY_AUDITOR",
];
