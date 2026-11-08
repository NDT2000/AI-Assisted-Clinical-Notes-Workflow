import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOCK_ACTORS } from "../../mock-data/mockUsers";
import { SESSION_ENDED, session } from "../session";
import { SignInPage, type SignInLocationState } from "../SignInPage";

function Destination() {
  const location = useLocation();
  return <p>Arrived at {location.pathname}</p>;
}

function renderSignIn(state?: SignInLocationState) {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/sign-in", state }]}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SignInPage", () => {
  beforeEach(() => {
    session.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signs in and returns to the page that was asked for", async () => {
    const user = userEvent.setup({ delay: null });
    const signIn = vi
      .spyOn(session, "signIn")
      .mockImplementation(async () => {
        session.signInForTests(MOCK_ACTORS.CLINICIAN);
        return {
          ok: true,
          user: { ...MOCK_ACTORS.CLINICIAN, username: "clinician-1" },
        };
      });
    renderSignIn({ from: "/notes/note-7" });

    await user.type(screen.getByLabelText("Username"), " clinician-1 ");
    await user.type(screen.getByLabelText("Password"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signIn).toHaveBeenCalledWith("clinician-1", "a-long-password");
    expect(
      await screen.findByText("Arrived at /notes/note-7"),
    ).toBeInTheDocument();
  });

  it("shows why signing in was refused and clears the password", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(session, "signIn").mockResolvedValue({
      ok: false,
      message: "This account is deactivated. Ask an administrator to reactivate it.",
    });
    renderSignIn();

    await user.type(screen.getByLabelText("Username"), "clinician-2");
    await user.type(screen.getByLabelText("Password"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This account is deactivated.",
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Username")).toHaveValue("clinician-2");
  });

  it("explains that a session has ended", () => {
    vi.spyOn(session, "getState").mockReturnValue({
      status: "signedOut",
      notice: SESSION_ENDED,
    });
    renderSignIn();

    expect(screen.getByRole("status")).toHaveTextContent(SESSION_ENDED);
  });

  it("fills in the username after a password was chosen", () => {
    renderSignIn({
      username: "dr.park",
      notice: "Your password is set. Sign in with it.",
    });

    expect(screen.getByLabelText("Username")).toHaveValue("dr.park");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your password is set.",
    );
  });

  it("sends a signed-in user on, but never to another site", () => {
    session.signInForTests(MOCK_ACTORS.REVIEWER);
    renderSignIn({ from: "//attacker.example/notes" });

    expect(screen.getByText("Arrived at /notes")).toBeInTheDocument();
  });

  it("only allows submitting with both fields filled in", async () => {
    const user = userEvent.setup({ delay: null });
    renderSignIn();
    const submit = screen.getByRole("button", { name: "Sign in" });

    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Username"), "clinician-1");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Password"), "x");
    expect(submit).toBeEnabled();
  });
});
