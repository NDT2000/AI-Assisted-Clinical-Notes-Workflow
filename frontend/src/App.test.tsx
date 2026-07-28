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
      screen.getByRole("heading", { name: "Notes List" }),
    ).toBeInTheDocument();
  });
})
describe("App routing", () => {
  it("renders the note details page at /notes/:noteId", () => {
    render(
      <MemoryRouter initialEntries={["/notes/:noteId"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Note Details" }),
    ).toBeInTheDocument();
  });
})