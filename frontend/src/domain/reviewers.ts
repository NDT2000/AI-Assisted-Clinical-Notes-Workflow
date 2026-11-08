/*
 * Someone who can be assigned notes to review. The list comes from the
 * API's user directory (features/users/useReviewers.ts).
 */
export interface Reviewer {
  id: string;
  displayName: string;
}
