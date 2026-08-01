import {
  cleanup,
  fireEvent,
  render,
  screen,
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
  VersionHistorySidebar,
} from "../note-detail/VersionHistorySidebar";

function createVersion(
  versionId: string,
  revisionNumber: number,
  parentVersionId:
    | string
    | null,
): NoteVersionDetail {
  return {
    versionId,
    noteId: "note-1",
    revisionNumber,
    parentVersionId,

    content: {
      subjective: "Subjective",
      objective: "Objective",
      assessment: "Assessment",
      plan: "Plan",
    },

    authorId: "reviewer-1",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Current Reviewer",

    createdAt:
      "2026-08-01T12:00:00.000Z",
  };
}

const version1 = createVersion(
  "version-1",
  1,
  null,
);

const version2 = createVersion(
  "version-2",
  2,
  "version-1",
);

afterEach(() => {
  cleanup();
});

describe(
  "VersionHistorySidebar",
  () => {
    it(
      "disables comparison when fewer than two versions exist",
      () => {
        render(
          <VersionHistorySidebar
            versions={[version1]}
            currentVersionId={
              version1.versionId
            }
            selectedVersionId={
              version1.versionId
            }
            comparisonStatus="closed"
            compareFromVersionId={
              null
            }
            compareToVersionId={
              null
            }
            onSelectVersion={
              vi.fn()
            }
            onStartComparison={
              vi.fn()
            }
            onCompareFromVersionChange={
              vi.fn()
            }
            onCompareToVersionChange={
              vi.fn()
            }
            onShowComparison={
              vi.fn()
            }
            onExitComparison={
              vi.fn()
            }
          />,
        );

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Compare versions",
            },
          ),
        ).toBeDisabled();

        expect(
          screen.getByText(
            "At least two saved versions are required for comparison.",
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      "starts comparison mode",
      () => {
        const handleStart =
          vi.fn();

        render(
          <VersionHistorySidebar
            versions={[
              version1,
              version2,
            ]}
            currentVersionId={
              version2.versionId
            }
            selectedVersionId={
              version2.versionId
            }
            comparisonStatus="closed"
            compareFromVersionId={
              null
            }
            compareToVersionId={
              null
            }
            onSelectVersion={
              vi.fn()
            }
            onStartComparison={
              handleStart
            }
            onCompareFromVersionChange={
              vi.fn()
            }
            onCompareToVersionChange={
              vi.fn()
            }
            onShowComparison={
              vi.fn()
            }
            onExitComparison={
              vi.fn()
            }
          />,
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Compare versions",
            },
          ),
        );

        expect(
          handleStart,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "updates both selected comparison versions",
      () => {
        const handleFromChange =
          vi.fn();

        const handleToChange =
          vi.fn();

        render(
          <VersionHistorySidebar
            versions={[
              version1,
              version2,
            ]}
            currentVersionId={
              version2.versionId
            }
            selectedVersionId={
              version2.versionId
            }
            comparisonStatus="selecting"
            compareFromVersionId={
              version1.versionId
            }
            compareToVersionId={
              version2.versionId
            }
            onSelectVersion={
              vi.fn()
            }
            onStartComparison={
              vi.fn()
            }
            onCompareFromVersionChange={
              handleFromChange
            }
            onCompareToVersionChange={
              handleToChange
            }
            onShowComparison={
              vi.fn()
            }
            onExitComparison={
              vi.fn()
            }
          />,
        );

        fireEvent.change(
          screen.getByRole(
            "combobox",
            {
              name: "From version",
            },
          ),
          {
            target: {
              value:
                version2.versionId,
            },
          },
        );

        fireEvent.change(
          screen.getByRole(
            "combobox",
            {
              name: "To version",
            },
          ),
          {
            target: {
              value:
                version1.versionId,
            },
          },
        );

        expect(
          handleFromChange,
        ).toHaveBeenCalledWith(
          version2.versionId,
        );

        expect(
          handleToChange,
        ).toHaveBeenCalledWith(
          version1.versionId,
        );
      },
    );

    it(
      "does not allow the same version on both sides",
      () => {
        render(
          <VersionHistorySidebar
            versions={[
              version1,
              version2,
            ]}
            currentVersionId={
              version2.versionId
            }
            selectedVersionId={
              version2.versionId
            }
            comparisonStatus="selecting"
            compareFromVersionId={
              version2.versionId
            }
            compareToVersionId={
              version2.versionId
            }
            onSelectVersion={
              vi.fn()
            }
            onStartComparison={
              vi.fn()
            }
            onCompareFromVersionChange={
              vi.fn()
            }
            onCompareToVersionChange={
              vi.fn()
            }
            onShowComparison={
              vi.fn()
            }
            onExitComparison={
              vi.fn()
            }
          />,
        );

        expect(
          screen.getByText(
            "Choose two different versions.",
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Show comparison",
            },
          ),
        ).toBeDisabled();
      },
    );

    it(
      "opens a valid comparison",
      () => {
        const handleShow =
          vi.fn();

        render(
          <VersionHistorySidebar
            versions={[
              version1,
              version2,
            ]}
            currentVersionId={
              version2.versionId
            }
            selectedVersionId={
              version2.versionId
            }
            comparisonStatus="selecting"
            compareFromVersionId={
              version1.versionId
            }
            compareToVersionId={
              version2.versionId
            }
            onSelectVersion={
              vi.fn()
            }
            onStartComparison={
              vi.fn()
            }
            onCompareFromVersionChange={
              vi.fn()
            }
            onCompareToVersionChange={
              vi.fn()
            }
            onShowComparison={
              handleShow
            }
            onExitComparison={
              vi.fn()
            }
          />,
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Show comparison",
            },
          ),
        );

        expect(
          handleShow,
        ).toHaveBeenCalledTimes(1);
      },
    );
  },
);