import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { session } from "../auth/session";
import { MOCK_ACTORS } from "../mock-data/mockUsers";

function renderAppAt(path: string) {
  const router = createMemoryRouter(
    [{ path: "*", element: <App /> }],
    { initialEntries: [path] },
  );

  render(<RouterProvider router={router} />);
}

describe("App routing", () => {
  it("renders the notes list page at /notes", () => {
    renderAppAt("/notes");

    expect(
      screen.getByRole("heading", { name: "Notes" }),
    ).toBeInTheDocument();
  });
})
describe("App routing", () => {
  it("renders the note detail page at /notes/:noteId", () => {
    renderAppAt("/notes/note-1");

    expect(
      screen.getByRole("heading", {name: /note detail/i,}),
    ).toBeInTheDocument();
  });
});

describe("App sign-in", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a signed-out visitor to sign in", async () => {
    session.resetForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: "Sign in to continue." }),
          { status: 401 },
        ),
      ),
    );

    renderAppAt("/notes/note-1");

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("shows the signed-in user in the header", () => {
    renderAppAt("/notes");

    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex Kim")).toBeInTheDocument();
  });

  it("opens the set-password page without signing in", () => {
    session.resetForTests();

    renderAppAt("/set-password");

    expect(
      screen.getByRole("heading", { name: "Choose your password" }),
    ).toBeInTheDocument();
  });
});

describe("App administration", () => {
  it("shows the Users page link to administrators only", () => {
    renderAppAt("/notes");

    expect(
      screen.queryByRole("link", { name: "Users" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Notes" }),
    ).toBeInTheDocument();
  });

  it("gives administrators the Users link", () => {
    session.signInForTests(MOCK_ACTORS.ADMIN);

    renderAppAt("/notes");

    expect(
      screen.getByRole("link", { name: "Users" }),
    ).toHaveAttribute("href", "/admin/users");
  });

  it.each([
    "/admin/users",
    "/admin/users/clinician-1",
  ])("takes everyone else from %s to the notes", (path) => {
    session.signInForTests(MOCK_ACTORS.CLINICIAN);

    renderAppAt(path);

    expect(
      screen.getByRole("heading", { name: "Notes" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Users" }),
    ).not.toBeInTheDocument();
  });
});
