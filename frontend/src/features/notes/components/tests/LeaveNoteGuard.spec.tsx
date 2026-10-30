import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  Link,
  RouterProvider,
} from "react-router-dom";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  UnresolvedSave,
} from "../../hooks/useNoteAutosave";
import {
  LeaveNoteGuard,
} from "../note-detail/LeaveNoteGuard";

function renderGuard(
  unresolvedSave: UnresolvedSave | null,
) {
  const router = createMemoryRouter(
    [
      {
        path: "/notes/:noteId",
        element: (
          <>
            <LeaveNoteGuard
              unresolvedSave={unresolvedSave}
            />
            <Link to="/notes">
              Back to notes
            </Link>
          </>
        ),
      },
      {
        path: "/notes",
        element: <h1>Notes list</h1>,
      },
    ],
    {
      initialEntries: ["/notes/note-1"],
    },
  );

  render(
    <RouterProvider router={router} />,
  );

  return router;
}

describe("LeaveNoteGuard", () => {
  afterEach(() => {
    cleanup();
  });

  it("lets navigation through when no save is unresolved", async () => {
    const user = userEvent.setup();
    const router = renderGuard(null);

    await user.click(
      screen.getByRole("link", {
        name: "Back to notes",
      }),
    );

    expect(
      router.state.location.pathname,
    ).toBe("/notes");

    expect(
      screen.queryByRole("alertdialog"),
    ).not.toBeInTheDocument();
  });

  it("asks before leaving and stays when the user chooses to", async () => {
    const user = userEvent.setup();
    const router = renderGuard(
      "will-be-lost",
    );

    await user.click(
      screen.getByRole("link", {
        name: "Back to notes",
      }),
    );

    const dialog = screen.getByRole(
      "alertdialog",
      { name: "Leave this note?" },
    );

    expect(dialog).toHaveTextContent(
      "those edits will be lost",
    );

    const stayButton = screen.getByRole(
      "button",
      { name: "Stay on this note" },
    );

    expect(stayButton).toHaveFocus();

    await user.click(stayButton);

    expect(
      router.state.location.pathname,
    ).toBe("/notes/note-1");

    expect(
      screen.queryByRole("alertdialog"),
    ).not.toBeInTheDocument();
  });

  it("leaves when the user confirms", async () => {
    const user = userEvent.setup();
    const router = renderGuard(
      "kept-offline",
    );

    await user.click(
      screen.getByRole("link", {
        name: "Back to notes",
      }),
    );

    expect(
      screen.getByRole("alertdialog"),
    ).toHaveTextContent(
      "kept in this browser",
    );

    await user.click(
      screen.getByRole("button", {
        name: "Leave anyway",
      }),
    );

    expect(
      router.state.location.pathname,
    ).toBe("/notes");

    expect(
      screen.getByRole("heading", {
        name: "Notes list",
      }),
    ).toBeInTheDocument();
  });
});
