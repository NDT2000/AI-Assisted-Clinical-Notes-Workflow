import { afterEach, describe, expect, it, vi } from "vitest";

import { session } from "../../auth/session";
import { releaseOfflineStorage } from "../../features/notes/offline/offlineOwner";
import { offlineSaveReplayCoordinator } from "../../features/notes/offline/offlineSaveReplay";
import { signOutAndClear } from "../signOut";

vi.mock("../../features/notes/offline/offlineOwner", () => ({
  releaseOfflineStorage: vi.fn().mockResolvedValue(undefined),
}));

describe("signOutAndClear", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops the queue, clears offline storage, then ends the session", async () => {
    vi.stubGlobal("indexedDB", {});
    const order: string[] = [];
    vi.spyOn(offlineSaveReplayCoordinator, "stop").mockImplementation(() => {
      order.push("stop");
    });
    vi.mocked(releaseOfflineStorage).mockImplementation(async () => {
      order.push("clear");
    });
    vi.spyOn(offlineSaveReplayCoordinator, "reset").mockImplementation(() => {
      order.push("reset");
    });
    vi.spyOn(session, "signOut").mockImplementation(async () => {
      order.push("sign out");
    });

    await signOutAndClear();

    expect(order).toEqual(["stop", "clear", "reset", "sign out"]);
  });

  it("still signs out when the storage cannot be cleared", async () => {
    vi.stubGlobal("indexedDB", {});
    vi.mocked(releaseOfflineStorage).mockRejectedValueOnce(
      new Error("blocked"),
    );
    const signOut = vi.spyOn(session, "signOut").mockResolvedValue();

    await signOutAndClear();

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
