import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
} from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";

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
