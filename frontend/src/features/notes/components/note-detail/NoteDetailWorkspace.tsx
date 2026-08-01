import { useCallback, useMemo, useRef, useState, } from "react";

import type { SoapContent, } from "../../../../domain/noteAttributes";
import type { NoteDetail, } from "../../../../domain/noteDetail";
import type { SaveNoteVersionActor, } from "../../../../domain/noteSave";
import type { AutosaveSnapshot, AutosaveSuccess, } from "../../autosave/AutosaveCoordinator";
import { useNoteAutosave, } from "../../hooks/useNoteAutosave";
import { NoteDetailHeader } from "./NoteDetailHeader";
import { PatientSessionCard } from "./PatientSessionCard";
import { PresencePanel } from "./PresencePanel";
import { ReviewTimeline } from "./ReviewTimeline";
import { SoapEditor, type SoapSectionKey, } from "./SoapEditor";
import { VersionHistorySidebar } from "./VersionHistorySidebar";

interface NoteDetailWorkspaceProps {
  detail: NoteDetail;
  actor: SaveNoteVersionActor;
}

type DirtySections = Record<
  SoapSectionKey,
  boolean
>;

interface AutosaveStatusProps {
  snapshot: AutosaveSnapshot;
  onRetry: () => void;
}

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

const CLEAN_SECTIONS: DirtySections = {
    subjective: false,
    objective: false,
    assessment: false,
    plan: false,
  };

function AutosaveStatus({
  snapshot,
  onRetry,
}: AutosaveStatusProps) {
  switch (snapshot.status) {
    case "changes-pending":
      return (
        <p
          className="note-autosave-status"
          role="status"
        >
          Changes pending
        </p>
      );

    case "saving":
      return (
        <p
          className="note-autosave-status"
          role="status"
        >
          Saving…
        </p>
      );

    case "save-failed":
      return (
        <div
          className="note-autosave-status"
          role="alert"
        >
          <span>Save failed.</span>

          <button
            type="button"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      );

    case "conflict":
      return (
        <p
          className="note-autosave-status"
          role="alert"
        >
          Conflict requires attention. This
          note was updated elsewhere.
        </p>
      );

    case "idle":
      return (
        <p
          className="note-autosave-status"
          role="status"
        >
          Saved
        </p>
      );
  }
}

export function NoteDetailWorkspace({
  detail,
  actor,
}: NoteDetailWorkspaceProps) {
  const [
    workspaceDetail,
    setWorkspaceDetail,
  ] = useState<NoteDetail>(() => detail);

  const [
    savedContent,
    setSavedContent,
  ] = useState<SoapContent>(() =>
    copySoapContent(
      detail.currentVersion.content,
    ),
  );

  const initialDraftContent =
    copySoapContent(
      detail.currentVersion.content,
    );

  const [
    draftContent,
    setDraftContent,
  ] = useState<SoapContent>(
    initialDraftContent,
  );

  const [
    historicalVersionId,
    setHistoricalVersionId,
  ] = useState<string | null>(null);

  const historicalVersion = useMemo(
    () => {
      if (
        historicalVersionId === null
      ) {
        return null;
      }

      return (
        workspaceDetail.versions.find(
          (version) =>
            version.versionId ===
            historicalVersionId,
        ) ?? null
      );
    },
    [
      historicalVersionId,
      workspaceDetail.versions,
    ],
  );

  const draftContentRef =
    useRef<SoapContent>(
      initialDraftContent,
    );

  const dirtySections = useMemo(
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

  const isViewingHistoricalVersion =
    historicalVersion !== null;

  const displayedContent =
    historicalVersion?.content ??
    draftContent;

  const displayedDirtySections =
    isViewingHistoricalVersion
      ? CLEAN_SECTIONS
      : dirtySections;

  const isEditable =
    workspaceDetail.note.status ===
    "IN_REVIEW";

  const handleSaveSuccess = useCallback(
    ({
      response,
      savedContent:
        successfullySavedContent,
    }: AutosaveSuccess): void => {
      setSavedContent(
        copySoapContent(
          successfullySavedContent,
        ),
      );

      setWorkspaceDetail(
        (currentDetail) => {
          const versionAlreadyExists =
            currentDetail.versions.some(
              (version) =>
                version.versionId ===
                response.savedVersion
                  .versionId,
            );

          return {
            ...currentDetail,

            note: response.note,

            currentVersion:
              response.savedVersion,

            versions:
              versionAlreadyExists
                ? currentDetail.versions
                : [
                    ...currentDetail.versions,
                    response.savedVersion,
                  ],
          };
        },
      );
    },
    [],
  );

  const {
    snapshot: autosaveSnapshot,
    updateDraft: queueAutosave,
    retry: retryAutosave,
  } = useNoteAutosave({
    noteId: detail.note.id,
    actor,

    initialBaseVersionId:
      detail.currentVersion.versionId,

    initialContent:
      detail.currentVersion.content,

    debounceMs: 500,

    onSaveSuccess:
      handleSaveSuccess,
  });

  function handleSectionChange(
    section: SoapSectionKey,
    value: string,
  ): void {
    const nextContent: SoapContent = {
      ...draftContentRef.current,
      [section]: value,
    };

    draftContentRef.current =
      nextContent;

    setDraftContent(nextContent);

    queueAutosave(nextContent);
  }

  function handleVersionSelect(
    versionId: string,
  ): void {
    const isCurrentVersion =
      versionId ===
      workspaceDetail.currentVersion
        .versionId;

    if (isCurrentVersion) {
      setHistoricalVersionId(null);
      return;
    }

    setHistoricalVersionId(versionId);
  }

  return (
    <>
      <NoteDetailHeader
        note={workspaceDetail.note}
        patient={workspaceDetail.patient}
        assignedReviewer={
          workspaceDetail.assignedReviewer
        }
        revisionNumber={
          workspaceDetail.currentVersion
            .revisionNumber
        }
      />

      <div className="note-detail-layout">
        <div className="note-detail-main">
          <PatientSessionCard
            patient={
              workspaceDetail.patient
            }
            session={
              workspaceDetail.session
            }
          />

          {isEditable ? (
            <AutosaveStatus
              snapshot={
                autosaveSnapshot
              }
              onRetry={
                retryAutosave
              }
            />
          ) : null}

          {historicalVersion ? (
            <p
              className="historical-version-notice"
              role="status"
            >
              Viewing revision{" "}
              {historicalVersion.revisionNumber}.
              Historical versions are read-only.
            </p>
          ) : null}

          <SoapEditor
            content={displayedContent}
            readOnly={
              !isEditable ||
              isViewingHistoricalVersion
            }
            dirtySections={
              displayedDirtySections
            }
            onSectionChange={
              handleSectionChange
            }
          />

          <ReviewTimeline
            events={
              workspaceDetail.timeline
            }
          />
        </div>

        <aside
          className="note-detail-sidebar"
          aria-label="Note supporting information"
        >
          <PresencePanel
            presence={
              workspaceDetail.presence
            }
          />

          <VersionHistorySidebar
            versions={
              workspaceDetail.versions
            }
            currentVersionId={
              workspaceDetail.currentVersion
                .versionId
            }
            selectedVersionId={
              historicalVersionId ??
              workspaceDetail.currentVersion
                .versionId
            }
            onSelectVersion={
              handleVersionSelect
            }
          />
        </aside>
      </div>
    </>
  );
}