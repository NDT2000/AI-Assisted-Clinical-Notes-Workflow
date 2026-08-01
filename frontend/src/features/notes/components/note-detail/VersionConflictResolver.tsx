import { useId, useMemo, useState, } from "react";

import type { SoapContent, } from "../../../../domain/noteAttributes";

import {
  SOAP_CONFLICT_SECTION_KEYS,
  compareSoapConflict,
  resolveSoapConflict,
  type SoapConflictResolution,
  type SoapConflictResolutions,
  type SoapConflictSectionKey,
  type SoapSectionComparisonStatus,
} from "../../autosave/noteConflictResolution";

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

  const unresolvedCount =
    SOAP_CONFLICT_SECTION_KEYS.filter(
      (section) =>
        comparison[section].status ===
          "conflict" &&
        resolutions[section] ===
          undefined,
    ).length;

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
    event: React.FormEvent<HTMLFormElement>,
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
      <h2 id={`${formId}-title`}>
        Resolve version conflict
      </h2>

      <p>
        Another reviewer saved a newer
        version while you were editing.
        Review each SOAP section before
        saving your resolved version.
      </p>

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

      <form onSubmit={handleSubmit}>
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

            return (
              <fieldset
                key={section}
                className="version-conflict-section"
              >
                <legend>{label}</legend>

                <div className="version-conflict-columns">
                  <article>
                    <h3>Common ancestor</h3>

                    <p>
                      {displayContent(
                        sectionComparison.ancestor,
                      )}
                    </p>
                  </article>

                  <article>
                    <h3>Your version</h3>

                    <p>
                      {displayContent(
                        sectionComparison.local,
                      )}
                    </p>
                  </article>

                  <article>
                    <h3>Server version</h3>

                    <p>
                      {displayContent(
                        sectionComparison.server,
                      )}
                    </p>
                  </article>
                </div>

                {automaticMessage !==
                null ? (
                  <p role="status">
                    {automaticMessage}
                  </p>
                ) : (
                  <div className="version-conflict-options">
                    <label>
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

                      Keep my version
                    </label>

                    <label>
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

                      Use server version
                    </label>

                    <label>
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

                      Merge manually
                    </label>

                    {resolution?.source ===
                    "manual" ? (
                      <label>
                        Merged {label}

                        <textarea
                          value={
                            resolution.value
                          }
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

        <button
          type="submit"
          disabled={
            resolvedContent === null
          }
        >
          Save resolved version
        </button>
      </form>
    </section>
  );
}