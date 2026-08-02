import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { SoapContent } from "../../../domain/noteAttributes";
import type { SaveNoteVersionActor } from "../../../domain/noteSave";
import {
  AutosaveCoordinator,
} from "../autosave/AutosaveCoordinator";
import type {
  AutosaveSnapshot,
  AutosaveSuccess,
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
  conflict: NoteAutosaveConflict | null;
  updateDraft: (
    content: SoapContent,
  ) => void;
  retry: () => void;
  resolveConflict: (
    resolvedContent: SoapContent,
    serverBaseVersionId: string,
  ) => void;
}

interface NoteAutosaveInitialization {
  noteId: string;
  baseVersionId: string;
  content: SoapContent;
  debounceMs: number;
}

const INITIAL_SNAPSHOT: AutosaveSnapshot = {
  status: "idle",
  hasPendingChanges: false,
  error: null,
};

function cloneContent(
  content: SoapContent,
): SoapContent {
  return {
    subjective: content.subjective,
    objective: content.objective,
    assessment: content.assessment,
    plan: content.plan,
  };
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
    useRef<SaveNoteVersionActor>(actor);

  const initializationRef =
    useRef<NoteAutosaveInitialization>({
      noteId,
      baseVersionId:
        initialBaseVersionId,
      content:
        cloneContent(initialContent),
      debounceMs,
    });

  const activeRequestRef =
    useRef<AbortController | null>(
      null,
    );

  const onSaveSuccessRef =
    useRef(onSaveSuccess);

  const pendingDraftRef =
    useRef<SoapContent | null>(null);

  const replaySnapshot =
    useSyncExternalStore(
      offlineSaveReplayCoordinator.subscribe,
      offlineSaveReplayCoordinator.getSnapshot,
      offlineSaveReplayCoordinator.getSnapshot,
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
        coordinatorRef.current?.dispose();

        activeRequestRef.current?.abort();
        activeRequestRef.current = null;

        const coordinator =
          new AutosaveCoordinator({
            initialBaseVersionId:
              initialization.baseVersionId,

            initialContent:
              cloneContent(
                initialization.content,
              ),

            debounceMs:
              initialization.debounceMs,

            save: async (request) => {
              const controller =
                new AbortController();

              activeRequestRef.current =
                controller;

              try {
                return await saveNoteVersionWithOfflineQueue(
                  initialization.noteId,
                  actorRef.current,
                  request,
                  controller.signal,
                );
              } finally {
                if (
                  activeRequestRef.current ===
                  controller
                ) {
                  activeRequestRef.current =
                    null;
                }
              }
            },

            classifyError:
              classifySaveNoteVersionError,

            onStateChange:
              setSnapshot,

            onSaveSuccess: (result) => {
              onSaveSuccessRef.current(
                result,
              );
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

    if (pendingDraftRef.current) {
      coordinator.updateDraft(
        pendingDraftRef.current,
      );

      pendingDraftRef.current = null;
    }

    return () => {
      coordinatorRef.current?.dispose();

      activeRequestRef.current?.abort();
      activeRequestRef.current = null;

      coordinatorRef.current = null;
    };
  }, [installCoordinator, noteId]);

  const updateDraft = useCallback(
    (content: SoapContent) => {
      const copiedContent =
        cloneContent(content);

      const coordinator =
        coordinatorRef.current;

      if (!coordinator) {
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
      ? replaySnapshot.blockedConflict
      : null;

  const offlineConflict:
    NoteAutosaveConflict | null =
    offlineBlockedEntry?.conflict
      ? {
          message:
            offlineBlockedEntry.conflict
              .message,
          currentVersion:
            offlineBlockedEntry.conflict
              .currentVersion,
          commonAncestor:
            offlineBlockedEntry.conflict
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
    offlineConflict ?? localConflict;

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

  const retry = useCallback(() => {
    if (
      offlineBlockedEntry !== null
    ) {
      void offlineSaveReplayCoordinator.replay();
      return;
    }

    coordinatorRef.current?.retry();
  }, [offlineBlockedEntry]);

  const resolveConflict = useCallback(
    (
      resolvedContent: SoapContent,
      serverBaseVersionId: string,
    ): void => {
      const copiedContent =
        cloneContent(resolvedContent);

      if (
        offlineBlockedEntry !== null &&
        offlineBlockedEntry.conflict !==
          null
      ) {
        const resolutionNoteId = noteId;

        void offlineSaveReplayCoordinator
          .resolveBlockedConflict(
            copiedContent,
          )
          .then((response) => {
            if (
              response === null ||
              initializationRef.current
                .noteId !== resolutionNoteId
            ) {
              return;
            }

            const nextInitialization:
              NoteAutosaveInitialization = {
              noteId: resolutionNoteId,
              baseVersionId:
                response.savedVersion
                  .versionId,
              content:
                cloneContent(
                  copiedContent,
                ),
              debounceMs:
                initializationRef.current
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

      coordinatorRef.current?.resolveConflict(
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

  return {
    snapshot: effectiveSnapshot,
    conflict,
    updateDraft,
    retry,
    resolveConflict,
  };
}