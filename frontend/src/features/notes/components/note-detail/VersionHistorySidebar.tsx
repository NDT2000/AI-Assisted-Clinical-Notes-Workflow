import type { NoteVersionDetail, } from "../../../domain/noteDetail";

interface VersionHistorySidebarProps {
  versions: NoteVersionDetail[];
  currentVersionId: string;
}

function formatDateTime(
  value: string,
): string {
  return new Date(value).toLocaleString();
}

function formatRole(
  role: NoteVersionDetail["authorRole"],
): string {
  return role
    .toLowerCase()
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1),
    )
    .join(" ");
}

export function VersionHistorySidebar({
  versions,
  currentVersionId,
}: VersionHistorySidebarProps) {
  const orderedVersions = [
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
      <div className="version-history-heading">
        <h2 id="version-history-heading">
          Version history
        </h2>

        <span className="version-history-count">
          {versions.length}
        </span>
      </div>

      {orderedVersions.length === 0 ? (
        <p className="version-history-empty">
          No versions are available.
        </p>
      ) : (
        <ol className="version-history-list">
          {orderedVersions.map(
            (version) => {
              const isCurrent =
                version.versionId ===
                currentVersionId;

              return (
                <li
                  className={
                    isCurrent
                      ? "version-history-item version-history-item-current"
                      : "version-history-item"
                  }
                  key={version.versionId}
                >
                  <div className="version-history-item-heading">
                    <strong>
                      Revision{" "}
                      {
                        version.revisionNumber
                      }
                    </strong>

                    {isCurrent && (
                      <span className="version-current-badge">
                        Current
                      </span>
                    )}
                  </div>

                  <dl className="version-history-details">
                    <div>
                      <dt>Author</dt>
                      <dd>
                        {
                          version.authorDisplayName
                        }
                      </dd>
                    </div>

                    <div>
                      <dt>Role</dt>
                      <dd>
                        {formatRole(
                          version.authorRole,
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt>Created</dt>
                      <dd>
                        <time
                          dateTime={
                            version.createdAt
                          }
                        >
                          {formatDateTime(
                            version.createdAt,
                          )}
                        </time>
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            },
          )}
        </ol>
      )}
    </section>
  );
}