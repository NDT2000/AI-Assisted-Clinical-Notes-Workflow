import {
  useCallback,
  useState,
} from "react";

import type {
  NoteVersionDetail,
} from "../../../domain/noteDetail";
import type {
  VersionComparisonStatus,
} from "../components/note-detail/VersionHistorySidebar";

export interface UseVersionComparisonResult {
  /* A past version opened read-only, or null for the current one. */
  historicalVersion: NoteVersionDetail | null;
  historicalVersionId: string | null;
  comparisonStatus: VersionComparisonStatus;
  compareFromVersionId: string | null;
  compareToVersionId: string | null;
  compareFromVersion: NoteVersionDetail | null;
  compareToVersion: NoteVersionDetail | null;
  isComparisonOpen: boolean;
  /* Both versions picked and the diff shown. */
  isComparingVersions: boolean;
  selectVersion(versionId: string): void;
  returnToCurrentVersion(): void;
  startComparison(): void;
  setCompareFromVersionId(
    versionId: string | null,
  ): void;
  setCompareToVersionId(
    versionId: string | null,
  ): void;
  showComparison(): void;
  exitComparison(): void;
}

function findVersion(
  versions: NoteVersionDetail[],
  versionId: string | null,
): NoteVersionDetail | null {
  if (versionId === null) {
    return null;
  }

  return (
    versions.find(
      version =>
        version.versionId === versionId,
    ) ?? null
  );
}

/*
 * Browsing past versions and comparing two of them. Viewing a past
 * version and comparing are exclusive: starting a comparison returns
 * to the current version.
 */
export function useVersionComparison(
  versions: NoteVersionDetail[],
  currentVersion: NoteVersionDetail,
): UseVersionComparisonResult {
  const [
    historicalVersionId,
    setHistoricalVersionId,
  ] = useState<string | null>(null);

  const [
    comparisonStatus,
    setComparisonStatus,
  ] = useState<VersionComparisonStatus>(
    "closed",
  );

  const [
    compareFromVersionId,
    setCompareFromVersionId,
  ] = useState<string | null>(null);

  const [
    compareToVersionId,
    setCompareToVersionId,
  ] = useState<string | null>(null);

  const historicalVersion = findVersion(
    versions,
    historicalVersionId,
  );

  const compareFromVersion = findVersion(
    versions,
    compareFromVersionId,
  );

  const compareToVersion = findVersion(
    versions,
    compareToVersionId,
  );

  const isComparisonOpen =
    comparisonStatus !== "closed";

  const returnToCurrentVersion =
    useCallback(() => {
      setHistoricalVersionId(null);
    }, []);

  return {
    historicalVersion,
    historicalVersionId,
    comparisonStatus,
    compareFromVersionId,
    compareToVersionId,
    compareFromVersion,
    compareToVersion,
    isComparisonOpen,
    isComparingVersions:
      comparisonStatus === "active" &&
      compareFromVersion !== null &&
      compareToVersion !== null,

    selectVersion(versionId) {
      if (isComparisonOpen) {
        return;
      }

      setHistoricalVersionId(
        versionId ===
          currentVersion.versionId
          ? null
          : versionId,
      );
    },

    returnToCurrentVersion,

    startComparison() {
      const previousVersion = versions
        .filter(
          version =>
            version.versionId !==
            currentVersion.versionId,
        )
        .sort(
          (first, second) =>
            second.revisionNumber -
            first.revisionNumber,
        )[0];

      if (previousVersion === undefined) {
        return;
      }

      setHistoricalVersionId(null);
      setCompareFromVersionId(
        previousVersion.versionId,
      );
      setCompareToVersionId(
        currentVersion.versionId,
      );
      setComparisonStatus("selecting");
    },

    setCompareFromVersionId,
    setCompareToVersionId,

    showComparison() {
      if (
        compareFromVersion === null ||
        compareToVersion === null ||
        compareFromVersion.versionId ===
          compareToVersion.versionId
      ) {
        return;
      }

      setHistoricalVersionId(null);
      setComparisonStatus("active");
    },

    exitComparison() {
      setComparisonStatus("closed");
      setCompareFromVersionId(null);
      setCompareToVersionId(null);
    },
  };
}
