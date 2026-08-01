import type { NoteVersion, } from "./noteAttributes";

type VersionGraphNode = Pick<
  NoteVersion,
  "versionId" | "parentVersionId"
>;

export function findCommonAncestor<
  TVersion extends VersionGraphNode,
>(
  versions: readonly TVersion[],
  firstVersionId: string,
  secondVersionId: string,
): TVersion | null {
  const versionsById = new Map(
    versions.map((version) => [
      version.versionId,
      version,
    ]),
  );

  const firstAncestors = new Set<string>();
  const firstVisited = new Set<string>();

  let currentFirst =
    versionsById.get(firstVersionId) ?? null;

  while (
    currentFirst !== null &&
    !firstVisited.has(
      currentFirst.versionId,
    )
  ) {
    firstVisited.add(
      currentFirst.versionId,
    );

    firstAncestors.add(
      currentFirst.versionId,
    );

    currentFirst =
      currentFirst.parentVersionId === null
        ? null
        : versionsById.get(
            currentFirst.parentVersionId,
          ) ?? null;
  }

  const secondVisited = new Set<string>();

  let currentSecond =
    versionsById.get(secondVersionId) ??
    null;

  while (
    currentSecond !== null &&
    !secondVisited.has(
      currentSecond.versionId,
    )
  ) {
    if (
      firstAncestors.has(
        currentSecond.versionId,
      )
    ) {
      return currentSecond;
    }

    secondVisited.add(
      currentSecond.versionId,
    );

    currentSecond =
      currentSecond.parentVersionId ===
      null
        ? null
        : versionsById.get(
            currentSecond.parentVersionId,
          ) ?? null;
  }

  return null;
}