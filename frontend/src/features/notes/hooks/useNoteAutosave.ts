import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  SoapContent,
} from "../../../domain/noteAttributes";
import type {
  SaveNoteVersionActor,
} from "../../../domain/noteSave";
import {
  AutosaveCoordinator,
  type AutosaveSnapshot,
  type AutosaveStatus,
  type AutosaveSuccess,
  type UnsavedAutosaveDraft,
} from "../autosave/AutosaveCoordinator";
import {
  getNoteAutosaveConflict,
  type NoteAutosaveConflict,
} from "../autosave/noteAutosaveConflict";
import {
  classifySaveNoteVersionError,
} from "../api/saveNoteVersion";
import {
  offlineSaveReplayCoordinator,
} from "../offline/offlineSaveReplay";
import {
  isRetryableReplayError,
} from "../offline/replayErrors";
import {
  queueNoteVersionSave,
  saveNoteVersionWithOfflineQueue,
} from "../offline/saveNoteVersionWithOfflineQueue";

interface UseNoteAutosaveOptions {
  noteId: string;
  actor: SaveNoteVersionActor;
  initialBaseVersionId: string;
  initialContent: SoapContent;
  debounceMs?: number;
  onSaveSuccess: (
    result: AutosaveSuccess,
  ) => void;
}

interface UseNoteAutosaveResult {
  snapshot: AutosaveSnapshot;
  conflict:
    NoteAutosaveConflict | null;

  /*
   * True when closing the tab now could lose edits: they are
   * waiting, being sent, or stuck in a failed or conflicted save.
   * Saves already in the offline queue are durable and excluded.
   */
  hasUnsavedChanges: boolean;

  /*
   * What happens to a failed or conflicted save if the editor is
   * left now: kept in the offline queue, or lost. Null when there
   * is no unresolved save.
   */
  unresolvedSave: UnresolvedSave | null;

  updateDraft(
    content: SoapContent,
  ): void;

  retry(): void;

  resolveConflict(
    resolvedContent: SoapContent,
    serverBaseVersionId: string,
  ): void;

  adoptServerVersion(
    serverBaseVersionId: string,
    content: SoapContent,
  ): boolean;
}

export type UnresolvedSave =
  | "kept-offline"
  | "will-be-lost";

interface NoteAutosaveInitialization {
  noteId: string;
  baseVersionId: string;
  content: SoapContent;
  debounceMs: number;
}

const INITIAL_SNAPSHOT:
  AutosaveSnapshot = {
    status: "idle",
    hasPendingChanges: false,
    error: null,
  };

const UNSAFE_TO_CLOSE_STATUSES:
  ReadonlySet<AutosaveStatus> =
  new Set<AutosaveStatus>([
    "changes-pending",
    "saving",
    "save-failed",
    "conflict",
  ]);

function cloneContent(
  content: SoapContent,
): SoapContent {
  return {
    subjective:
      content.subjective,
    objective:
      content.objective,
    assessment:
      content.assessment,
    plan: content.plan,
  };
}

/*
 * A conflicted or retryable draft goes to the durable offline
 * queue, where replay resumes it and surfaces any conflict when
 * the note is reopened. A draft the server rejected outright
 * (e.g. permission or validation) would stall the queue, so it
 * is not kept; the navigation guard warns before that happens.
 */
function shouldKeepUnsavedDraft(
  draft: UnsavedAutosaveDraft,
): boolean {
  return (
    draft.failureKind === "conflict" ||
    isRetryableReplayError(draft.error)
  );
}

export function useNoteAutosave({
  noteId,
  actor,
  initialBaseVersionId,
  initialContent,
  debounceMs = 500,
  onSaveSuccess,
}: UseNoteAutosaveOptions): UseNoteAutosaveResult {
  const [
    snapshot,
    setSnapshot,
  ] = useState<AutosaveSnapshot>(
    INITIAL_SNAPSHOT,
  );

  const coordinatorRef =
    useRef<AutosaveCoordinator | null>(
      null,
    );

  const actorRef =
    useRef<SaveNoteVersionActor>(
      actor,
    );

  const initializationRef =
    useRef<NoteAutosaveInitialization>({
      noteId,
      baseVersionId:
        initialBaseVersionId,
      content:
        cloneContent(initialContent),
      debounceMs,
    });

  const onSaveSuccessRef =
    useRef(onSaveSuccess);

  const pendingDraftRef =
    useRef<SoapContent | null>(
      null,
    );

  const replaySnapshot =
    useSyncExternalStore(
      offlineSaveReplayCoordinator
        .subscribe,
      offlineSaveReplayCoordinator
        .getSnapshot,
      offlineSaveReplayCoordinator
        .getSnapshot,
    );

  useEffect(() => {
    onSaveSuccessRef.current =
      onSaveSuccess;
  }, [onSaveSuccess]);

  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);

  useEffect(() => {
    initializationRef.current = {
      noteId,
      baseVersionId:
        initialBaseVersionId,
      content:
        cloneContent(initialContent),
      debounceMs,
    };
  }, [
    debounceMs,
    initialBaseVersionId,
    initialContent.subjective,
    initialContent.objective,
    initialContent.assessment,
    initialContent.plan,
    noteId,
  ]);

  const installCoordinator =
    useCallback(
      (
        initialization:
          NoteAutosaveInitialization,
      ): AutosaveCoordinator => {
        coordinatorRef.current
          ?.detach();

        const coordinator =
          new AutosaveCoordinator({
            initialBaseVersionId:
              initialization
                .baseVersionId,

            initialContent:
              cloneContent(
                initialization
                  .content,
              ),

            debounceMs:
              initialization
                .debounceMs,

            // Saves are never aborted: a detached coordinator
            // must be able to finish them after the editor closes.
            save: request =>
              saveNoteVersionWithOfflineQueue(
                initialization.noteId,
                actorRef.current,
                request,
              ),

            classifyError:
              classifySaveNoteVersionError,

            onStateChange:
              setSnapshot,

            onSaveSuccess:
              result => {
                onSaveSuccessRef.current(
                  result,
                );
              },

            onUnsavedAfterDetach:
              draft => {
                if (
                  !shouldKeepUnsavedDraft(
                    draft,
                  )
                ) {
                  return;
                }

                void queueNoteVersionSave(
                  initialization.noteId,
                  actorRef.current,
                  draft.request,
                ).catch(() => {
                  // IndexedDB unavailable: nothing durable is left
                  // to fall back to.
                });
              },
          });

        coordinatorRef.current =
          coordinator;

        setSnapshot(
          coordinator.getSnapshot(),
        );

        return coordinator;
      },
      [],
    );

  useEffect(() => {
    const initialization =
      initializationRef.current;

    const coordinator =
      installCoordinator(
        initialization,
      );

    if (
      pendingDraftRef.current !==
      null
    ) {
      coordinator.updateDraft(
        pendingDraftRef.current,
      );

      pendingDraftRef.current =
        null;
    }

    return () => {
      coordinatorRef.current
        ?.detach();

      coordinatorRef.current =
        null;
    };
  }, [
    installCoordinator,
    noteId,
  ]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (
        document.visibilityState ===
        "hidden"
      ) {
        coordinatorRef.current
          ?.flushNow();
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, []);

  const updateDraft =
    useCallback(
      (
        content: SoapContent,
      ): void => {
        const copiedContent =
          cloneContent(content);

        const coordinator =
          coordinatorRef.current;

        if (coordinator === null) {
          pendingDraftRef.current =
            copiedContent;

          return;
        }

        coordinator.updateDraft(
          copiedContent,
        );
      },
      [],
    );

  const offlineBlockedEntry =
    replaySnapshot.blockedConflict !==
      null &&
    replaySnapshot.blockedConflict
      .noteId === noteId
      ? replaySnapshot
          .blockedConflict
      : null;

  const offlineConflict:
    NoteAutosaveConflict | null =
    offlineBlockedEntry?.conflict
      ? {
          message:
            offlineBlockedEntry
              .conflict.message,

          currentVersion:
            offlineBlockedEntry
              .conflict
              .currentVersion,

          commonAncestor:
            offlineBlockedEntry
              .conflict
              .commonAncestor,
        }
      : null;

  const localConflict =
    snapshot.status === "conflict"
      ? getNoteAutosaveConflict(
          snapshot.error,
        )
      : null;

  const conflict =
    offlineConflict ??
    localConflict;

  const effectiveSnapshot:
    AutosaveSnapshot =
    offlineConflict !== null
      ? {
          status: "conflict",
          hasPendingChanges: true,
          error: new Error(
            offlineConflict.message,
          ),
        }
      : snapshot;

  const hasUnsavedChanges =
    UNSAFE_TO_CLOSE_STATUSES.has(
      effectiveSnapshot.status,
    );

  const unresolvedSave:
    UnresolvedSave | null =
    effectiveSnapshot.status ===
    "conflict"
      ? "kept-offline"
      : effectiveSnapshot.status ===
          "save-failed"
        ? isRetryableReplayError(
            effectiveSnapshot.error,
          )
          ? "kept-offline"
          : "will-be-lost"
        : null;

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    function handleBeforeUnload(
      event: BeforeUnloadEvent,
    ) {
      coordinatorRef.current
        ?.flushNow();

      event.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      event.returnValue = "";
    }

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload,
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload,
      );
    };
  }, [hasUnsavedChanges]);

  const retry = useCallback(() => {
    if (
      offlineBlockedEntry !== null
    ) {
      void offlineSaveReplayCoordinator
        .replay();

      return;
    }

    coordinatorRef.current?.retry();
  }, [offlineBlockedEntry]);

  const resolveConflict =
    useCallback(
      (
        resolvedContent:
          SoapContent,
        serverBaseVersionId:
          string,
      ): void => {
        const copiedContent =
          cloneContent(
            resolvedContent,
          );

        if (
          offlineBlockedEntry !==
            null &&
          offlineBlockedEntry
            .conflict !== null
        ) {
          const resolutionNoteId =
            noteId;

          void offlineSaveReplayCoordinator
            .resolveBlockedConflict(
              copiedContent,
            )
            .then(response => {
              if (
                response === null ||
                initializationRef
                  .current.noteId !==
                  resolutionNoteId
              ) {
                return;
              }

              const nextInitialization:
                NoteAutosaveInitialization = {
                noteId:
                  resolutionNoteId,

                baseVersionId:
                  response
                    .savedVersion
                    .versionId,

                content:
                  cloneContent(
                    copiedContent,
                  ),

                debounceMs:
                  initializationRef
                    .current
                    .debounceMs,
              };

              initializationRef.current =
                nextInitialization;

              installCoordinator(
                nextInitialization,
              );

              onSaveSuccessRef.current({
                response,

                savedContent:
                  cloneContent(
                    copiedContent,
                  ),
              });
            });

          return;
        }

        coordinatorRef.current
          ?.resolveConflict(
            copiedContent,
            serverBaseVersionId,
          );
      },
      [
        installCoordinator,
        noteId,
        offlineBlockedEntry,
      ],
    );

  const adoptServerVersion =
    useCallback(
      (
        serverBaseVersionId:
          string,
        content: SoapContent,
      ): boolean => {
        if (
          effectiveSnapshot.status !==
            "idle" ||
          offlineBlockedEntry !== null
        ) {
          return false;
        }

        const nextInitialization:
          NoteAutosaveInitialization = {
          noteId,
          baseVersionId:
            serverBaseVersionId,
          content:
            cloneContent(content),
          debounceMs:
            initializationRef.current
              .debounceMs,
        };

        pendingDraftRef.current =
          null;

        initializationRef.current =
          nextInitialization;

        installCoordinator(
          nextInitialization,
        );

        return true;
      },
      [
        effectiveSnapshot.status,
        installCoordinator,
        noteId,
        offlineBlockedEntry,
      ],
    );

  return {
    snapshot:
      effectiveSnapshot,
    conflict,
    hasUnsavedChanges,
    unresolvedSave,
    updateDraft,
    retry,
    resolveConflict,
    adoptServerVersion,
  };
}
