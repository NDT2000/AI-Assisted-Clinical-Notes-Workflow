import { useCallback, useEffect, useRef, useState, } from "react";

import type { NoteVersionDetail, } from "../../../domain/noteDetail";
import type { TransitionNoteActor, TransitionNoteCommand, TransitionNoteErrorCode, TransitionNoteRequestBody, 
  TransitionNoteResponse, UserNoteActionTrigger, } from "../../../domain/noteTransition";
import { transitionNote, TransitionNoteRequestError } from "../api/transitionNote";

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

export interface NoteTransitionFailure {
  code: TransitionNoteErrorCode | "unknown";
  message: string;
  currentVersion:
    | NoteVersionDetail
    | null;
}

interface UseNoteTransitionOptions {
  noteId: string;
  actor: TransitionNoteActor;
  onOptimisticApply?: (
    command: TransitionNoteCommand,
  ) => void;
  onSuccess: (
    response: TransitionNoteResponse,
  ) => void;
  onFailure?: (
    failure: NoteTransitionFailure,
  ) => void;
}

interface UseNoteTransitionResult {
  state: NoteTransitionState;
  execute: (
    command: TransitionNoteCommand,
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

function createClientMutationId(): string {
  if (
    typeof globalThis.crypto
      ?.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return [
    "transition",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2),
  ].join("-");
}

export function useNoteTransition({
  noteId,
  actor,
  onOptimisticApply,
  onSuccess,
  onFailure,
}: UseNoteTransitionOptions): UseNoteTransitionResult {
  const [state, setState] =
    useState<NoteTransitionState>(
      INITIAL_STATE,
    );

  const activeRequestRef =
    useRef<AbortController | null>(null);

  const latestRequestTokenRef =
    useRef(0);

  const onOptimisticApplyRef =
    useRef(onOptimisticApply);

  const onSuccessRef =
    useRef(onSuccess);

  const onFailureRef =
    useRef(onFailure);

  useEffect(() => {
    onOptimisticApplyRef.current =
      onOptimisticApply;
  }, [onOptimisticApply]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onFailureRef.current = onFailure;
  }, [onFailure]);

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
    ): Promise<
      TransitionNoteResponse | null
    > => {
      if (activeRequestRef.current) {
        return null;
      }

      const request: TransitionNoteRequestBody = {
        ...command,
        clientMutationId:
          createClientMutationId(),
      };

      const controller =
        new AbortController();

      const requestToken =
        latestRequestTokenRef.current + 1;

      latestRequestTokenRef.current =
        requestToken;

      activeRequestRef.current =
        controller;

      onOptimisticApplyRef.current?.(
        command,
      );

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
          const failure: NoteTransitionFailure =
            {
              code: error.code,
              message: error.message,
              currentVersion:
                error.currentVersion ??
                null,
            };

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
          } else {
            setState({
              status: "failed",
              trigger: request.trigger,
              message: error.message,
              currentVersion: null,
            });
          }

          onFailureRef.current?.(
            failure,
          );

          return null;
        }

        const failure: NoteTransitionFailure =
          {
            code: "unknown",
            message:
              "Unable to update the note status.",
            currentVersion: null,
          };

        setState({
          status: "failed",
          trigger: request.trigger,
          message: failure.message,
          currentVersion: null,
        });

        onFailureRef.current?.(
          failure,
        );

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
      actor.displayName,
      actor.id,
      actor.mfaVerified,
      actor.role,
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