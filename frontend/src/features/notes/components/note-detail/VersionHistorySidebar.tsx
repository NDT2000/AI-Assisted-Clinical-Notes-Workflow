import type { NoteVersionDetail, } from "../../../../domain/noteDetail";

interface VersionHistorySidebarProps {
  versions: NoteVersionDetail[];
  currentVersionId: string;
  selectedVersionId: string;
  onSelectVersion: (
    versionId: string,
  ) => void;
}

function formatVersionDate(
  value: string,
): string {
  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(new Date(value));
}

export function VersionHistorySidebar({
  versions,
  currentVersionId,
  selectedVersionId,
  onSelectVersion,
}: VersionHistorySidebarProps) {
  const sortedVersions = [
    ...versions,
  ].sort(
    (firstVersion, secondVersion) =>
      secondVersion.revisionNumber -
      firstVersion.revisionNumber,
  );

  return (
    <section
      className="note-detail-card"
      aria-labelledby="version-history-heading"
    >
      <h2 id="version-history-heading">
        Version history
      </h2>

      {sortedVersions.length === 0 ? (
        <p>No versions available.</p>
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

              return (
                <li
                  key={version.versionId}
                  className="version-history-item"
                >
                  <button
                    type="button"
                    className={
                      isSelected
                        ? "version-history-button version-history-button--selected"
                        : "version-history-button"
                    }
                    aria-pressed={
                      isSelected
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
                      {
                        version.authorDisplayName
                      }
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