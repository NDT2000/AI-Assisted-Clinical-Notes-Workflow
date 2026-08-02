import type {
  UserRole,
} from "../../../../domain/noteAttributes";
import type {
  NoteVersionDetail,
} from "../../../../domain/noteDetail";
import "../note-detail/css/VersionHistorySidebar.css"

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

function formatRole(
  role: UserRole,
): string {
  switch (role) {
    case "CLINICIAN":
      return "Clinician";
    case "REVIEWER":
      return "Reviewer";
    case "ADMIN":
      return "Administrator";
    case "READONLY_AUDITOR":
      return "Read-only auditor";
  }
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
  const sortedVersions = [
    ...versions,
  ].sort(
    (firstVersion, secondVersion) =>
      secondVersion.revisionNumber -
      firstVersion.revisionNumber,
  );

  const versionsById =
    new Map(
      sortedVersions.map(
        (version) => [
          version.versionId,
          version,
        ],
      ),
    );

  const canStartComparison =
    sortedVersions.length >= 2;

  const fromVersionExists =
    compareFromVersionId !== null &&
    versionsById.has(
      compareFromVersionId,
    );

  const toVersionExists =
    compareToVersionId !== null &&
    versionsById.has(
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

  const selectedVersion =
    versionsById.get(
      selectedVersionId,
    );

  return (
    <section
      className="note-detail-card version-history"
      aria-labelledby="version-history-heading"
    >
      <div className="version-history__heading">
        <div>
          <p className="version-history__eyebrow">
            Saved note revisions
          </p>

          <h2 id="version-history-heading">
            Version history
          </h2>

          <p>
            {sortedVersions.length} saved{" "}
            {sortedVersions.length === 1
              ? "version"
              : "versions"}
          </p>
        </div>

        {selectedVersion !==
          undefined && (
          <span className="version-history__selected-summary">
            Viewing revision{" "}
            {
              selectedVersion.revisionNumber
            }
          </span>
        )}
      </div>

      {!comparisonOpen ? (
        <div className="version-history__compare-start">
          <button
            type="button"
            disabled={
              !canStartComparison
            }
            aria-describedby={
              canStartComparison
                ? undefined
                : "version-comparison-unavailable"
            }
            onClick={
              onStartComparison
            }
          >
            Compare versions
          </button>

          {!canStartComparison && (
            <p
              id="version-comparison-unavailable"
              className="version-comparison-message"
            >
              At least two saved versions
              are required for comparison.
            </p>
          )}
        </div>
      ) : (
        <fieldset className="version-comparison-controls">
          <legend>
            Compare saved versions
          </legend>

          <p>
            Choose an earlier and later
            revision. Comparison is
            read-only.
          </p>

          <div className="version-comparison-controls__fields">
            <label>
              From version

              <select
                value={
                  compareFromVersionId ??
                  ""
                }
                disabled={
                  comparisonStatus ===
                  "active"
                }
                onChange={(event) =>
                  onCompareFromVersionChange(
                    event.target.value,
                  )
                }
              >
                <option
                  value=""
                  disabled
                >
                  Select a version
                </option>

                {sortedVersions.map(
                  (version) => (
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
                onChange={(event) =>
                  onCompareToVersionChange(
                    event.target.value,
                  )
                }
              >
                <option
                  value=""
                  disabled
                >
                  Select a version
                </option>

                {sortedVersions.map(
                  (version) => (
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
          </div>

          {selectedSameVersion && (
            <p
              className="version-comparison-message"
              role="alert"
            >
              Choose two different
              versions.
            </p>
          )}

          <div className="version-comparison-controls__actions">
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
              <p role="status">
                Version comparison is
                currently open.
              </p>
            )}

            <button
              type="button"
              className="version-history__secondary-button"
              onClick={
                onExitComparison
              }
            >
              Exit comparison
            </button>
          </div>
        </fieldset>
      )}

      {sortedVersions.length === 0 ? (
        <p className="version-history__empty">
          No versions available.
        </p>
      ) : (
        <ol className="version-history-list">
          {sortedVersions.map(
            (version) => {
              const isCurrent =
                version.versionId ===
                currentVersionId;

              const isSelected =
                version.versionId ===
                selectedVersionId;

              const isCompareFrom =
                version.versionId ===
                compareFromVersionId;

              const isCompareTo =
                version.versionId ===
                compareToVersionId;

              const parentVersion =
                version.parentVersionId ===
                null
                  ? undefined
                  : versionsById.get(
                      version.parentVersionId,
                    );

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
                    onClick={() =>
                      onSelectVersion(
                        version.versionId,
                      )
                    }
                  >
                    <span className="version-history-button__marker" />

                    <span className="version-history-button__content">
                      <span className="version-history-button__top-line">
                        <strong>
                          Revision{" "}
                          {
                            version.revisionNumber
                          }
                        </strong>

                        <span className="version-history-button__badges">
                          {isCurrent && (
                            <span className="version-history-badge version-history-badge--current">
                              Current version
                            </span>
                          )}

                          {isSelected && (
                            <span className="version-history-badge version-history-badge--selected">
                              Selected
                            </span>
                          )}

                          {comparisonOpen &&
                            isCompareFrom && (
                              <span className="version-history-badge">
                                From
                              </span>
                            )}

                          {comparisonOpen &&
                            isCompareTo && (
                              <span className="version-history-badge">
                                To
                              </span>
                            )}
                        </span>
                      </span>

                      <span className="version-history-button__author">
                        {version.authorDisplayName ??
                          version.authorId}
                        {" · "}
                        {formatRole(
                          version.authorRole,
                        )}
                      </span>

                      <time
                        dateTime={
                          version.createdAt
                        }
                      >
                        {formatVersionDate(
                          version.createdAt,
                        )}
                      </time>

                      <span className="version-history-button__parent">
                        {parentVersion ===
                        undefined
                          ? version.parentVersionId ===
                            null
                            ? "Root version"
                            : "Parent version unavailable"
                          : `Based on revision ${parentVersion.revisionNumber}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            },
          )}
        </ol>
      )}

      {selectedVersion !==
        undefined &&
        selectedVersion.versionId !==
          currentVersionId &&
        !comparisonOpen && (
          <p
            className="version-history__historical-notice"
            role="status"
          >
            You are viewing a historical
            version. It is read-only and
            does not replace the current
            draft.
          </p>
        )}
    </section>
  );
}
