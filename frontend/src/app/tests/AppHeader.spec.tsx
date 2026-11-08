import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOfflineSaveReplaySnapshot } from "../../features/notes/offline/useOfflineSaveReplaySnapshot";
import { AppHeader } from "../AppHeader";

vi.mock("../../features/notes/offline/useOfflineSaveReplaySnapshot", () => ({
  useOfflineSaveReplaySnapshot: vi.fn(() => ({ pendingCount: 0 })),
}));

const snapshotMock = vi.mocked(useOfflineSaveReplaySnapshot);

function withPending(pendingCount: number) {
  snapshotMock.mockReturnValue({
    pendingCount,
  } as ReturnType<typeof useOfflineSaveReplaySnapshot>);
}

describe("AppHeader", () => {
  afterEach(() => {
    withPending(0);
  });

  it("shows who is signed in", () => {
    render(<AppHeader signOut={vi.fn()} />);

    expect(screen.getByText("Alex Kim")).toBeInTheDocument();
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
  });

  it("signs out at once when nothing is waiting to be sent", async () => {
    const user = userEvent.setup({ delay: null });
    const signOut = vi.fn().mockResolvedValue(undefined);
    render(<AppHeader signOut={signOut} />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("warns before deleting changes saved offline", async () => {
    const user = userEvent.setup({ delay: null });
    const signOut = vi.fn().mockResolvedValue(undefined);
    withPending(2);
    render(<AppHeader signOut={signOut} />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 changes saved offline have not reached the server yet.",
    );

    await user.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(screen.getByRole("button", { name: "Sign out anyway" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
