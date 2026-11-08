import { describe, expect, it, vi } from "vitest";

import { ReviewerDirectory } from "../reviewerDirectory";

function directoryResponse(): Response {
  return new Response(
    JSON.stringify({
      users: [
        { id: "reviewer-1", displayName: "Alex Kim", role: "REVIEWER" },
        { id: "user-3f2a", displayName: "Dr. Ada Park", role: "REVIEWER" },
      ],
    }),
  );
}

describe("ReviewerDirectory", () => {
  it("loads the reviewers once for every picker", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue(directoryResponse());
    const directory = new ReviewerDirectory(fetchDirectory);
    const listener = vi.fn();

    directory.subscribe(listener);
    directory.subscribe(vi.fn());
    await directory.load();

    expect(fetchDirectory).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    expect(directory.getSnapshot()).toEqual([
      { id: "reviewer-1", displayName: "Alex Kim" },
      { id: "user-3f2a", displayName: "Dr. Ada Park" },
    ]);
  });

  it("stays empty after a failure and tries again later", async () => {
    const fetchDirectory = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(directoryResponse());
    const directory = new ReviewerDirectory(fetchDirectory);

    await directory.load();
    expect(directory.getSnapshot()).toEqual([]);

    await directory.load();
    expect(directory.getSnapshot()).toHaveLength(2);
  });

  it("forgets the list on sign-out", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue(directoryResponse());
    const directory = new ReviewerDirectory(fetchDirectory);
    await directory.load();

    directory.clear();

    expect(directory.getSnapshot()).toEqual([]);
    fetchDirectory.mockResolvedValue(directoryResponse());
    await directory.load();
    expect(fetchDirectory).toHaveBeenCalledTimes(2);
  });
});
