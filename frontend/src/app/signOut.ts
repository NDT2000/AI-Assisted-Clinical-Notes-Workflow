import { session } from "../auth/session";
import { releaseOfflineStorage } from "../features/notes/offline/offlineOwner";
import { offlineSaveReplayCoordinator } from "../features/notes/offline/offlineSaveReplay";

/*
 * Sign out on a possibly shared computer: stop sending queued saves, clear
 * this browser's offline notes and queue, end the session on the server,
 * and tell the other tabs.
 */
export async function signOutAndClear(): Promise<void> {
  offlineSaveReplayCoordinator.stop();

  if (typeof indexedDB !== "undefined") {
    try {
      await releaseOfflineStorage();
    } catch {
      // Signing out must not fail because the storage could not be read.
    }
  }

  offlineSaveReplayCoordinator.reset();
  await session.signOut();
}
