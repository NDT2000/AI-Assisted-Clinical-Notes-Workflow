import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { session } from "../../../auth/session";
import { MOCK_ACTORS } from "../../../mock-data/mockUsers";
import {
  createUser,
  listUsers,
  UsersApiError,
  type UserAccount,
} from "../api/usersApi";
import { UsersPage } from "../pages/UsersPage";
import { reviewerDirectory } from "../reviewerDirectory";

vi.mock("../api/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/usersApi")>()),
  listUsers: vi.fn(),
  createUser: vi.fn(),
}));

const listUsersMock = vi.mocked(listUsers);
const createUserMock = vi.mocked(createUser);

function account(changes: Partial<UserAccount>): UserAccount {
  return {
    id: "clinician-1",
    username: "clinician-1",
    displayName: "Dr. Maya Brooks",
    role: "CLINICIAN",
    status: "ACTIVE",
    mfaEnabled: false,
    createdAt: "2026-11-05T12:00:00.000Z",
    createdById: null,
    lastLoginAt: "2026-11-07T09:30:00.000Z",
    ...changes,
  };
}

const USERS = [
  account({}),
  account({
    id: "user-1",
    username: "dr.park",
    displayName: "Dr. Ada Park",
    status: "SETUP_PENDING",
    lastLoginAt: null,
  }),
  account({
    id: "reviewer-2",
    username: "reviewer-2",
    displayName: "Sam Rivera",
    role: "REVIEWER",
    status: "DEACTIVATED",
  }),
];

function renderPage() {
  render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
}

describe("UsersPage", () => {
  beforeEach(() => {
    session.signInForTests(MOCK_ACTORS.ADMIN);
    listUsersMock.mockReset().mockResolvedValue({ users: USERS });
    createUserMock.mockReset();
  });

  it("lists every account with its status", async () => {
    renderPage();

    const table = await screen.findByRole("table", { name: "3 users" });
    const rows = within(table).getAllByRole("row").slice(1);

    expect(within(rows[0]).getByRole("link", { name: "Dr. Maya Brooks" }))
      .toHaveAttribute("href", "/admin/users/clinician-1");
    expect(rows[1]).toHaveTextContent("Waiting for password");
    expect(rows[1]).toHaveTextContent("Never");
    expect(rows[2]).toHaveTextContent("Deactivated");
    expect(rows[2]).toHaveTextContent("Reviewer");
  });

  it("filters by name, role and status", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText("Name or username"), "park");
    await user.selectOptions(screen.getByLabelText("Role"), "REVIEWER");
    await user.selectOptions(screen.getByLabelText("Status"), "false");

    await waitFor(() => {
      expect(listUsersMock).toHaveBeenLastCalledWith(
        { q: "park", role: "REVIEWER", active: "false" },
        expect.any(AbortSignal),
      );
    });
    // Typing waits for a pause instead of asking on every key.
    expect(listUsersMock.mock.calls.length).toBeLessThan(6);
  });

  it("adds a user and shows the setup link once", async () => {
    const user = userEvent.setup({ delay: null });
    const clearDirectory = vi.spyOn(reviewerDirectory, "clear");
    createUserMock.mockResolvedValue({
      user: account({
        id: "user-9",
        username: "robin.vale",
        displayName: "Robin Vale",
        role: "REVIEWER",
        status: "SETUP_PENDING",
      }),
      setupLink: {
        url: "http://localhost:5173/set-password#secret-token",
        expiresAt: "2026-11-10T12:00:00.000Z",
      },
    });
    renderPage();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    expect(screen.getByLabelText("Full name")).toHaveFocus();
    await user.type(screen.getByLabelText("Full name"), "Robin Vale");
    await user.type(screen.getByLabelText("Username"), "Robin.Vale");
    await user.selectOptions(screen.getAllByLabelText("Role")[0], "REVIEWER");
    await user.click(screen.getByRole("button", { name: "Add user" }));

    expect(createUserMock).toHaveBeenCalledWith({
      displayName: "Robin Vale",
      username: "Robin.Vale",
      role: "REVIEWER",
    });
    const link = await screen.findByLabelText("Setup link");
    expect(link).toHaveValue("http://localhost:5173/set-password#secret-token");
    expect(link).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "Setup link for Robin Vale" }),
    ).toBeInTheDocument();
    expect(clearDirectory).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Setup link")).not.toBeInTheDocument();
  });

  it("copies the link", async () => {
    const user = userEvent.setup({ delay: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    createUserMock.mockResolvedValue({
      user: account({ id: "user-9", displayName: "Robin Vale" }),
      setupLink: { url: "http://x/set-password#t", expiresAt: "2026-11-10T12:00:00.000Z" },
    });
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Add user" }));
    await user.type(screen.getByLabelText("Full name"), "Robin Vale");
    await user.type(screen.getByLabelText("Username"), "robin.vale");
    await user.click(screen.getByRole("button", { name: "Add user" }));

    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith("http://x/set-password#t");
    expect(screen.getByText("Copied.")).toBeInTheDocument();
  });

  it("shows the API's refusal in the form", async () => {
    const user = userEvent.setup({ delay: null });
    createUserMock.mockRejectedValue(
      new UsersApiError(409, "username_taken", "The username dr.park is already taken."),
    );
    renderPage();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    await user.type(screen.getByLabelText("Full name"), "Ada Park");
    await user.type(screen.getByLabelText("Username"), "dr.park");
    await user.click(screen.getByRole("button", { name: "Add user" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The username dr.park is already taken.",
    );
    expect(screen.getByLabelText("Full name")).toHaveValue("Ada Park");
  });

  it("says when the list cannot be loaded", async () => {
    listUsersMock.mockRejectedValue(
      new UsersApiError(403, "forbidden", "Only an administrator can manage accounts."),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only an administrator can manage accounts.",
    );
  });
});
