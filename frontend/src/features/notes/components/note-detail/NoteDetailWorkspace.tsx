import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  Actor,
} from "../../../../domain/actor";
import type {
  SoapContent,
} from "../../../../domain/noteAttributes";
import {
  canEditNoteContent,
} from "../../../../domain/noteGuards";
import type {
  NoteDetail,
  UserSummary,
} from "../../../../domain/noteDetail";
import type {
  UserNoteActionTrigger,
} from "../../../../domain/noteTransition";
import type {
  AutosaveSuccess,
} from "../../autosave/AutosaveCoordinator";
import {
  type UnresolvedSave,
  useNoteAutosave,
} from "../../hooks/useNoteAutosave";
import {
  useOptimisticNoteTransition,
} from "../../hooks/useOptimisticNoteTransition";
import {
  useVersionComparison,
} from "../../hooks/useVersionComparison";
import {
  applyRealtimeEventToNoteDetail,
} from "../../realtime/realtimeReconciliation";
import {
  useNoteDetailRealtime,
} from "../../realtime/useNoteDetailRealtime";
import {
  AutosaveStatus,
} from "./AutosaveStatus";
import {
  NoteActionBar,
} from "./NoteActionBar";
import {
  deriveAvailableNoteActions,
  type ActionExecutionState,
} from "./noteActionBarModel";
import {
  NoteDetailHeader,
} from "./NoteDetailHeader";
import {
  NotePermissionSummary,
} from "./NotePermissionSummary";
import {
  PatientSessionCard,
} from "./PatientSessionCard";
import {
  PresencePanel,
} from "./PresencePanel";
import {
  ReviewerAssignmentPanel,
} from "./ReviewerAssignmentPanel";
import {
  ReviewTimeline,
} from "./ReviewTimeline";
import {
  SoapEditor,
  type SoapSectionKey,
} from "./SoapEditor";
import {
  VersionHistorySidebar,
} from "./VersionHistorySidebar";
import {
  VersionConflictResolver,
} from "./VersionConflictResolver";
import {
  VersionDiffViewer,
} from "./VersionDiffViewer";
import {
  WorkflowStatusGuidance,
} from "./WorkflowStatusGuidance";

interface NoteDetailWorkspaceProps {
  detail: NoteDetail;
  actor: Actor;
  onUnresolvedSaveChange?: (
    unresolvedSave: UnresolvedSave | null,
  ) => void;
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

const CLEAN_SECTIONS:
  DirtySections = {
    subjective: false,
    objective: false,
    assessment: false,
    plan: false,
  };

export function NoteDetailWorkspace({
  detail,
  actor,
  onUnresolvedSaveChange,
}: NoteDetailWorkspaceProps) {
  const [
    workspaceDetail,
    setWorkspaceDetail,
  ] = useState<NoteDetail>(
    () => detail,
  );

  // Latest committed detail, for event callbacks such as real-time.
  const workspaceDetailRef =
    useRef<NoteDetail>(
      detail,
    );

  useEffect(() => {
    workspaceDetailRef.current =
      workspaceDetail;
  }, [workspaceDetail]);

  const [
    savedContent,
    setSavedContent,
  ] = useState<SoapContent>(
    () =>
      copySoapContent(
        detail.currentVersion
          .content,
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

  const comparison =
    useVersionComparison(
      workspaceDetail.versions,
      workspaceDetail.currentVersion,
    );

  const {
    historicalVersion,
    historicalVersionId,
    comparisonStatus,
    compareFromVersionId,
    compareToVersionId,
    compareFromVersion,
    compareToVersion,
    isComparisonOpen,
    isComparingVersions,
    returnToCurrentVersion,
  } = comparison;

  const [
    rejectionReason,
    setRejectionReason,
  ] = useState("");

  const clearRejectionReason =
    useCallback(() => {
      setRejectionReason("");
    }, []);

  const [
    realtimeNotice,
    setRealtimeNotice,
  ] = useState<string | null>(
    null,
  );

  const draftContentRef =
    useRef<SoapContent>(
      initialDraftContent,
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

  const hasDirtySections =
    Object.values(
      dirtySections,
    ).some(Boolean);

  const isViewingHistoricalVersion =
    historicalVersion !== null;

  const displayedContent =
    historicalVersion?.content ??
    draftContent;

  const displayedDirtySections =
    isViewingHistoricalVersion
      ? CLEAN_SECTIONS
      : dirtySections;

  const handleSaveSuccess =
    useCallback(
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
          currentDetail => {
            const versionAlreadyExists =
              currentDetail.versions.some(
                version =>
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
    conflict: autosaveConflict,
    updateDraft: queueAutosave,
    retry: retryAutosave,
    resolveConflict:
      resolveAutosaveConflict,
    adoptServerVersion:
      adoptAutosaveServerVersion,
    unresolvedSave,
  } = useNoteAutosave({
    noteId: detail.note.id,
    actor,
    initialBaseVersionId:
      detail.currentVersion
        .versionId,
    initialContent:
      detail.currentVersion
        .content,
    debounceMs: 500,
    onSaveSuccess:
      handleSaveSuccess,
  });

  useEffect(() => {
    onUnresolvedSaveChange?.(
      unresolvedSave,
    );

    return () => {
      onUnresolvedSaveChange?.(null);
    };
  }, [
    onUnresolvedSaveChange,
    unresolvedSave,
  ]);

  const handleConflictResolve =
    useCallback(
      (
        resolvedContent:
          SoapContent,
      ): void => {
        if (
          autosaveConflict === null
        ) {
          return;
        }

        const nextContent =
          copySoapContent(
            resolvedContent,
          );

        draftContentRef.current =
          nextContent;

        setDraftContent(
          nextContent,
        );

        returnToCurrentVersion();

        setWorkspaceDetail(
          currentDetail => {
            const serverVersion =
              autosaveConflict
                .currentVersion;

            const serverVersionExists =
              currentDetail.versions.some(
                version =>
                  version.versionId ===
                  serverVersion
                    .versionId,
              );

            if (
              serverVersionExists
            ) {
              return currentDetail;
            }

            return {
              ...currentDetail,
              versions: [
                ...currentDetail.versions,
                serverVersion,
              ],
            };
          },
        );

        resolveAutosaveConflict(
          nextContent,
          autosaveConflict
            .currentVersion
            .versionId,
        );
      },
      [
        autosaveConflict,
        resolveAutosaveConflict,
        returnToCurrentVersion,
      ],
    );

  const {
    transitionState,
    actionSourceDetail,
    runAction,
  } = useOptimisticNoteTransition({
    actor,
    detail: workspaceDetail,
    setDetail: setWorkspaceDetail,
    onSucceeded: clearRejectionReason,
  });


  useNoteDetailRealtime({
    noteId: workspaceDetail.note.id,
    getDetail: () =>
      workspaceDetailRef.current,
    applyEvent: event => {
      setWorkspaceDetail(
        currentDetail => {
          const nextDetail =
            applyRealtimeEventToNoteDetail(
              currentDetail,
              event,
            );

          workspaceDetailRef.current =
            nextDetail;

          return nextDetail;
        },
      );
    },
    autosaveStatus:
      autosaveSnapshot.status,
    hasDirtySections,
    adoptServerVersion:
      adoptAutosaveServerVersion,
    onServerContentAdopted: content => {
      setSavedContent(content);
      setDraftContent(content);
      draftContentRef.current = content;
    },
    onNotice: setRealtimeNotice,
  });

  const editPermission =
    useMemo(
      () =>
        canEditNoteContent(
          workspaceDetail.note,
          actor,
        ),
      [
        actor,
        workspaceDetail.note,
      ],
    );

  const isEditable =
    editPermission.allowed &&
    transitionState.status !==
      "pending";

  const editorReadOnlyReason =
    !editPermission.allowed
      ? editPermission.reason
      : transitionState.status ===
        "pending"
      ? "Editing is temporarily unavailable while the current action is pending."
      : null;

  const workspaceBlockReason =
    useMemo(() => {
      if (isComparisonOpen) {
        return "Exit version comparison before running an action.";
      }

      if (
        isViewingHistoricalVersion
      ) {
        return "Return to the current version before running an action.";
      }

      if (
        autosaveSnapshot.status ===
        "changes-pending"
      ) {
        return "Wait for pending changes to be saved.";
      }

      if (
        autosaveSnapshot.status ===
        "saving"
      ) {
        return "Wait for the current save to finish.";
      }

      if (
        autosaveSnapshot.status ===
        "queued"
      ) {
        return "Wait for queued changes to reconnect and save.";
      }

      if (
        autosaveSnapshot.status ===
        "save-failed"
      ) {
        return "Resolve the save failure before running an action.";
      }

      if (
        autosaveSnapshot.status ===
        "conflict"
      ) {
        return "Resolve the version conflict before running an action.";
      }

      if (hasDirtySections) {
        return "Wait for unsaved changes to be saved.";
      }

      if (
        transitionState.status ===
        "pending"
      ) {
        return "Wait for the current action to finish.";
      }

      if (
        transitionState.status ===
        "conflicted"
      ) {
        return "Reload the latest note version before running another action.";
      }

      return undefined;
    }, [
      autosaveSnapshot.status,
      hasDirtySections,
      isComparisonOpen,
      isViewingHistoricalVersion,
      transitionState.status,
    ]);

  const actionExecutionStates =
    useMemo<
      Partial<
        Record<
          UserNoteActionTrigger,
          ActionExecutionState
        >
      >
    >(() => {
      if (
        transitionState.trigger ===
        null
      ) {
        return {};
      }

      if (
        transitionState.status ===
        "pending"
      ) {
        return {
          [transitionState.trigger]:
            "PENDING",
        };
      }

      if (
        transitionState.status ===
        "succeeded"
      ) {
        return {
          [transitionState.trigger]:
            "SUCCEEDED",
        };
      }

      if (
        transitionState.status ===
          "failed" ||
        transitionState.status ===
          "conflicted"
      ) {
        return {
          [transitionState.trigger]:
            "FAILED_AND_ROLLED_BACK",
        };
      }

      return {};
    }, [transitionState]);

  const availableActions =
    useMemo(
      () =>
        deriveAvailableNoteActions({
          note:
            actionSourceDetail.note,
          version:
            actionSourceDetail
              .currentVersion,
          actor,
          now:
            new Date().toISOString(),
          rejectionReason,
          workspaceBlockReason,
          executionStates:
            actionExecutionStates,
        }),
      [
        actionExecutionStates,
        actor,
        rejectionReason,
        workspaceBlockReason,
        actionSourceDetail
          .currentVersion,
        actionSourceDetail.note,
      ],
    );

  function handleSectionChange(
    section: SoapSectionKey,
    value: string,
  ): void {
    if (!isEditable) {
      return;
    }

    const nextContent:
      SoapContent = {
        ...draftContentRef.current,
        [section]: value,
      };

    draftContentRef.current =
      nextContent;

    setDraftContent(
      nextContent,
    );

    queueAutosave(
      nextContent,
    );
  }

  function handleAction(
    trigger:
      UserNoteActionTrigger,
  ): void {
    runAction(
      trigger,
      rejectionReason,
    );
  }

  function handleReviewerAssigned(
    reviewer: UserSummary | null,
  ): void {
    setWorkspaceDetail(
      currentDetail => ({
        ...currentDetail,
        assignedReviewer: reviewer,
        note: {
          ...currentDetail.note,
          assignedReviewerId:
            reviewer?.id ?? null,
        },
      }),
    );
  }

  return (
    <>
      <NoteDetailHeader
        note={
          workspaceDetail.note
        }
        patient={
          workspaceDetail.patient
        }
        assignedReviewer={
          workspaceDetail
            .assignedReviewer
        }
        revisionNumber={
          workspaceDetail
            .currentVersion
            .revisionNumber
        }
      />

      {realtimeNotice !== null ? (
        <p
          role="status"
          aria-label="Real-time note update"
          aria-live="polite"
          aria-atomic="true"
          className="note-realtime-notice"
        >
          {realtimeNotice}
        </p>
      ) : null}

      <div className="note-detail-layout">
        <div className="note-detail-main">
          <PatientSessionCard
            patient={
              workspaceDetail
                .patient
            }
            session={
              workspaceDetail
                .session
            }
          />

          {editorReadOnlyReason !==
          null &&
          !isViewingHistoricalVersion ? (
            <p
              role="status"
              aria-label="Editing permission"
              className="note-editing-permission"
            >
              {editorReadOnlyReason}
            </p>
          ) : null}

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

          <NotePermissionSummary
            actor={actor}
            note={workspaceDetail.note}
            assignedReviewer={
              workspaceDetail
                .assignedReviewer
            }
            isEditable={isEditable}
            actions={availableActions}
          />

          <WorkflowStatusGuidance
            status={
              workspaceDetail.note
                .status
            }
            actor={actor}
            assignedReviewer={
              workspaceDetail
                .assignedReviewer
            }
            assignedReviewerId={
              workspaceDetail.note
                .assignedReviewerId
            }
            actions={availableActions}
          />

          <NoteActionBar
            actions={
              availableActions
            }
            rejectionReason={
              rejectionReason
            }
            onRejectionReasonChange={
              setRejectionReason
            }
            onAction={
              handleAction
            }
          />

          {transitionState.status ===
            "failed" ||
          transitionState.status ===
            "conflicted" ? (
            <p
              className="note-action-error"
              role="alert"
            >
              {
                transitionState.message
              }
            </p>
          ) : null}

          {transitionState.status ===
          "succeeded" ? (
            <p
              className="note-action-success"
              role="status"
            >
              Action completed
              successfully.
            </p>
          ) : null}

          {historicalVersion !==
          null ? (
            <p
              className="historical-version-notice"
              role="status"
            >
              Viewing revision{" "}
              {
                historicalVersion
                  .revisionNumber
              }
              . Historical versions
              are read-only.
            </p>
          ) : null}

          {autosaveConflict !==
            null &&
          !isViewingHistoricalVersion ? (
            <VersionConflictResolver
              ancestorContent={
                autosaveConflict
                  .commonAncestor
                  ?.content ??
                savedContent
              }
              localContent={
                draftContent
              }
              serverContent={
                autosaveConflict
                  .currentVersion
                  .content
              }
              onResolve={
                handleConflictResolve
              }
            />
          ) : isComparingVersions &&
            compareFromVersion !== null &&
            compareToVersion !== null ? (
            <VersionDiffViewer
              fromVersion={
                compareFromVersion
              }
              toVersion={
                compareToVersion
              }
              onClose={
                comparison.exitComparison
              }
            />
          ) : (
            <SoapEditor
              content={
                displayedContent
              }
              readOnly={
                !isEditable ||
                isViewingHistoricalVersion
              }
              readOnlyReason={
                isViewingHistoricalVersion
                  ? `Revision ${historicalVersion?.revisionNumber ?? ""} is historical and cannot be edited.`
                  : editorReadOnlyReason ??
                    undefined
              }
              dirtySections={
                displayedDirtySections
              }
              onSectionChange={
                handleSectionChange
              }
            />
          )}

          <ReviewTimeline
            events={
              workspaceDetail
                .timeline
            }
          />
        </div>

        <aside
          className="note-detail-sidebar"
          aria-label="Note supporting information"
        >
          <PresencePanel
            presence={
              workspaceDetail
                .presence
            }
          />

          <ReviewerAssignmentPanel
            key={
              workspaceDetail
                .assignedReviewer?.id ??
              "unassigned"
            }
            noteId={
              workspaceDetail.note.id
            }
            status={
              workspaceDetail.note
                .status
            }
            actor={actor}
            assignedReviewer={
              workspaceDetail
                .assignedReviewer
            }
            onAssigned={
              handleReviewerAssigned
            }
          />

          <VersionHistorySidebar
            versions={
              workspaceDetail
                .versions
            }
            currentVersionId={
              workspaceDetail
                .currentVersion
                .versionId
            }
            selectedVersionId={
              historicalVersionId ??
              workspaceDetail
                .currentVersion
                .versionId
            }
            comparisonStatus={
              comparisonStatus
            }
            compareFromVersionId={
              compareFromVersionId
            }
            compareToVersionId={
              compareToVersionId
            }
            onSelectVersion={
              comparison.selectVersion
            }
            onStartComparison={
              comparison.startComparison
            }
            onCompareFromVersionChange={
              comparison.setCompareFromVersionId
            }
            onCompareToVersionChange={
              comparison.setCompareToVersionId
            }
            onShowComparison={
              comparison.showComparison
            }
            onExitComparison={
              comparison.exitComparison
            }
          />
        </aside>
      </div>
    </>
  );
}
