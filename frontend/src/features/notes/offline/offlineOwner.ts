import { clearOfflineStorage } from "./offlineRepository";

/*
 * The browser's offline storage (cached notes and saves waiting to be
 * sent) belongs to one user at a time. When someone else signs in on the
 * same browser, whatever the previous user left is cleared first, so it is
 * neither shown to nor sent as the new user.
 */

const OWNER_KEY = "clinical-notes-offline-owner";

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string | null): void {
  try {
    if (userId === null) {
      localStorage.removeItem(OWNER_KEY);
    } else {
      localStorage.setItem(OWNER_KEY, userId);
    }
  } catch {
    // Without localStorage the next sign-in clears the storage again,
    // which is the safe direction.
  }
}

/* Returns whether a previous user's storage was cleared. */
export async function claimOfflineStorage(
  userId: string,
  clear: () => Promise<void> = clearOfflineStorage,
): Promise<boolean> {
  const cleared = readOwner() !== userId;

  if (cleared) {
    await clear();
  }

  writeOwner(userId);
  return cleared;
}

export async function releaseOfflineStorage(
  clear: () => Promise<void> = clearOfflineStorage,
): Promise<void> {
  await clear();
  writeOwner(null);
}
