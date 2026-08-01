import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  NoteVersionDetail,
} from "../../../../domain/noteDetail";

import {
  VersionDiffViewer,
} from "../note-detail/VersionDiffViewer";

function createVersion(
  overrides: Partial<NoteVersionDetail> = {},
): NoteVersionDetail {
  return {
    versionId: "version-1",
    noteId: "note-1",
    revisionNumber: 1,
    parentVersionId: null,

    content: {
      subjective:
        "Patient reports mild pain.",
      objective:
        "Temperature is normal.",
      assessment:
        "Condition is stable.",
      plan:
        "Review in 7 days.",
    },

    authorId: "reviewer-1",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Current Reviewer",

    createdAt:
      "2026-08-01T12:00:00.000Z",

    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe(
  "VersionDiffViewer",
  () => {
    it(
      "shows both revision numbers and every SOAP section",
      () => {
        const fromVersion =
          createVersion();

        const toVersion =
          createVersion({
            versionId: "version-2",
            revisionNumber: 2,
            parentVersionId:
              fromVersion.versionId,
          });

        render(
          <VersionDiffViewer
            fromVersion={fromVersion}
            toVersion={toVersion}
            onClose={vi.fn()}
          />,
        );

        expect(
          screen.getByRole("heading", {
            name:
              "Comparing revision 1 to revision 2",
          }),
        ).toBeInTheDocument();

        expect(
          screen.getByRole("heading", {
            name: "Subjective",
          }),
        ).toBeInTheDocument();

        expect(
          screen.getByRole("heading", {
            name: "Objective",
          }),
        ).toBeInTheDocument();

        expect(
          screen.getByRole("heading", {
            name: "Assessment",
          }),
        ).toBeInTheDocument();

        expect(
          screen.getByRole("heading", {
            name: "Plan",
          }),
        ).toBeInTheDocument();
      },
    );

    it(
      "renders removed and added content semantically",
      () => {
        const fromVersion =
          createVersion();

        const toVersion =
          createVersion({
            versionId: "version-2",
            revisionNumber: 2,
            parentVersionId:
              fromVersion.versionId,

            content: {
              ...fromVersion.content,
              plan:
                "Review in 14 days.",
            },
          });

        const { container } = render(
          <VersionDiffViewer
            fromVersion={fromVersion}
            toVersion={toVersion}
            onClose={vi.fn()}
          />,
        );

        const planHeading =
          screen.getByRole("heading", {
            name: "Plan",
          });

        const planSection =
          planHeading.closest("article");

        if (!planSection) {
          throw new Error(
            "Expected Plan diff section.",
          );
        }

        expect(
          within(planSection).getByLabelText(
            "Removed: 7",
          ),
        ).toBeInTheDocument();

        expect(
          within(planSection).getByLabelText(
            "Added: 14",
          ),
        ).toBeInTheDocument();

        expect(
          container.querySelector("del"),
        ).toHaveTextContent("7");

        expect(
          container.querySelector("ins"),
        ).toHaveTextContent("14");
      },
    );

    it(
      "shows no changes for identical sections",
      () => {
        const fromVersion =
          createVersion();

        const toVersion =
          createVersion({
            versionId: "version-2",
            revisionNumber: 2,
            parentVersionId:
              fromVersion.versionId,
          });

        render(
          <VersionDiffViewer
            fromVersion={fromVersion}
            toVersion={toVersion}
            onClose={vi.fn()}
          />,
        );

        expect(
          screen.getAllByText(
            "No changes.",
          ),
        ).toHaveLength(4);
      },
    );

    it(
      "focuses the comparison heading when opened",
      () => {
        const fromVersion =
          createVersion();

        const toVersion =
          createVersion({
            versionId: "version-2",
            revisionNumber: 2,
          });

        render(
          <VersionDiffViewer
            fromVersion={fromVersion}
            toVersion={toVersion}
            onClose={vi.fn()}
          />,
        );

        expect(
          screen.getByRole("heading", {
            name:
              "Comparing revision 1 to revision 2",
          }),
        ).toHaveFocus();
      },
    );

    it(
      "calls onClose when comparison is exited",
      () => {
        const handleClose = vi.fn();

        render(
          <VersionDiffViewer
            fromVersion={createVersion()}
            toVersion={createVersion({
              versionId: "version-2",
              revisionNumber: 2,
            })}
            onClose={handleClose}
          />,
        );

        fireEvent.click(
          screen.getByRole("button", {
            name: "Exit comparison",
          }),
        );

        expect(
          handleClose,
        ).toHaveBeenCalledTimes(1);
      },
    );
  },
);