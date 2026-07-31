import { useMemo, useState, } from "react";

import type { SoapContent, } from "../../../../domain/noteAttributes";
import type { NoteDetail, } from "../../../../domain/noteDetail";
import { NoteDetailHeader } from "./NoteDetailHeader";
import { PatientSessionCard } from "./PatientSessionCard";
import { PresencePanel } from "./PresencePanel";
import { ReviewTimeline } from "./ReviewTimeline";
import { SoapEditor, type SoapSectionKey, } from "./SoapEditor";
import { VersionHistorySidebar } from "./VersionHistorySidebar";

interface NoteDetailWorkspaceProps {
  detail: NoteDetail;
}

type DirtySections = Record<
  SoapSectionKey,
  boolean
>;

function copySoapContent(
  content: SoapContent,
): SoapContent {
  return {
    subjective: content.subjective,
    objective: content.objective,
    assessment: content.assessment,
    plan: content.plan,
  };
}

function getDirtySections(
  draftContent: SoapContent,
  savedContent: SoapContent,
): DirtySections {
  return {
    subjective:
      draftContent.subjective !==
      savedContent.subjective,

    objective:
      draftContent.objective !==
      savedContent.objective,

    assessment:
      draftContent.assessment !==
      savedContent.assessment,

    plan:
      draftContent.plan !==
      savedContent.plan,
  };
}

export function NoteDetailWorkspace({
  detail,
}: NoteDetailWorkspaceProps) {
  const [
    savedContent,
  ] = useState<SoapContent>(() =>
    copySoapContent(
      detail.currentVersion.content,
    ),
  );

  const [
    draftContent,
    setDraftContent,
  ] = useState<SoapContent>(() =>
    copySoapContent(
      detail.currentVersion.content,
    ),
  );

  const dirtySections =
    useMemo(
      () =>
        getDirtySections(
          draftContent,
          savedContent,
        ),
      [
        draftContent,
        savedContent,
      ],
    );

  const isEditable =
    detail.note.status === "IN_REVIEW";

  function handleSectionChange(
    section: SoapSectionKey,
    value: string,
  ): void {
    setDraftContent(
      (currentContent) => ({
        ...currentContent,
        [section]: value,
      }),
    );
  }

  return (
    <>
      <NoteDetailHeader
        note={detail.note}
        patient={detail.patient}
        assignedReviewer={
          detail.assignedReviewer
        }
        revisionNumber={
          detail.currentVersion
            .revisionNumber
        }
      />

      <div className="note-detail-layout">
        <div className="note-detail-main">
          <PatientSessionCard
            patient={detail.patient}
            session={detail.session}
          />

          <SoapEditor
            content={draftContent}
            readOnly={!isEditable}
            dirtySections={
              dirtySections
            }
            onSectionChange={
              handleSectionChange
            }
          />

          <ReviewTimeline
            events={detail.timeline}
          />
        </div>

        <aside
          className="note-detail-sidebar"
          aria-label="Note supporting information"
        >
          <PresencePanel
            presence={detail.presence}
          />

          <VersionHistorySidebar
            versions={detail.versions}
            currentVersionId={
              detail.currentVersion
                .versionId
            }
          />
        </aside>
      </div>
    </>
  );
}