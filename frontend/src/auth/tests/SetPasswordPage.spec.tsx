import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkSetupLink, setPassword } from "../accountApi";
import { SetPasswordPage } from "../SetPasswordPage";
import type { SignInLocationState } from "../SignInPage";

vi.mock("../accountApi", () => ({
  checkSetupLink: vi.fn(),
  setPassword: vi.fn(),
}));

const checkSetupLinkMock = vi.mocked(checkSetupLink);
const setPasswordMock = vi.mocked(setPassword);

const STRONG = "a brand new password";

function SignInStub() {
  const state = useLocation().state as SignInLocationState;
  return (
    <p>
      Sign in as {state.username}: {state.notice}
    </p>
  );
}

function renderAt(hash: string) {
  window.history.replaceState(null, "", `/set-password${hash}`);
  render(
    <MemoryRouter initialEntries={["/set-password"]}>
      <Routes>
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/sign-in" element={<SignInStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SetPasswordPage", () => {
  beforeEach(() => {
    checkSetupLinkMock.mockResolvedValue({
      ok: true,
      value: {
        username: "dr.park",
        displayName: "Dr. Ada Park",
        expiresAt: "2026-11-10T12:00:00.000Z",
      },
    });
    setPasswordMock.mockResolvedValue({ ok: true, value: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
  });

  async function fill(password: string, repeat: string) {
    const user = userEvent.setup({ delay: null });
    await screen.findByText(/Welcome,/);
    await user.type(screen.getByLabelText("New password"), password);
    await user.type(screen.getByLabelText("Repeat the password"), repeat);
    await user.click(screen.getByRole("button", { name: "Set password" }));
  }

  it("greets the person and keeps the token out of the address bar", async () => {
    renderAt("#the-token");

    expect(await screen.findByText("Dr. Ada Park")).toBeInTheDocument();
    expect(screen.getByText("dr.park")).toBeInTheDocument();
    expect(checkSetupLinkMock).toHaveBeenCalledWith("the-token");
    expect(window.location.hash).toBe("");
  });

  it("sets the password and goes to sign in with the username", async () => {
    renderAt("#the-token");

    await fill(STRONG, STRONG);

    expect(setPasswordMock).toHaveBeenCalledWith("the-token", STRONG);
    expect(
      await screen.findByText(
        "Sign in as dr.park: Your password is set. Sign in with it.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ["short", "short", "at least 12 characters"],
    [STRONG, "something else entirely", "do not match"],
  ])("refuses %s / %s before sending", async (password, repeat, message) => {
    renderAt("#the-token");

    await fill(password, repeat);

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it("shows the API's refusal", async () => {
    setPasswordMock.mockResolvedValue({
      ok: false,
      message: "This setup link is invalid, has expired or was already used.",
    });
    renderAt("#the-token");

    await fill(STRONG, STRONG);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already used",
    );
  });

  it("explains an invalid link", async () => {
    checkSetupLinkMock.mockResolvedValue({
      ok: false,
      message: "Ask an administrator for a new one.",
    });
    renderAt("#old-token");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ask an administrator for a new one.",
    );
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("needs a link at all", () => {
    renderAt("");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "needs the setup link",
    );
    expect(checkSetupLinkMock).not.toHaveBeenCalled();
  });
});
