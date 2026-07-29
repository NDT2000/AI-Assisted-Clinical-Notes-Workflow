import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App routing", () => {
  it("renders the notes list page at /notes", () => {
    render(
      <MemoryRouter initialEntries={["/notes"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Notes" }),
    ).toBeInTheDocument();
  });
})
describe("App routing", () => {
  it("renders the note detail page at /notes/:noteId", () => {
    render(
      <MemoryRouter initialEntries={["/notes/note-1"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Note Detail" }),
    ).toBeInTheDocument();
  });
})
