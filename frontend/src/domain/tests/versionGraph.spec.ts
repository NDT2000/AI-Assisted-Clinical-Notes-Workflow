import { describe, expect, it, } from "vitest";

import type { NoteVersion, } from "../noteAttributes";

import { findCommonAncestor, } from "../versionGraph";

function createVersion(
  versionId: string,
  parentVersionId: string | null,
): NoteVersion {
  return {
    versionId,
    noteId: "note-1",
    revisionNumber: 1,
    parentVersionId,
    content: {
      subjective: "",
      objective: "",
      assessment: "",
      plan: "",
    },
    authorId: "reviewer-1",
    authorRole: "REVIEWER",
    createdAt:
      "2026-08-01T12:00:00.000Z",
  };
}

describe("findCommonAncestor", () => {
  it(
    "returns the same version when both IDs match",
    () => {
      const version =
        createVersion("version-1", null);

      expect(
        findCommonAncestor(
          [version],
          "version-1",
          "version-1",
        ),
      ).toBe(version);
    },
  );

  it(
    "returns the base version when the server head descended from it",
    () => {
      const version1 =
        createVersion("version-1", null);

      const version2 = createVersion(
        "version-2",
        "version-1",
      );

      const version3 = createVersion(
        "version-3",
        "version-2",
      );

      expect(
        findCommonAncestor(
          [
            version1,
            version2,
            version3,
          ],
          "version-2",
          "version-3",
        ),
      ).toBe(version2);
    },
  );

  it(
    "finds the branch point for sibling branches",
    () => {
      const version1 =
        createVersion("version-1", null);

      const localBranch = createVersion(
        "version-local",
        "version-1",
      );

      const serverBranch = createVersion(
        "version-server",
        "version-1",
      );

      expect(
        findCommonAncestor(
          [
            version1,
            localBranch,
            serverBranch,
          ],
          "version-local",
          "version-server",
        ),
      ).toBe(version1);
    },
  );

  it(
    "returns null when a version is unknown",
    () => {
      const version =
        createVersion("version-1", null);

      expect(
        findCommonAncestor(
          [version],
          "missing-version",
          "version-1",
        ),
      ).toBeNull();
    },
  );
});