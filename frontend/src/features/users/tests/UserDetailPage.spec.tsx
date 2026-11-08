import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { session } from "../../../auth/session";
import { MOCK_ACTORS } from "../../../mock-data/mockUsers";
import { describeEvent } from "../accountText";
import {
  UsersApiError,
  type AdminEvent,
  type UserDetail,
} from "../api/usersApi";
import { UserDetailPage } from "../pages/UserDetailPage";

function detail(changes: Partial<UserDetail["user"]> = {}): UserDetail {
  return {
    user: {
      id: "reviewer-2",
      username: "reviewer-2",
      displayName: "Sam Rivera",
      role: "REVIEWER",
      status: "ACTIVE",
      mfaEnabled: true,
      createdAt: "2026-11-05T12:00:00.000Z",
      createdById: null,
      lastLoginAt: null,
      ...changes,
    },
    setupLinkExpiresAt: null,
    openReviewCount: 3,
    history: [
      {
        eventId: "event-1",
        action: "ROLE_CHANGED",
        actorId: "admin-1",
        actorName: "Jordan Lee",
        details: { field: "role", from: "CLINICIAN", to: "REVIEWER" },
        occurredAt: "2026-11-07T14:02:00.000Z",
      },
    ],
  };
}

function fakeApi(start: UserDetail = detail()) {
  return {
    getUser: vi.fn().mockResolvedValue(start),
    updateUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    issueSetupLink: vi.fn(),
  };
}

function renderPage(api: ReturnType<typeof fakeApi>, userId = "reviewer-2") {
  render(
    <MemoryRouter initialEntries={[`/admin/users/${userId}`]}>
      <Routes>
        <Route
          path="/admin/users/:userId"
          element={<UserDetailPage api={api} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("UserDetailPage", () => {
  beforeEach(() => {
    session.signInForTests(MOCK_ACTORS.ADMIN);
  });

  it("shows the account, its open reviews and its history", async () => {
    const api = fakeApi();
    renderPage(api);

    expect(
      await screen.findByRole("heading", { name: "Sam Rivera" }),
    ).toBeInTheDocument();
    expect(api.getUser).toHaveBeenCalledWith("reviewer-2", expect.any(AbortSignal));
    expect(screen.getByText("Open reviews").nextSibling).toHaveTextContent("3");
    const history = screen.getByRole("list");
    expect(within(history).getByText(
      "Jordan Lee changed the role from Clinician to Reviewer",
    )).toBeInTheDocument();
  });

  it("saves only what changed", async () => {
    const user = userEvent.setup({ delay: null });
    const api = fakeApi();
    api.updateUser.mockResolvedValue(detail({ displayName: "Sam Rivera-Lopez" }));
    renderPage(api);
    const name = await screen.findByLabelText("Full name");

    await user.clear(name);
    await user.type(name, "Sam Rivera-Lopez");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(api.updateUser).toHaveBeenCalledWith("reviewer-2", {
      displayName: "Sam Rivera-Lopez",
    });
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sam Rivera-Lopez" }),
    ).toBeInTheDocument();
  });

  it("shows a refused change next to the form", async () => {
    const user = userEvent.setup({ delay: null });
    const api = fakeApi();
    api.updateUser.mockRejectedValue(
      new UsersApiError(409, "username_taken", "The username reviewer-1 is already taken."),
    );
    renderPage(api);
    const username = await screen.findByLabelText("Username");

    await user.clear(username);
    await user.type(username, "reviewer-1");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already taken");
  });

  it("asks before deactivating, and again for open reviews", async () => {
    const user = userEvent.setup({ delay: null });
    const api = fakeApi();
    api.deactivateUser
      .mockRejectedValueOnce(
        new UsersApiError(
          409,
          "has_open_reviews",
          "Sam Rivera has 3 notes waiting for or under their review. Confirm to deactivate anyway; the notes stay assigned until someone reassigns them.",
          { openReviewCount: 3 },
        ),
      )
      .mockResolvedValueOnce(detail({ status: "DEACTIVATED" }));
    renderPage(api);

    await user.click(await screen.findByRole("button", { name: "Deactivate" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Deactivate Sam Rivera?");
    await user.click(
      within(screen.getByRole("alert")).getByRole("button", { name: "Deactivate" }),
    );

    expect(api.deactivateUser).toHaveBeenNthCalledWith(1, "reviewer-2", false);
    expect(await screen.findByRole("alert")).toHaveTextContent("3 notes waiting");

    await user.click(screen.getByRole("button", { name: "Deactivate anyway" }));

    expect(api.deactivateUser).toHaveBeenNthCalledWith(2, "reviewer-2", true);
    expect(await screen.findByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(screen.getByText("Deactivated")).toBeInTheDocument();
  });

  it("reactivates", async () => {
    const user = userEvent.setup({ delay: null });
    const api = fakeApi(detail({ status: "DEACTIVATED" }));
    api.reactivateUser.mockResolvedValue(detail());
    renderPage(api);

    await user.click(await screen.findByRole("button", { name: "Reactivate" }));

    expect(api.reactivateUser).toHaveBeenCalledWith("reviewer-2");
    expect(await screen.findByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("protects the administrator's own account", async () => {
    const api = fakeApi(
      detail({ id: "admin-1", displayName: "Jordan Lee", role: "ADMIN" }),
    );
    renderPage(api, "admin-1");

    expect(await screen.findByLabelText("Role")).toBeDisabled();
    expect(screen.getByText("You cannot change your own role.")).toBeInTheDocument();
    expect(screen.getByText("You cannot deactivate your own account.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
  });

  it.each([
    ["ACTIVE", "Reset password"],
    ["SETUP_PENDING", "New setup link"],
  ] as const)("issues a link for a %s account", async (status, label) => {
    const user = userEvent.setup({ delay: null });
    const api = fakeApi(detail({ status }));
    api.issueSetupLink.mockResolvedValue({
      url: "http://localhost:5173/set-password#fresh",
      expiresAt: "2026-11-10T12:00:00.000Z",
    });
    renderPage(api);

    await user.click(await screen.findByRole("button", { name: label }));

    expect(await screen.findByLabelText("Setup link")).toHaveValue(
      "http://localhost:5173/set-password#fresh",
    );
    // The history is reloaded, so the new link shows in it.
    expect(api.getUser).toHaveBeenCalledTimes(2);
  });

  it("offers no setup link for a deactivated account", async () => {
    renderPage(
      fakeApi({
        ...detail({ status: "DEACTIVATED" }),
        setupLinkExpiresAt: "2026-11-10T12:00:00.000Z",
      }),
    );

    await screen.findByRole("button", { name: "Reactivate" });
    expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
    // Its earlier link stopped working with the deactivation.
    expect(screen.queryByText("Setup link expires")).not.toBeInTheDocument();
  });

  it("says when the user does not exist", async () => {
    const api = fakeApi();
    api.getUser.mockRejectedValue(
      new UsersApiError(404, "not_found", "There is no user nobody."),
    );
    renderPage(api, "nobody");

    expect(await screen.findByRole("alert")).toHaveTextContent("There is no user nobody.");
  });
});

describe("describeEvent", () => {
  function event(changes: Partial<AdminEvent>): AdminEvent {
    return {
      eventId: "event",
      action: "CREATED",
      actorId: "admin-1",
      actorName: "Jordan Lee",
      details: {},
      occurredAt: "2026-11-07T14:02:00.000Z",
      ...changes,
    };
  }

  it.each([
    [{ action: "CREATED", details: { role: "REVIEWER" } }, "Jordan Lee created the account as Reviewer"],
    [{ action: "CREATED", actorId: null, actorName: null, details: { role: "ADMIN" } }, "A setup command created the account as Administrator"],
    [{ action: "RENAMED", details: { field: "username", from: "a.b", to: "c.d" } }, "Jordan Lee changed the username from a.b to c.d"],
    [{ action: "RENAMED", details: { field: "displayName", from: "A", to: "B" } }, "Jordan Lee changed the name from A to B"],
    [{ action: "DEACTIVATED", details: { openReviewCount: 1 } }, "Jordan Lee deactivated the account with 1 open review"],
    [{ action: "DEACTIVATED", details: { openReviewCount: 0 } }, "Jordan Lee deactivated the account"],
    [{ action: "REACTIVATED" }, "Jordan Lee reactivated the account"],
    [{ action: "SETUP_LINK_ISSUED" }, "Jordan Lee issued a setup link"],
    [{ action: "PASSWORD_SET", actorId: "user-1", actorName: "Ada Park" }, "Ada Park set their password"],
  ] as [Partial<AdminEvent>, string][])("%o", (changes, sentence) => {
    expect(describeEvent(event(changes), "user-1")).toBe(sentence);
  });
});
