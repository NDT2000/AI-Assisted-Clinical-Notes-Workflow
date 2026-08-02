import type {
  SoapContent,
} from "../../../../domain/noteAttributes";

export type SoapSectionKey =
  keyof SoapContent;

interface SoapEditorProps {
  content: SoapContent;
  readOnly: boolean;
  dirtySections?: Partial<
    Record<SoapSectionKey, boolean>
  >;
  onSectionChange?: (
    section: SoapSectionKey,
    value: string,
  ) => void;
}

interface SoapSectionDefinition {
  key: SoapSectionKey;
  label: string;
  shortLabel: string;
  description: string;
}

const SOAP_SECTIONS:
  readonly SoapSectionDefinition[] = [
    {
      key: "subjective",
      label: "Subjective",
      shortLabel: "S",
      description:
        "Symptoms, concerns and information reported by the patient.",
    },
    {
      key: "objective",
      label: "Objective",
      shortLabel: "O",
      description:
        "Observed findings, measurements and examination results.",
    },
    {
      key: "assessment",
      label: "Assessment",
      shortLabel: "A",
      description:
        "Clinical interpretation and working assessment.",
    },
    {
      key: "plan",
      label: "Plan",
      shortLabel: "P",
      description:
        "Treatment, follow-up and recommended next steps.",
    },
  ];

export function SoapEditor({
  content,
  readOnly,
  dirtySections = {},
  onSectionChange,
}: SoapEditorProps) {
  const dirtySectionCount =
    SOAP_SECTIONS.filter(
      ({ key }) =>
        dirtySections[key] === true,
    ).length;

  return (
    <section
      className="note-detail-card soap-editor"
      aria-labelledby="soap-editor-heading"
    >
      <div className="soap-editor-heading">
        <div>
          <p className="soap-editor-eyebrow">
            Clinical documentation
          </p>

          <h2 id="soap-editor-heading">
            SOAP note
          </h2>

          <p>
            Revision content is organized
            into four clinical sections.
          </p>
        </div>

        <div className="soap-editor-state">
          {readOnly ? (
            <span className="soap-readonly-badge">
              Read only
            </span>
          ) : dirtySectionCount > 0 ? (
            <span className="soap-dirty-summary">
              {dirtySectionCount}{" "}
              {dirtySectionCount === 1
                ? "section"
                : "sections"}{" "}
              changed
            </span>
          ) : (
            <span className="soap-editable-badge">
              Editable
            </span>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="soap-readonly-message">
          This version can be reviewed,
          but its clinical content cannot
          be changed.
        </p>
      )}

      <div className="soap-section-list">
        {SOAP_SECTIONS.map(
          ({
            key,
            label,
            shortLabel,
            description,
          }) => {
            const isDirty =
              dirtySections[key] === true;

            const descriptionId =
              `soap-${key}-description`;

            const statusId =
              `soap-${key}-status`;

            return (
              <article
                className="soap-section"
                data-dirty={
                  isDirty
                    ? "true"
                    : "false"
                }
                data-readonly={
                  readOnly
                    ? "true"
                    : "false"
                }
                key={key}
              >
                <div className="soap-section-header">
                  <div className="soap-section-title">
                    <span
                      className="soap-section-letter"
                      aria-hidden="true"
                    >
                      {shortLabel}
                    </span>

                    <div>
                      <label
                        htmlFor={`soap-${key}`}
                      >
                        {label}
                      </label>

                      <p id={descriptionId}>
                        {description}
                      </p>
                    </div>
                  </div>

                  {isDirty && (
                    <span
                      id={statusId}
                      className="soap-dirty-indicator"
                    >
                      Unsaved changes
                    </span>
                  )}
                </div>

                <textarea
                  id={`soap-${key}`}
                  value={content[key]}
                  readOnly={readOnly}
                  rows={7}
                  aria-describedby={[
                    descriptionId,
                    isDirty
                      ? statusId
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onChange={(event) => {
                    if (
                      readOnly ||
                      onSectionChange ===
                        undefined
                    ) {
                      return;
                    }

                    onSectionChange(
                      key,
                      event.target.value,
                    );
                  }}
                />
              </article>
            );
          },
        )}
      </div>
    </section>
  );
}
