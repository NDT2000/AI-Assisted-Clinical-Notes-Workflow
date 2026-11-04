import type {
  UserRole,
} from "./noteAttributes";

/* The person performing an action: who they are and what they may do. */
export interface Actor {
  id: string;
  displayName: string;
  role: UserRole;
  mfaVerified?: boolean;
}
