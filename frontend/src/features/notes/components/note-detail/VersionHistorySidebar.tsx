import {
  useEffect,
  useRef,
} from "react";

import type {
  NoteVersionDetail,
} from "../../../../domain/noteDetail";

export type VersionComparisonStatus =
  | "closed"
  | "selecting"
  | "active";

interface VersionHistorySidebarProps {
  versions: NoteVersionDetail[];
  currentVersionId: string;
  selectedVersionId: string;

  comparisonStatus:
    VersionComparisonStatus;

  compareFromVersionId:
    | string
    | null;

  compareToVersionId:
    | string
    | null;

  onSelectVersion: (
    versionId: string,
  ) => void;

  onStartComparison: () => void;

  onCompareFromVersionChange: (
    versionId: string,
  ) => void;

  onCompareToVersionChange: (
    versionId: string,
  ) => void;

  onShowComparison: () => void;

  onExitComparison: () => void;
}

function formatVersionDate(
  value: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

function getVersionOptionLabel(
  version: NoteVersionDetail,
  currentVersionId: string,
): string {
  const currentLabel =
    version.versionId ===
    currentVersionId
      ? " — Current"
      : "";

  return `Revision ${version.revisionNumber}${currentLabel}`;
}

export function VersionHistorySidebar({
  versions,
  currentVersionId,
  selectedVersionId,
  comparisonStatus,
  compareFromVersionId,
  compareToVersionId,
  onSelectVersion,
  onStartComparison,
  onCompareFromVersionChange,
  onCompareToVersionChange,
  onShowComparison,
  onExitComparison,
}: VersionHistorySidebarProps) {
  const compareButtonRef =
    useRef<HTMLButtonElement | null>(
      null,
    );

  const fromSelectRef =
    useRef<HTMLSelectElement | null>(
      null,
    );

  const previousComparisonStatusRef =
    useRef<VersionComparisonStatus>(
      comparisonStatus,
    );

  const sortedVersions = [
    ...versions,
  ].sort(
    (firstVersion, secondVersion) =>
      secondVersion.revisionNumber -
      firstVersion.revisionNumber,
  );

  const canStartComparison =
    sortedVersions.length >= 2;

  const fromVersionExists =
    compareFromVersionId !== null &&
    sortedVersions.some(
      version =>
        version.versionId ===
        compareFromVersionId,
    );

  const toVersionExists =
    compareToVersionId !== null &&
    sortedVersions.some(
      version =>
        version.versionId ===
        compareToVersionId,
    );

  const selectedSameVersion =
    compareFromVersionId !== null &&
    compareFromVersionId ===
      compareToVersionId;

  const canShowComparison =
    fromVersionExists &&
    toVersionExists &&
    !selectedSameVersion;

  const comparisonOpen =
    comparisonStatus !== "closed";

  useEffect(() => {
    const previousStatus =
      previousComparisonStatusRef.current;

    if (
      previousStatus === "closed" &&
      comparisonStatus === "selecting"
    ) {
      fromSelectRef.current?.focus();
    }

    if (
      previousStatus !== "closed" &&
      comparisonStatus === "closed"
    ) {
      compareButtonRef.current?.focus();
    }

    previousComparisonStatusRef.current =
      comparisonStatus;
  }, [comparisonStatus]);

  const comparisonMessageId =
    "version-comparison-message";

  return (
    <section
      className="note-detail-card"
      aria-labelledby="version-history-heading"
    >
      <h2 id="version-history-heading">
        Version history
      </h2>

      {!comparisonOpen ? (
        <>
          <button
            ref={compareButtonRef}
            type="button"
            disabled={
              !canStartComparison
            }
            aria-describedby={
              canStartComparison
                ? undefined
                : comparisonMessageId
            }
            onClick={
              onStartComparison
            }
          >
            Compare versions
          </button>

          {!canStartComparison ? (
            <p
              id={comparisonMessageId}
              className="version-comparison-message"
            >
              At least two saved versions
              are required for comparison.
            </p>
          ) : null}
        </>
      ) : (
        <fieldset
          className="version-comparison-controls"
          aria-describedby={
            comparisonStatus ===
            "active"
              ? comparisonMessageId
              : undefined
          }
        >
          <legend>
            Compare saved versions
          </legend>

          <label>
            From version

            <select
              ref={fromSelectRef}
              value={
                compareFromVersionId ??
                ""
              }
              disabled={
                comparisonStatus ===
                "active"
              }
              onChange={event => {
                onCompareFromVersionChange(
                  event.target.value,
                );
              }}
            >
              <option
                value=""
                disabled
              >
                Select a version
              </option>

              {sortedVersions.map(
                version => (
                  <option
                    key={
                      version.versionId
                    }
                    value={
                      version.versionId
                    }
                  >
                    {getVersionOptionLabel(
                      version,
                      currentVersionId,
                    )}
                  </option>
                ),
              )}
            </select>
          </label>

          <label>
            To version

            <select
              value={
                compareToVersionId ??
                ""
              }
              disabled={
                comparisonStatus ===
                "active"
              }
              onChange={event => {
                onCompareToVersionChange(
                  event.target.value,
                );
              }}
            >
              <option
                value=""
                disabled
              >
                Select a version
              </option>

              {sortedVersions.map(
                version => (
                  <option
                    key={
                      version.versionId
                    }
                    value={
                      version.versionId
                    }
                  >
                    {getVersionOptionLabel(
                      version,
                      currentVersionId,
                    )}
                  </option>
                ),
              )}
            </select>
          </label>

          {selectedSameVersion ? (
            <p
              className="version-comparison-message"
              role="alert"
            >
              Choose two different
              versions.
            </p>
          ) : null}

          {comparisonStatus ===
          "selecting" ? (
            <button
              type="button"
              disabled={
                !canShowComparison
              }
              onClick={
                onShowComparison
              }
            >
              Show comparison
            </button>
          ) : (
            <p
              id={comparisonMessageId}
              role="status"
              aria-live="polite"
            >
              Version comparison is
              currently open.
            </p>
          )}

          <button
            type="button"
            onClick={
              onExitComparison
            }
          >
            Exit comparison
          </button>
        </fieldset>
      )}

      {sortedVersions.length === 0 ? (
        <p>No versions available.</p>
      ) : (
        <ol
          className="version-history-list"
          aria-label="Saved note versions"
        >
          {sortedVersions.map(
            version => {
              const isCurrent =
                version.versionId ===
                currentVersionId;

              const isSelected =
                version.versionId ===
                selectedVersionId;

              return (
                <li
                  key={
                    version.versionId
                  }
                  className="version-history-item"
                >
                  <button
                    type="button"
                    disabled={
                      comparisonOpen
                    }
                    className={
                      isSelected
                        ? "version-history-button version-history-button--selected"
                        : "version-history-button"
                    }
                    aria-pressed={
                      isSelected
                    }
                    aria-current={
                      isCurrent
                        ? "true"
                        : undefined
                    }
                    onClick={() => {
                      onSelectVersion(
                        version.versionId,
                      );
                    }}
                  >
                    <span>
                      Revision{" "}
                      {
                        version.revisionNumber
                      }
                    </span>

                    {isCurrent ? (
                      <span>
                        Current version
                      </span>
                    ) : null}

                    <span>
                      {version.authorDisplayName ??
                        version.authorId}
                    </span>

                    <span>
                      {formatVersionDate(
                        version.createdAt,
                      )}
                    </span>
                  </button>
                </li>
              );
            },
          )}
        </ol>
      )}
    </section>
  );
}
