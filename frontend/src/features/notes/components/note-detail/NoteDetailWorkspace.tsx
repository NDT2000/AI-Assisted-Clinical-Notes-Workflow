import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  SoapContent,
} from "../../../../domain/noteAttributes";
import {
  canEditNoteContent,
  canTransition,
} from "../../../../domain/noteGuards";
import type {
  NoteDetail,
  ReviewTimelineEvent,
} from "../../../../domain/noteDetail";
import type {
  TransitionNoteActor,
  TransitionNoteCommand,
  TransitionNoteResponse,
  UserNoteActionTrigger,
} from "../../../../domain/noteTransition";
import type {
  AutosaveSnapshot,
  AutosaveSuccess,
} from "../../autosave/AutosaveCoordinator";
import {
  useNoteAutosave,
} from "../../hooks/useNoteAutosave";
import {
  useNoteTransition,
} from "../../hooks/useNoteTransition";
import {
  applyRealtimeEventToNoteDetail,
} from "../../realtime/realtimeReconciliation";
import {
  useRealtimeSubscription,
} from "../../realtime/useRealtimeSubscription";
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
  PatientSessionCard,
} from "./PatientSessionCard";
import {
  PresencePanel,
} from "./PresencePanel";
import {
  ReviewTimeline,
} from "./ReviewTimeline";
import {
  SoapEditor,
  type SoapSectionKey,
} from "./SoapEditor";
import {
  VersionHistorySidebar,
  type VersionComparisonStatus,
} from "./VersionHistorySidebar";
import {
  VersionConflictResolver,
} from "./VersionConflictResolver";
import {
  VersionDiffViewer,
} from "./VersionDiffViewer";

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

const CLEAN_SECTIONS:
  DirtySections = {
    subjective: false,
    objective: false,
    assessment: false,
    plan: false,
  };

function getAutosaveStatusMessage(
  snapshot: AutosaveSnapshot,
): string {
  switch (snapshot.status) {
    case "idle":
      return "All changes saved";
    case "changes-pending":
      return "Unsaved changes";
    case "saving":
      return "Saving changes";
    case "queued":
      return "Offline — changes queued";
    case "save-failed":
      return "Save failed";
    case "conflict":
      return "Conflict requires attention";
  }
}

function AutosaveStatus({
  snapshot,
  onRetry,
}: AutosaveStatusProps) {
  const className = [
    "note-autosave-status",
    `note-autosave-status--${snapshot.status}`,
  ].join(" ");

  if (
    snapshot.status ===
    "save-failed"
  ) {
    return (
      <div
        className={className}
        role="alert"
        aria-label="Autosave status"
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
  }

  if (
    snapshot.status ===
    "conflict"
  ) {
    return (
      <p
        className={className}
        role="alert"
        aria-label="Autosave status"
      >
        Conflict requires attention.
        This note was updated
        elsewhere.
      </p>
    );
  }

  return (
    <p
      className={className}
      role="status"
      aria-label="Autosave status"
      aria-live="polite"
      aria-atomic="true"
    >
      {
        getAutosaveStatusMessage(
          snapshot,
        )
      }
    </p>
  );
}

export function NoteDetailWorkspace({
  detail,
  actor,
}: NoteDetailWorkspaceProps) {
  const [
    workspaceDetail,
    setWorkspaceDetail,
  ] = useState<NoteDetail>(
    () => detail,
  );

  const workspaceDetailRef =
    useRef<NoteDetail>(
      detail,
    );

  workspaceDetailRef.current =
    workspaceDetail;

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

  const [
    historicalVersionId,
    setHistoricalVersionId,
  ] = useState<string | null>(
    null,
  );

  const [
    comparisonStatus,
    setComparisonStatus,
  ] =
    useState<VersionComparisonStatus>(
      "closed",
    );

  const [
    compareFromVersionId,
    setCompareFromVersionId,
  ] = useState<string | null>(
    null,
  );

  const [
    compareToVersionId,
    setCompareToVersionId,
  ] = useState<string | null>(
    null,
  );

  const [
    rejectionReason,
    setRejectionReason,
  ] = useState("");

  const [
    realtimeNotice,
    setRealtimeNotice,
  ] = useState<string | null>(
    null,
  );

  const historicalVersion =
    useMemo(() => {
      if (
        historicalVersionId ===
        null
      ) {
        return null;
      }

      return (
        workspaceDetail.versions.find(
          version =>
            version.versionId ===
            historicalVersionId,
        ) ?? null
      );
    }, [
      historicalVersionId,
      workspaceDetail.versions,
    ]);

  const compareFromVersion =
    useMemo(() => {
      if (
        compareFromVersionId ===
        null
      ) {
        return null;
      }

      return (
        workspaceDetail.versions.find(
          version =>
            version.versionId ===
            compareFromVersionId,
        ) ?? null
      );
    }, [
      compareFromVersionId,
      workspaceDetail.versions,
    ]);

  const compareToVersion =
    useMemo(() => {
      if (
        compareToVersionId ===
        null
      ) {
        return null;
      }

      return (
        workspaceDetail.versions.find(
          version =>
            version.versionId ===
            compareToVersionId,
        ) ?? null
      );
    }, [
      compareToVersionId,
      workspaceDetail.versions,
    ]);

  const isComparisonOpen =
    comparisonStatus !== "closed";

  const isComparingVersions =
    comparisonStatus ===
      "active" &&
    compareFromVersion !== null &&
    compareToVersion !== null;

  const draftContentRef =
    useRef<SoapContent>(
      initialDraftContent,
    );

  const optimisticSnapshotRef =
    useRef<NoteDetail | null>(
      null,
    );

  const optimisticTimelineEventIdRef =
    useRef<string | null>(
      null,
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

  const handleOptimisticApply =
    useCallback(
      (
        command:
          TransitionNoteCommand,
      ): void => {
        const occurredAt =
          new Date().toISOString();

        setWorkspaceDetail(
          currentDetail => {
            const transitionResult =
              canTransition({
                note:
                  currentDetail.note,
                version:
                  currentDetail
                    .currentVersion,
                actor,
                action:
                  command.trigger,
                now: occurredAt,
                ...(command
                  .rejectionReason !==
                undefined
                  ? {
                      rejectionReason:
                        command
                          .rejectionReason,
                    }
                  : {}),
              });

            if (
              !transitionResult.allowed
            ) {
              return currentDetail;
            }

            optimisticSnapshotRef.current =
              currentDetail;

            const optimisticEventId =
              [
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
              eventId:
                optimisticEventId,
              noteId:
                currentDetail.note.id,
              versionId:
                currentDetail
                  .currentVersion
                  .versionId,
              fromStatus:
                currentDetail.note
                  .status,
              toStatus:
                transitionResult
                  .nextStatus,
              actorId: actor.id,
              actorRole: actor.role,
              actorDisplayName:
                actor.displayName,
              occurredAt,
              ...(command.trigger ===
                "REJECT" &&
              command.rejectionReason
                ?.trim()
                ? {
                    reason:
                      command
                        .rejectionReason
                        .trim(),
                  }
                : {}),
            };

            const shouldAssignReviewer =
              command.trigger ===
              "START_REVIEW";

            const shouldReleaseReviewer =
              command.trigger ===
                "RETURN_TO_QUEUE" ||
              command.trigger ===
                "RESUBMIT" ||
              command.trigger ===
                "AMEND" ||
              command.trigger ===
                "REGENERATE";

            const nextAssignedReviewer =
              shouldAssignReviewer
                ? {
                    id: actor.id,
                    displayName:
                      actor.displayName,
                    role: actor.role,
                  }
                : shouldReleaseReviewer
                ? null
                : currentDetail
                    .assignedReviewer;

            return {
              ...currentDetail,
              note: {
                ...currentDetail.note,
                status:
                  transitionResult
                    .nextStatus,
                assignedReviewerId:
                  nextAssignedReviewer
                    ?.id ?? null,
                updatedAt:
                  occurredAt,
                ...(transitionResult
                  .nextStatus ===
                "APPROVED"
                  ? {
                      approvedAt:
                        occurredAt,
                    }
                  : {}),
              },
              assignedReviewer:
                nextAssignedReviewer,
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
        response:
          TransitionNoteResponse,
      ): void => {
        const optimisticEventId =
          optimisticTimelineEventIdRef
            .current;

        setWorkspaceDetail(
          currentDetail => {
            const timelineWithoutOptimistic =
              currentDetail.timeline.filter(
                event =>
                  event.eventId !==
                  optimisticEventId,
              );

            const authoritativeExists =
              timelineWithoutOptimistic.some(
                event =>
                  event.eventId ===
                  response.timelineEvent
                    .eventId,
              );

            const assignedReviewerId =
              response.note
                .assignedReviewerId;

            const nextAssignedReviewer =
              assignedReviewerId ===
              null
                ? null
                : currentDetail
                    .assignedReviewer
                    ?.id ===
                  assignedReviewerId
                ? currentDetail
                    .assignedReviewer
                : response.timelineEvent
                    .actorId ===
                  assignedReviewerId
                ? {
                    id:
                      response
                        .timelineEvent
                        .actorId,
                    displayName:
                      response
                        .timelineEvent
                        .actorDisplayName,
                    role:
                      response
                        .timelineEvent
                        .actorRole,
                  }
                : currentDetail
                    .assignedReviewer;

            return {
              ...currentDetail,
              note: response.note,
              assignedReviewer:
                nextAssignedReviewer,
              currentVersion:
                response.currentVersion,
              timeline:
                authoritativeExists
                  ? timelineWithoutOptimistic
                  : [
                      ...timelineWithoutOptimistic,
                      response.timelineEvent,
                    ],
            };
          },
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

      if (snapshot !== null) {
        setWorkspaceDetail(
          snapshot,
        );
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
    resolveConflict:
      resolveAutosaveConflict,
    adoptServerVersion:
      adoptAutosaveServerVersion,
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

        setHistoricalVersionId(
          null,
        );

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
      ],
    );

  const {
    state: transitionState,
    execute: executeTransition,
  } = useNoteTransition({
    noteId:
      workspaceDetail.note.id,
    actor,
    onOptimisticApply:
      handleOptimisticApply,
    onSuccess:
      handleTransitionSuccess,
    onFailure:
      handleTransitionFailure,
  });

  useRealtimeSubscription({
    noteIds: [
      workspaceDetail.note.id,
    ],

    onEvent: event => {
      if (
        event.type ===
        "note.status_changed"
      ) {
        const isOwnOptimisticEcho =
          workspaceDetailRef.current
            .timeline.some(
              timelineEvent =>
                timelineEvent.eventId
                  .startsWith(
                    "optimistic-transition",
                  ) &&
                timelineEvent.fromStatus ===
                  event.response
                    .timelineEvent
                    .fromStatus &&
                timelineEvent.toStatus ===
                  event.response
                    .timelineEvent
                    .toStatus,
            );

        if (!isOwnOptimisticEcho) {
          setRealtimeNotice(
            "This note changed in another session. The latest server status has been applied.",
          );
        }

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

        return;
      }

      if (
        event.type ===
        "note.version_added"
      ) {
        const hasUnacknowledgedLocalWork =
          autosaveSnapshot.status !==
            "idle" ||
          hasDirtySections;

        if (
          autosaveSnapshot.status !==
            "saving" &&
          hasUnacknowledgedLocalWork
        ) {
          setRealtimeNotice(
            "A newer version arrived while local edits were pending. Saving will use the normal conflict-resolution flow.",
          );
        }

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

        if (
          !hasUnacknowledgedLocalWork
        ) {
          const nextContent =
            copySoapContent(
              event.response
                .savedVersion
                .content,
            );

          const adopted =
            adoptAutosaveServerVersion(
              event.response
                .savedVersion
                .versionId,
              nextContent,
            );

          if (adopted) {
            setSavedContent(
              nextContent,
            );

            setDraftContent(
              nextContent,
            );

            draftContentRef.current =
              nextContent;
          }
        }

        return;
      }

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

  const actionSourceDetail =
    transitionState.status ===
      "pending" &&
    optimisticSnapshotRef.current !==
      null
      ? optimisticSnapshotRef.current
      : workspaceDetail;

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
    void executeTransition({
      baseVersionId:
        workspaceDetail
          .currentVersion
          .versionId,
      trigger,
      ...(trigger === "REJECT"
        ? {
            rejectionReason,
          }
        : {}),
    });
  }

  function handleStartComparison(): void {
    const currentVersion =
      workspaceDetail.currentVersion;

    const previousVersion = [
      ...workspaceDetail.versions,
    ]
      .filter(
        version =>
          version.versionId !==
          currentVersion.versionId,
      )
      .sort(
        (
          firstVersion,
          secondVersion,
        ) =>
          secondVersion
            .revisionNumber -
          firstVersion
            .revisionNumber,
      )[0];

    if (
      previousVersion ===
      undefined
    ) {
      return;
    }

    setHistoricalVersionId(
      null,
    );

    setCompareFromVersionId(
      previousVersion.versionId,
    );

    setCompareToVersionId(
      currentVersion.versionId,
    );

    setComparisonStatus(
      "selecting",
    );
  }

  function handleShowComparison(): void {
    if (
      compareFromVersion ===
        null ||
      compareToVersion ===
        null ||
      compareFromVersion
        .versionId ===
        compareToVersion
          .versionId
    ) {
      return;
    }

    setHistoricalVersionId(
      null,
    );

    setComparisonStatus(
      "active",
    );
  }

  function handleExitComparison(): void {
    setComparisonStatus(
      "closed",
    );

    setCompareFromVersionId(
      null,
    );

    setCompareToVersionId(
      null,
    );
  }

  function handleVersionSelect(
    versionId: string,
  ): void {
    if (isComparisonOpen) {
      return;
    }

    const isCurrentVersion =
      versionId ===
      workspaceDetail
        .currentVersion
        .versionId;

    setHistoricalVersionId(
      isCurrentVersion
        ? null
        : versionId,
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
          ) : isComparingVersions ? (
            <VersionDiffViewer
              fromVersion={
                compareFromVersion
              }
              toVersion={
                compareToVersion
              }
              onClose={
                handleExitComparison
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
              handleVersionSelect
            }
            onStartComparison={
              handleStartComparison
            }
            onCompareFromVersionChange={
              setCompareFromVersionId
            }
            onCompareToVersionChange={
              setCompareToVersionId
            }
            onShowComparison={
              handleShowComparison
            }
            onExitComparison={
              handleExitComparison
            }
          />
        </aside>
      </div>
    </>
  );
}
