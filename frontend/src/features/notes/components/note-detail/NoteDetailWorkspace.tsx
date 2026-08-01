import { useCallback, useMemo, useRef, useState, } from "react";

import type { SoapContent, } from "../../../../domain/noteAttributes";
import { canTransition } from "../../../../domain/noteGuards";
import type { NoteDetail, ReviewTimelineEvent } from "../../../../domain/noteDetail";
import type { TransitionNoteActor, TransitionNoteCommand, TransitionNoteResponse, 
  UserNoteActionTrigger, } from "../../../../domain/noteTransition";
import type { AutosaveSnapshot, AutosaveSuccess, } from "../../autosave/AutosaveCoordinator";
import { useNoteAutosave, } from "../../hooks/useNoteAutosave";
import { useNoteTransition, } from "../../hooks/useNoteTransition";
import { NoteActionBar, } from "./NoteActionBar";
import { deriveAvailableNoteActions, type ActionExecutionState, } from "./noteActionBarModel";
import { NoteDetailHeader, } from "./NoteDetailHeader";
import { PatientSessionCard, } from "./PatientSessionCard";
import { PresencePanel, } from "./PresencePanel";
import { ReviewTimeline, } from "./ReviewTimeline";
import { SoapEditor, type SoapSectionKey, } from "./SoapEditor";
import { VersionHistorySidebar, } from "./VersionHistorySidebar";
import { VersionConflictResolver, } from "./VersionConflictResolver";

interface NoteDetailWorkspaceProps {
  detail: NoteDetail;
  actor: TransitionNoteActor;
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

  const [
    rejectionReason,
    setRejectionReason,
  ] = useState("");

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

  const optimisticSnapshotRef =
    useRef<NoteDetail | null>(null);

  const optimisticTimelineEventIdRef =
    useRef<string | null>(null);

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

  const handleOptimisticApply =
    useCallback(
      (
        command: TransitionNoteCommand,
      ): void => {
        const occurredAt =
          new Date().toISOString();

        setWorkspaceDetail(
          (currentDetail) => {
            const transitionResult =
              canTransition({
                note: currentDetail.note,
                version:
                  currentDetail.currentVersion,
                actor,
                action: command.trigger,
                now: occurredAt,
                ...(command.rejectionReason !==
                undefined
                  ? {
                      rejectionReason:
                        command.rejectionReason,
                    }
                  : {}),
              });

            if (!transitionResult.allowed) {
              return currentDetail;
            }

            optimisticSnapshotRef.current =
              currentDetail;

            const optimisticEventId = [
              "optimistic-transition",
              Date.now(),
              Math.random()
                .toString(36)
                .slice(2),
            ].join("-");

            optimisticTimelineEventIdRef.current =
              optimisticEventId;

            const optimisticTimelineEvent:
              ReviewTimelineEvent = {
              eventId: optimisticEventId,
              noteId:
                currentDetail.note.id,
              versionId:
                currentDetail.currentVersion
                  .versionId,
              fromStatus:
                currentDetail.note.status,
              toStatus:
                transitionResult.nextStatus,
              actorId: actor.id,
              actorRole: actor.role,
              actorDisplayName:
                actor.displayName,
              occurredAt,
              ...(command.trigger ===
                "REJECT" &&
              command.rejectionReason?.trim()
                ? {
                    reason:
                      command.rejectionReason.trim(),
                  }
                : {}),
            };

            return {
              ...currentDetail,
              note: {
                ...currentDetail.note,
                status:
                  transitionResult.nextStatus,
                updatedAt: occurredAt,
                ...(transitionResult.nextStatus ===
                "APPROVED"
                  ? {
                      approvedAt:
                        occurredAt,
                    }
                  : {}),
              },
              timeline: [
                ...currentDetail.timeline,
                optimisticTimelineEvent,
              ],
            };
          },
        );
      },
      [actor],
    );

  const handleTransitionSuccess =
    useCallback(
      (
        response: TransitionNoteResponse,
      ): void => {
        const optimisticEventId =
          optimisticTimelineEventIdRef.current;

        setWorkspaceDetail(
          (currentDetail) => ({
            ...currentDetail,
            note: response.note,
            currentVersion:
              response.currentVersion,
            timeline: [
              ...currentDetail.timeline.filter(
                (event) =>
                  event.eventId !==
                  optimisticEventId,
              ),
              response.timelineEvent,
            ],
          }),
        );

        optimisticSnapshotRef.current =
          null;

        optimisticTimelineEventIdRef.current =
          null;

        setRejectionReason("");
      },
      [],
    );

  const handleTransitionFailure =
    useCallback((): void => {
      const snapshot =
        optimisticSnapshotRef.current;

      if (snapshot) {
        setWorkspaceDetail(snapshot);
      }

      optimisticSnapshotRef.current =
        null;

      optimisticTimelineEventIdRef.current =
        null;
    }, []);
  
  const {
    snapshot: autosaveSnapshot,
    conflict: autosaveConflict,
    updateDraft: queueAutosave,
    retry: retryAutosave,
    resolveConflict: resolveAutosaveConflict,
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

  const handleConflictResolve =
    useCallback(
      (
        resolvedContent: SoapContent,
      ): void => {
        if (!autosaveConflict) {
          return;
        }

        const nextContent =
          copySoapContent(
            resolvedContent,
          );

        draftContentRef.current =
          nextContent;

        setDraftContent(nextContent);
        setHistoricalVersionId(null);

        setWorkspaceDetail(
          (currentDetail) => {
            const serverVersion =
              autosaveConflict.currentVersion;

            const serverVersionExists =
              currentDetail.versions.some(
                (version) =>
                  version.versionId ===
                  serverVersion.versionId,
              );

            if (serverVersionExists) {
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
        autosaveConflict.currentVersion
          .versionId,
      );
    },
    [
      autosaveConflict,
      resolveAutosaveConflict,
    ],
  );

  const {
    state: transitionState,
    execute: executeTransition,
  } = useNoteTransition({
    noteId: workspaceDetail.note.id,
    actor,
    onOptimisticApply: handleOptimisticApply,
    onSuccess: handleTransitionSuccess,
    onFailure: handleTransitionFailure,
  });

  const isEditable =
    workspaceDetail.note.status ===
      "IN_REVIEW" &&
    transitionState.status !==
      "pending";

  const hasDirtySections =
    Object.values(
      dirtySections,
    ).some(Boolean);

  const workspaceBlockReason =
    useMemo(() => {
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
        transitionState.trigger === null
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

  const actionSourceDetail =
    transitionState.status ===
      "pending" &&
    optimisticSnapshotRef.current !==
      null
      ? optimisticSnapshotRef.current
      : workspaceDetail;
    
  const availableActions = useMemo(
    () =>
      deriveAvailableNoteActions({
        note: actionSourceDetail.note,

        version:
          actionSourceDetail.currentVersion,

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
      actionSourceDetail.currentVersion,
      actionSourceDetail.note,
    ],
  );

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

  function handleAction(
    trigger: UserNoteActionTrigger,
  ): void {
    void executeTransition({
      baseVersionId:
        workspaceDetail.currentVersion
          .versionId,

      trigger,

      ...(trigger === "REJECT"
        ? {
            rejectionReason,
          }
        : {}),
    });
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
        patient={
          workspaceDetail.patient
        }
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

          <NoteActionBar
            actions={availableActions}
            rejectionReason={
              rejectionReason
            }
            onRejectionReasonChange={
              setRejectionReason
            }
            onAction={handleAction}
          />

          {transitionState.status ===
            "failed" ||
          transitionState.status ===
            "conflicted" ? (
            <p
              className="note-action-error"
              role="alert"
            >
              {transitionState.message}
            </p>
          ) : null}

          {transitionState.status ===
          "succeeded" ? (
            <p
              className="note-action-success"
              role="status"
            >
              Action completed successfully.
            </p>
          ) : null}

          {historicalVersion ? (
            <p
              className="historical-version-notice"
              role="status"
            >
              Viewing revision{" "}
              {
                historicalVersion
                  .revisionNumber
              }
              . Historical versions are
              read-only.
            </p>
          ) : null}

          {autosaveConflict !== null &&
            !isViewingHistoricalVersion ? (
              <VersionConflictResolver
                ancestorContent={
                  autosaveConflict
                    .commonAncestor?.content ??
                  savedContent
                }
                localContent={draftContent}
                serverContent={
                  autosaveConflict
                    .currentVersion.content
                }
                onResolve={
                  handleConflictResolve
                }
              />
            ) : (
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
            )}

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