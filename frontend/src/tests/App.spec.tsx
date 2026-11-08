import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { session } from "../auth/session";

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
