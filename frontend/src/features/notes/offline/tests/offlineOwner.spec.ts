import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claimOfflineStorage,
  releaseOfflineStorage,
} from "../offlineOwner";

describe("offline storage ownership", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("clears what another user left before the next one uses it", async () => {
    const clear = vi.fn().mockResolvedValue(undefined);

    expect(await claimOfflineStorage("clinician-1", clear)).toBe(true);
    expect(await claimOfflineStorage("clinician-1", clear)).toBe(false);
    expect(clear).toHaveBeenCalledTimes(1);

    expect(await claimOfflineStorage("reviewer-1", clear)).toBe(true);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("clears and forgets the owner on sign-out", async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    await claimOfflineStorage("clinician-1", clear);

    await releaseOfflineStorage(clear);

    expect(clear).toHaveBeenCalledTimes(2);
    // The same user signing in again starts from cleared storage too.
    expect(await claimOfflineStorage("clinician-1", clear)).toBe(true);
  });
});
