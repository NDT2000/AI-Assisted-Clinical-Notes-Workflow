import { useCallback, useEffect, useRef, useState, } from "react";

import type { NoteVersionDetail } from "../../../domain/noteDetail";
import type { TransitionNoteActor, TransitionNoteCommand, TransitionNoteRequestBody, TransitionNoteResponse, UserNoteActionTrigger, } from "../../../domain/noteTransition";
import { transitionNote, TransitionNoteRequestError, } from "../api/transitionNote";

export type NoteTransitionState =
  | {
      status: "idle";
      trigger: null;
      message: null;
      currentVersion: null;
    }
  | {
      status: "pending";
      trigger: UserNoteActionTrigger;
      message: null;
      currentVersion: null;
    }
  | {
      status: "succeeded";
      trigger: UserNoteActionTrigger;
      message: null;
      currentVersion: null;
    }
  | {
      status: "failed";
      trigger: UserNoteActionTrigger;
      message: string;
      currentVersion: null;
    }
  | {
      status: "conflicted";
      trigger: UserNoteActionTrigger;
      message: string;
      currentVersion:
        | NoteVersionDetail
        | null;
    };

interface UseNoteTransitionOptions {
  noteId: string;
  actor: TransitionNoteActor;
  onSuccess: (
    response: TransitionNoteResponse,
  ) => void;
}

interface UseNoteTransitionResult {
  state: NoteTransitionState;
  execute: (
    request: TransitionNoteCommand,
  ) => Promise<
    TransitionNoteResponse | null
  >;
  reset: () => void;
}

const INITIAL_STATE: NoteTransitionState = {
  status: "idle",
  trigger: null,
  message: null,
  currentVersion: null,
};

export function useNoteTransition({
  noteId,
  actor,
  onSuccess,
}: UseNoteTransitionOptions): UseNoteTransitionResult {
  const [state, setState] =
    useState<NoteTransitionState>(
      INITIAL_STATE,
    );

  const activeRequestRef =
    useRef<AbortController | null>(null);

  const latestRequestTokenRef =
    useRef(0);

  const onSuccessRef =
    useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    return () => {
      latestRequestTokenRef.current += 1;
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
    };
  }, []);

  const execute = useCallback(
    async (
      command: TransitionNoteCommand,
    ): Promise<TransitionNoteResponse | null
    > => {
      if (activeRequestRef.current) {
        return null;
      }

      const request: TransitionNoteRequestBody = {
        ...command,
        clientMutationId:
          crypto.randomUUID(),
      };

      const controller =
        new AbortController();

      const requestToken =
        latestRequestTokenRef.current + 1;

      latestRequestTokenRef.current =
        requestToken;

      activeRequestRef.current =
        controller;

      setState({
        status: "pending",
        trigger: request.trigger,
        message: null,
        currentVersion: null,
      });

      try {
        const response =
          await transitionNote(
            noteId,
            actor,
            request,
            controller.signal,
          );

        if (
          controller.signal.aborted ||
          requestToken !==
            latestRequestTokenRef.current
        ) {
          return null;
        }

        setState({
          status: "succeeded",
          trigger: request.trigger,
          message: null,
          currentVersion: null,
        });

        onSuccessRef.current(response);

        return response;
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestToken !==
            latestRequestTokenRef.current
        ) {
          return null;
        }

        if (
          error instanceof
            TransitionNoteRequestError
        ) {
          if (
            error.code ===
            "version_conflict"
          ) {
            setState({
              status: "conflicted",
              trigger: request.trigger,
              message: error.message,
              currentVersion:
                error.currentVersion ??
                null,
            });

            return null;
          }

          setState({
            status: "failed",
            trigger: request.trigger,
            message: error.message,
            currentVersion: null,
          });

          return null;
        }

        setState({
          status: "failed",
          trigger: request.trigger,
          message:
            "Unable to update the note status.",
          currentVersion: null,
        });

        return null;
      } finally {
        if (
          activeRequestRef.current ===
          controller
        ) {
          activeRequestRef.current = null;
        }
      }
    },
    [
      actor.id,
      actor.displayName,
      actor.role,
      actor.mfaVerified,
      noteId,
    ],
  );

  const reset = useCallback(() => {
    if (activeRequestRef.current) {
      return;
    }

    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    execute,
    reset,
  };
}