import type { SoapContent, } from "../../../../domain/noteAttributes";

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
  description: string;
}

const SOAP_SECTIONS:
  readonly SoapSectionDefinition[] = [
    {
      key: "subjective",
      label: "Subjective",
      description:
        "Symptoms, concerns and information reported by the patient.",
    },
    {
      key: "objective",
      label: "Objective",
      description:
        "Observed findings, measurements and examination results.",
    },
    {
      key: "assessment",
      label: "Assessment",
      description:
        "Clinical interpretation and working assessment.",
    },
    {
      key: "plan",
      label: "Plan",
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
  return (
    <section
      className="note-detail-card"
      aria-labelledby="soap-editor-heading"
    >
      <div className="soap-editor-heading">
        <div>
          <h2 id="soap-editor-heading">
            SOAP note
          </h2>

          <p>
            Revision content is organized
            into four clinical sections.
          </p>
        </div>

        {readOnly && (
          <span className="soap-readonly-badge">
            Read only
          </span>
        )}
      </div>

      <div className="soap-section-list">
        {SOAP_SECTIONS.map(
          ({
            key,
            label,
            description,
          }) => {
            const isDirty =
              dirtySections[key] === true;

            return (
              <div
                className="soap-section"
                key={key}
              >
                <div className="soap-section-header">
                  <div>
                    <label
                      htmlFor={`soap-${key}`}
                    >
                      {label}
                    </label>

                    <p>{description}</p>
                  </div>

                  {isDirty && (
                    <span className="soap-dirty-indicator">
                      Unsaved changes
                    </span>
                  )}
                </div>

                <textarea
                  id={`soap-${key}`}
                  value={content[key]}
                  readOnly={readOnly}
                  rows={6}
                  onChange={(event) => {
                    if (
                      readOnly ||
                      !onSectionChange
                    ) {
                      return;
                    }

                    onSectionChange(
                      key,
                      event.target.value,
                    );
                  }}
                />
              </div>
            );
          },
        )}
      </div>
    </section>
  );
}