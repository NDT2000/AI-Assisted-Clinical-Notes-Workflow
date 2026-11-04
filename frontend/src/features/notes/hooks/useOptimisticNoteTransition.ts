import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  Actor,
} from "../../../domain/actor";
import type {
  NoteDetail,
  ReviewTimelineEvent,
  UserSummary,
} from "../../../domain/noteDetail";
import {
  canTransition,
} from "../../../domain/noteGuards";
import type {
  TransitionNoteCommand,
  TransitionNoteResponse,
  UserNoteActionTrigger,
} from "../../../domain/noteTransition";
import {
  useNoteTransition,
} from "./useNoteTransition";

const OPTIMISTIC_EVENT_PREFIX =
  "optimistic-transition";

const RELEASING_TRIGGERS:
  ReadonlySet<UserNoteActionTrigger> =
  new Set<UserNoteActionTrigger>([
    "RETURN_TO_QUEUE",
    "RESUBMIT",
    "AMEND",
    "REGENERATE",
  ]);

/*
 * The detail as it should look if the transition succeeds, with a
 * placeholder timeline event; null when the guards reject it.
 */
export function buildOptimisticDetail(
  detail: NoteDetail,
  command: TransitionNoteCommand,
  actor: Actor,
  occurredAt: string,
  eventId: string,
): NoteDetail | null {
  const result = canTransition({
    note: detail.note,
    version: detail.currentVersion,
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

  if (!result.allowed) {
    return null;
  }

  const reason =
    command.trigger === "REJECT"
      ? command.rejectionReason?.trim()
      : undefined;

  const timelineEvent: ReviewTimelineEvent = {
    eventId,
    noteId: detail.note.id,
    versionId:
      detail.currentVersion.versionId,
    fromStatus: detail.note.status,
    toStatus: result.nextStatus,
    actorId: actor.id,
    actorRole: actor.role,
    actorDisplayName: actor.displayName,
    occurredAt,
    ...(reason ? { reason } : {}),
  };

  const assignedReviewer: UserSummary | null =
    command.trigger === "START_REVIEW"
      ? {
          id: actor.id,
          displayName: actor.displayName,
          role: actor.role,
        }
      : RELEASING_TRIGGERS.has(
            command.trigger,
          )
        ? null
        : detail.assignedReviewer;

  return {
    ...detail,
    note: {
      ...detail.note,
      status: result.nextStatus,
      assignedReviewerId:
        assignedReviewer?.id ?? null,
      updatedAt: occurredAt,
      ...(result.nextStatus === "APPROVED"
        ? { approvedAt: occurredAt }
        : {}),
    },
    assignedReviewer,
    timeline: [
      ...detail.timeline,
      timelineEvent,
    ],
  };
}

/*
 * Replaces the optimistic state with the server's answer: its note
 * and version, and its timeline event in place of the placeholder.
 */
export function applyTransitionResponse(
  detail: NoteDetail,
  response: TransitionNoteResponse,
  optimisticEventId: string | null,
): NoteDetail {
  const timeline = detail.timeline.filter(
    event =>
      event.eventId !== optimisticEventId,
  );

  const alreadyRecorded = timeline.some(
    event =>
      event.eventId ===
      response.timelineEvent.eventId,
  );

  const reviewerId =
    response.note.assignedReviewerId;

  const { timelineEvent } = response;

  const assignedReviewer: UserSummary | null =
    reviewerId === null
      ? null
      : detail.assignedReviewer?.id ===
          reviewerId
        ? detail.assignedReviewer
        : timelineEvent.actorId ===
            reviewerId
          ? {
              id: timelineEvent.actorId,
              displayName:
                timelineEvent.actorDisplayName,
              role: timelineEvent.actorRole,
            }
          : detail.assignedReviewer;

  return {
    ...detail,
    note: response.note,
    assignedReviewer,
    currentVersion:
      response.currentVersion,
    timeline: alreadyRecorded
      ? timeline
      : [...timeline, timelineEvent],
  };
}

interface UseOptimisticNoteTransitionOptions {
  actor: Actor;
  detail: NoteDetail;
  setDetail: Dispatch<
    SetStateAction<NoteDetail>
  >;
  onSucceeded: () => void;
}

/*
 * Runs workflow actions optimistically: the detail changes at once,
 * then is reconciled with the server's response or rolled back to
 * the snapshot taken before the change.
 */
export function useOptimisticNoteTransition({
  actor,
  detail,
  setDetail,
  onSucceeded,
}: UseOptimisticNoteTransitionOptions) {
  // For rollback, read from callbacks only.
  const snapshotRef =
    useRef<NoteDetail | null>(null);

  const optimisticEventIdRef =
    useRef<string | null>(null);

  // The pre-action detail, for rendering while the action is pending.
  const [
    pendingSnapshot,
    setPendingSnapshot,
  ] = useState<NoteDetail | null>(null);

  const onSucceededRef =
    useRef(onSucceeded);

  useEffect(() => {
    onSucceededRef.current = onSucceeded;
  }, [onSucceeded]);

  const handleOptimisticApply =
    useCallback(
      (command: TransitionNoteCommand) => {
        const occurredAt =
          new Date().toISOString();

        const eventId = [
          OPTIMISTIC_EVENT_PREFIX,
          Date.now(),
          Math.random().toString(36).slice(2),
        ].join("-");

        setDetail(current => {
          const next = buildOptimisticDetail(
            current,
            command,
            actor,
            occurredAt,
            eventId,
          );

          if (next === null) {
            return current;
          }

          snapshotRef.current = current;
          optimisticEventIdRef.current =
            eventId;

          return next;
        });
      },
      [actor, setDetail],
    );

  const handleSuccess = useCallback(
    (response: TransitionNoteResponse) => {
      const optimisticEventId =
        optimisticEventIdRef.current;

      setDetail(current =>
        applyTransitionResponse(
          current,
          response,
          optimisticEventId,
        ),
      );

      snapshotRef.current = null;
      optimisticEventIdRef.current = null;
      setPendingSnapshot(null);
      onSucceededRef.current();
    },
    [setDetail],
  );

  const handleFailure =
    useCallback(() => {
      const snapshot = snapshotRef.current;

      if (snapshot !== null) {
        setDetail(snapshot);
      }

      snapshotRef.current = null;
      optimisticEventIdRef.current = null;
      setPendingSnapshot(null);
    }, [setDetail]);

  const { state, execute } =
    useNoteTransition({
      noteId: detail.note.id,
      actor,
      onOptimisticApply:
        handleOptimisticApply,
      onSuccess: handleSuccess,
      onFailure: handleFailure,
    });

  return {
    transitionState: state,

    /* The detail actions should be derived from right now. */
    actionSourceDetail:
      state.status === "pending" &&
      pendingSnapshot !== null
        ? pendingSnapshot
        : detail,

    runAction(
      trigger: UserNoteActionTrigger,
      rejectionReason: string,
    ): void {
      setPendingSnapshot(detail);

      void execute({
        baseVersionId:
          detail.currentVersion.versionId,
        trigger,
        ...(trigger === "REJECT"
          ? { rejectionReason }
          : {}),
      });
    },
  };
}
