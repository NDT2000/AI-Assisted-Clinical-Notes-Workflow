import { useCallback, useEffect, useRef, useState, } from "react";

import type { SoapContent, } from "../../../domain/noteAttributes";
import type { SaveNoteVersionActor, } from "../../../domain/noteSave";
import { AutosaveCoordinator, } from "../autosave/AutosaveCoordinator";
import type { AutosaveSnapshot, AutosaveSuccess, } from "../autosave/AutosaveCoordinator";
import { classifySaveNoteVersionError, saveNoteVersion, } from "../api/saveNoteVersion";

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
  updateDraft: (
    content: SoapContent,
  ) => void;
  retry: () => void;
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
      baseVersionId: initialBaseVersionId,
      content: cloneContent(initialContent),
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

  const initialization =
    initializationRef.current;
  
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
      baseVersionId: initialBaseVersionId,
      content: cloneContent(initialContent),
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

  useEffect(() => {
    const initialization =
      initializationRef.current;

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
            return await saveNoteVersion(
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

    if (pendingDraftRef.current) {
      coordinator.updateDraft(
        pendingDraftRef.current,
      );

      pendingDraftRef.current =
        null;
    }

    return () => {
      coordinator.dispose();

      activeRequestRef.current?.abort();
      activeRequestRef.current = null;

      coordinatorRef.current = null;
    };
  }, [noteId]);

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

  const retry = useCallback(() => {
    coordinatorRef.current?.retry();
  }, []);

  return {
    snapshot,
    updateDraft,
    retry,
  };
}