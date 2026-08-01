import { useEffect, useMemo, useRef, } from "react";

import type { NoteVersionDetail, } from "../../../../domain/noteDetail";

import {
  SOAP_VERSION_DIFF_SECTION_KEYS,
  compareSoapVersions,
  type SoapVersionDiffSectionKey,
  type WordDiffSegment,
} from "../../version-diff/wordDiff";

interface VersionDiffViewerProps {
  fromVersion: NoteVersionDetail;
  toVersion: NoteVersionDetail;
  onClose: () => void;
}

const SECTION_LABELS: Record<
  SoapVersionDiffSectionKey,
  string
> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
};

function formatDate(
  dateValue: string,
): string {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

function isUnchanged(
  segments: readonly WordDiffSegment[],
): boolean {
  return (
    segments.length === 0 ||
    segments.every(
      (segment) =>
        segment.type === "unchanged",
    )
  );
}

interface DiffSectionContentProps {
  segments: readonly WordDiffSegment[];
}

function DiffSectionContent({
  segments,
}: DiffSectionContentProps) {
  if (isUnchanged(segments)) {
    const unchangedContent =
      segments
        .map((segment) => segment.value)
        .join("");

    return (
      <>
        <p
          className="version-diff-no-change"
          role="status"
        >
          No changes.
        </p>

        {unchangedContent ? (
          <p className="version-diff-content">
            {unchangedContent}
          </p>
        ) : (
          <p className="version-diff-content">
            No content.
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <p className="version-diff-legend">
        Removed text is struck through.
        Added text is underlined.
      </p>

      <p className="version-diff-content">
        {segments.map(
          (segment, index) => {
            const key = [
              segment.type,
              index,
            ].join("-");

            switch (segment.type) {
              case "unchanged":
                return (
                  <span key={key}>
                    {segment.value}
                  </span>
                );

              case "removed":
                return (
                  <del
                    key={key}
                    aria-label={`Removed: ${segment.value}`}
                  >
                    {segment.value}
                  </del>
                );

              case "added":
                return (
                  <ins
                    key={key}
                    aria-label={`Added: ${segment.value}`}
                  >
                    {segment.value}
                  </ins>
                );
            }
          },
        )}
      </p>
    </>
  );
}

interface VersionMetadataProps {
  label: string;
  version: NoteVersionDetail;
}

function VersionMetadata({
  label,
  version,
}: VersionMetadataProps) {
  return (
    <article className="version-diff-metadata-card">
      <h3>{label}</h3>

      <dl>
        <div>
          <dt>Revision</dt>
          <dd>
            {version.revisionNumber}
          </dd>
        </div>

        <div>
          <dt>Author</dt>
          <dd>
            {version.authorDisplayName ??
              version.authorId}
          </dd>
        </div>

        <div>
          <dt>Created</dt>
          <dd>
            {formatDate(
              version.createdAt,
            )}
          </dd>
        </div>

        <div>
          <dt>Parent version</dt>
          <dd>
            {version.parentVersionId ??
              "Root version"}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function VersionDiffViewer({
  fromVersion,
  toVersion,
  onClose,
}: VersionDiffViewerProps) {
  const headingRef =
    useRef<HTMLHeadingElement | null>(
      null,
    );

  const difference = useMemo(
    () =>
      compareSoapVersions(
        fromVersion.content,
        toVersion.content,
      ),
    [
      fromVersion.content,
      toVersion.content,
    ],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      className="version-diff-viewer"
      aria-labelledby="version-diff-heading"
    >
      <header className="version-diff-header">
        <div>
          <h2
            id="version-diff-heading"
            ref={headingRef}
            tabIndex={-1}
          >
            Comparing revision{" "}
            {fromVersion.revisionNumber}{" "}
            to revision{" "}
            {toVersion.revisionNumber}
          </h2>

          <p>
            This is a read-only
            comparison of two saved note
            versions.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
        >
          Exit comparison
        </button>
      </header>

      <div className="version-diff-metadata">
        <VersionMetadata
          label="Earlier version"
          version={fromVersion}
        />

        <VersionMetadata
          label="Later version"
          version={toVersion}
        />
      </div>

      <div className="version-diff-sections">
        {SOAP_VERSION_DIFF_SECTION_KEYS.map(
          (section) => (
            <article
              key={section}
              className="version-diff-section"
              aria-labelledby={`version-diff-${section}`}
            >
              <h3
                id={`version-diff-${section}`}
              >
                {SECTION_LABELS[section]}
              </h3>

              <DiffSectionContent
                segments={
                  difference[section]
                }
              />
            </article>
          ),
        )}
      </div>
    </section>
  );
}