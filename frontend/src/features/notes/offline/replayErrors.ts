import {
  SaveNoteVersionRequestError,
} from "../api/saveNoteVersion";

/*
 * Network failures and server errors may succeed on a later
 * attempt; anything else (permission, validation) will not.
 */
export function isRetryableReplayError(
  error: unknown,
): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (
    error instanceof
    SaveNoteVersionRequestError
  ) {
    return (
      error.status >= 500 ||
      error.code === "internal_error"
    );
  }

  return false;
}
