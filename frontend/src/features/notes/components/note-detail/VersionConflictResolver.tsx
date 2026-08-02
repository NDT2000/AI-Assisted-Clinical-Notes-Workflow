import {
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import type {
  SoapContent,
} from "../../../../domain/noteAttributes";
import {
  SOAP_CONFLICT_SECTION_KEYS,
  compareSoapConflict,
  resolveSoapConflict,
  type SoapConflictResolution,
  type SoapConflictResolutions,
  type SoapConflictSectionKey,
  type SoapSectionComparisonStatus,
} from "../../autosave/noteConflictResolution";
import "./css/VersionConflictResolver.css";

interface VersionConflictResolverProps {
  ancestorContent: SoapContent;
  localContent: SoapContent;
  serverContent: SoapContent;
  onResolve: (
    resolvedContent: SoapContent,
  ) => void;
}

const SECTION_LABELS: Record<
  SoapConflictSectionKey,
  string
> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
};

const SECTION_SHORT_LABELS: Record<
  SoapConflictSectionKey,
  string
> = {
  subjective: "S",
  objective: "O",
  assessment: "A",
  plan: "P",
};

function getAutomaticResolutionMessage(
  status: SoapSectionComparisonStatus,
): string | null {
  switch (status) {
    case "unchanged":
      return "Neither version changed this section.";

    case "local-only":
      return "Only your version changed. Your change will be preserved.";

    case "server-only":
      return "Only the server version changed. The server change will be preserved.";

    case "same-change":
      return "Both versions made the same change.";

    case "conflict":
      return null;
  }
}

function getStatusLabel(
  status: SoapSectionComparisonStatus,
): string {
  switch (status) {
    case "unchanged":
      return "No change";
    case "local-only":
      return "Your change";
    case "server-only":
      return "Server change";
    case "same-change":
      return "Same change";
    case "conflict":
      return "Choice required";
  }
}

function displayContent(
  value: string,
): string {
  return value.trim()
    ? value
    : "No content";
}

export function VersionConflictResolver({
  ancestorContent,
  localContent,
  serverContent,
  onResolve,
}: VersionConflictResolverProps) {
  const formId = useId();

  const [
    resolutions,
    setResolutions,
  ] =
    useState<SoapConflictResolutions>(
      {},
    );

  const comparison = useMemo(
    () =>
      compareSoapConflict(
        ancestorContent,
        localContent,
        serverContent,
      ),
    [
      ancestorContent,
      localContent,
      serverContent,
    ],
  );

  const resolvedContent = useMemo(
    () =>
      resolveSoapConflict(
        comparison,
        resolutions,
      ),
    [comparison, resolutions],
  );

  const conflictCount =
    SOAP_CONFLICT_SECTION_KEYS.filter(
      (section) =>
        comparison[section].status ===
        "conflict",
    ).length;

  const unresolvedCount =
    SOAP_CONFLICT_SECTION_KEYS.filter(
      (section) =>
        comparison[section].status ===
          "conflict" &&
        resolutions[section] ===
          undefined,
    ).length;

  const resolvedConflictCount =
    conflictCount - unresolvedCount;

  function updateResolution(
    section: SoapConflictSectionKey,
    resolution: SoapConflictResolution,
  ): void {
    setResolutions(
      (currentResolutions) => ({
        ...currentResolutions,
        [section]: resolution,
      }),
    );
  }

  function selectManualResolution(
    section: SoapConflictSectionKey,
  ): void {
    const currentResolution =
      resolutions[section];

    updateResolution(section, {
      source: "manual",
      value:
        currentResolution?.source ===
        "manual"
          ? currentResolution.value
          : comparison[section].local,
    });
  }

  function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): void {
    event.preventDefault();

    if (resolvedContent === null) {
      return;
    }

    onResolve(resolvedContent);
  }

  return (
    <section
      className="version-conflict-resolver"
      aria-labelledby={`${formId}-title`}
    >
      <header className="version-conflict-header">
        <div>
          <p className="version-conflict-eyebrow">
            Concurrent edit detected
          </p>

          <h2 id={`${formId}-title`}>
            Resolve version conflict
          </h2>

          <p>
            Another reviewer saved a newer
            version while you were editing.
            Review each SOAP section before
            saving your resolved version.
          </p>
        </div>

        <span
          className={
            unresolvedCount === 0
              ? "version-conflict-count version-conflict-count--resolved"
              : "version-conflict-count"
          }
        >
          {unresolvedCount === 0
            ? "Ready to save"
            : `${unresolvedCount} unresolved`}
        </span>
      </header>

      <div className="version-conflict-progress">
        <div>
          <strong>
            {resolvedConflictCount} of{" "}
            {conflictCount}
          </strong>

          <span>
            conflicting sections resolved
          </span>
        </div>

        <progress
          max={Math.max(
            conflictCount,
            1,
          )}
          value={
            conflictCount === 0
              ? 1
              : resolvedConflictCount
          }
          aria-label="Conflict resolution progress"
        />
      </div>

      <p
        className="version-conflict-summary"
        role="status"
        aria-live="polite"
      >
        {unresolvedCount === 0
          ? "All conflicting sections have been resolved."
          : `${unresolvedCount} conflicting ${
              unresolvedCount === 1
                ? "section remains"
                : "sections remain"
            }.`}
      </p>

      <div className="version-conflict-key">
        <span>
          <strong>
            Common ancestor
          </strong>
          Original shared version
        </span>

        <span>
          <strong>Your version</strong>
          Your unsaved draft
        </span>

        <span>
          <strong>Server version</strong>
          Latest saved version
        </span>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="version-conflict-sections">
          {SOAP_CONFLICT_SECTION_KEYS.map(
            (section) => {
              const sectionComparison =
                comparison[section];

              const label =
                SECTION_LABELS[section];

              const automaticMessage =
                getAutomaticResolutionMessage(
                  sectionComparison.status,
                );

              const resolution =
                resolutions[section];

              const sectionResolved =
                sectionComparison.status !==
                  "conflict" ||
                resolution !== undefined;

              return (
                <fieldset
                  key={section}
                  className="version-conflict-section"
                  data-conflict={
                    sectionComparison.status ===
                    "conflict"
                      ? "true"
                      : "false"
                  }
                  data-resolved={
                    sectionResolved
                      ? "true"
                      : "false"
                  }
                >
                  <legend>
                    <span
                      className="version-conflict-section-letter"
                      aria-hidden="true"
                    >
                      {
                        SECTION_SHORT_LABELS[
                          section
                        ]
                      }
                    </span>

                    <span>{label}</span>

                    <span
                      className={`version-conflict-section-status version-conflict-section-status--${sectionComparison.status}`}
                    >
                      {getStatusLabel(
                        sectionComparison.status,
                      )}
                    </span>
                  </legend>

                  <div className="version-conflict-columns">
                    <article className="version-conflict-source version-conflict-source--ancestor">
                      <h3>
                        Common ancestor
                      </h3>

                      <p>
                        {displayContent(
                          sectionComparison.ancestor,
                        )}
                      </p>
                    </article>

                    <article className="version-conflict-source version-conflict-source--local">
                      <h3>
                        Your version
                      </h3>

                      <p>
                        {displayContent(
                          sectionComparison.local,
                        )}
                      </p>
                    </article>

                    <article className="version-conflict-source version-conflict-source--server">
                      <h3>
                        Server version
                      </h3>

                      <p>
                        {displayContent(
                          sectionComparison.server,
                        )}
                      </p>
                    </article>
                  </div>

                  {automaticMessage !==
                  null ? (
                    <p
                      className="version-conflict-automatic"
                      role="status"
                    >
                      <span
                        aria-hidden="true"
                      >
                        ✓
                      </span>

                      {automaticMessage}
                    </p>
                  ) : (
                    <div className="version-conflict-options">
                      <p>
                        Choose how this section
                        should be resolved.
                      </p>

                      <div className="version-conflict-option-grid">
                        <label
                          data-selected={
                            resolution?.source ===
                            "local"
                              ? "true"
                              : "false"
                          }
                        >
                          <input
                            type="radio"
                            name={`${formId}-${section}`}
                            checked={
                              resolution?.source ===
                              "local"
                            }
                            aria-label={`Keep my version for ${label}`}
                            onChange={() => {
                              updateResolution(
                                section,
                                {
                                  source:
                                    "local",
                                },
                              );
                            }}
                          />

                          <span>
                            <strong>
                              Keep my version
                            </strong>

                            Use your unsaved
                            draft for this
                            section.
                          </span>
                        </label>

                        <label
                          data-selected={
                            resolution?.source ===
                            "server"
                              ? "true"
                              : "false"
                          }
                        >
                          <input
                            type="radio"
                            name={`${formId}-${section}`}
                            checked={
                              resolution?.source ===
                              "server"
                            }
                            aria-label={`Use server version for ${label}`}
                            onChange={() => {
                              updateResolution(
                                section,
                                {
                                  source:
                                    "server",
                                },
                              );
                            }}
                          />

                          <span>
                            <strong>
                              Use server version
                            </strong>

                            Accept the latest
                            saved content.
                          </span>
                        </label>

                        <label
                          data-selected={
                            resolution?.source ===
                            "manual"
                              ? "true"
                              : "false"
                          }
                        >
                          <input
                            type="radio"
                            name={`${formId}-${section}`}
                            checked={
                              resolution?.source ===
                              "manual"
                            }
                            aria-label={`Manually merge ${label}`}
                            onChange={() => {
                              selectManualResolution(
                                section,
                              );
                            }}
                          />

                          <span>
                            <strong>
                              Merge manually
                            </strong>

                            Write a combined
                            version yourself.
                          </span>
                        </label>
                      </div>

                      {resolution?.source ===
                      "manual" ? (
                        <label className="version-conflict-manual">
                          <span>
                            Merged {label}
                          </span>

                          <textarea
                            value={
                              resolution.value
                            }
                            rows={7}
                            aria-label={`Merged ${label}`}
                            onChange={(event) => {
                              updateResolution(
                                section,
                                {
                                  source:
                                    "manual",
                                  value:
                                    event.target
                                      .value,
                                },
                              );
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  )}
                </fieldset>
              );
            },
          )}
        </div>

        <footer className="version-conflict-footer">
          <div>
            <strong>
              {unresolvedCount === 0
                ? "Resolution complete"
                : "Resolution incomplete"}
            </strong>

            <span>
              {unresolvedCount === 0
                ? "Save to create a new version based on the current server head."
                : "Resolve every conflicting section before saving."}
            </span>
          </div>

          <button
            type="submit"
            disabled={
              resolvedContent === null
            }
          >
            Save resolved version
          </button>
        </footer>
      </form>
    </section>
  );
}
