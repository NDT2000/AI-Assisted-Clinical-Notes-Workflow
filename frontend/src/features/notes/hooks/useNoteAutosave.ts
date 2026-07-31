import { useCallback, useEffect, useRef, useState, } from "react";

import type { SoapContent, } from "../../../domain/noteAttributes";
import type { SaveNoteVersionActor, } from "../../../domain/noteSave";
import { AutosaveCoordinator, } from "../autosave/AutoSaveCoordinator";
import type { AutosaveSnapshot, AutosaveSuccess, } from "../autosave/AutoSaveCoordinator";
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

  const activeRequestRef =
    useRef<AbortController | null>(
      null,
    );

  const onSaveSuccessRef =
    useRef(onSaveSuccess);

  const pendingDraftRef =
    useRef<SoapContent | null>(null);

  useEffect(() => {
    onSaveSuccessRef.current =
      onSaveSuccess;
  }, [onSaveSuccess]);

  useEffect(() => {
    const coordinator =
      new AutosaveCoordinator({
        initialBaseVersionId,
        initialContent:
          cloneContent(initialContent),
        debounceMs,

        save: async (request) => {
          const controller =
            new AbortController();

          activeRequestRef.current =
            controller;

          try {
            return await saveNoteVersion(
              noteId,
              actor,
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
  }, [
    actor.id,
    actor.displayName,
    actor.role,
    debounceMs,
    initialBaseVersionId,
    initialContent.subjective,
    initialContent.objective,
    initialContent.assessment,
    initialContent.plan,
    noteId,
  ]);

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