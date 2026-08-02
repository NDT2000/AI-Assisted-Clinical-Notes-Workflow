import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  UserRole,
} from "../../../domain/noteAttributes";

import type {
  NoteDetail,
} from "../../../domain/noteDetail";

import {
  NoteDetailRequestError,
} from "../api/getNoteDetail";

import {
  OfflineNoteDetailUnavailableError,
  readNoteDetail,
  type NoteDetailReadSource,
} from "../offline/readNoteDetail";

export type NoteDetailLoadState =
  | {
      status: "loading";
      note: null;
      message: null;
    }
  | {
      status: "success";
      note: NoteDetail;
      message: null;

      source: NoteDetailReadSource;

      cachedAt: number | null;
    }
  | {
      status: "unauthorized";
      note: null;
      message: string;
    }
  | {
      status: "not-found";
      note: null;
      message: string;
    }
  | {
      status: "error";
      note: null;
      message: string;
    };

export interface UseNoteDetailResult {
  state: NoteDetailLoadState;
  retry: () => void;
}

const INITIAL_STATE: NoteDetailLoadState = {
  status: "loading",
  note: null,
  message: null,
};

export function useNoteDetail(
  noteId: string | undefined,
  actorRole: UserRole,
): UseNoteDetailResult {
  const [state, setState] =
    useState<NoteDetailLoadState>(
      INITIAL_STATE,
    );

  const [retryToken, setRetryToken] =
    useState(0);

  const latestRequestToken =
    useRef(0);

  const retry = useCallback(() => {
    setRetryToken(
      (currentToken) =>
        currentToken + 1,
    );
  }, []);

  useEffect(() => {
    if (!noteId) {
      setState({
        status: "not-found",
        note: null,
        message:
          "No note ID was provided.",
      });

      return;
    }

    const resolvedNoteId = noteId;

    const controller =
      new AbortController();

    const requestToken =
      latestRequestToken.current + 1;

    latestRequestToken.current =
      requestToken;

    setState({
      status: "loading",
      note: null,
      message: null,
    });

    async function loadNote(): Promise<void> {
      try {
        const result =
          await readNoteDetail(
            resolvedNoteId,
            actorRole,
            controller.signal,
          );

        if (
          controller.signal.aborted ||
          requestToken !==
            latestRequestToken.current
        ) {
          return;
        }

        setState({
          status: "success",
          note: result.note,
          message: null,
          source: result.source,
          cachedAt: result.cachedAt,
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestToken !==
            latestRequestToken.current
        ) {
          return;
        }

        if (
          error instanceof
          NoteDetailRequestError
        ) {
          if (error.status === 403) {
            setState({
              status: "unauthorized",
              note: null,
              message: error.message,
            });

            return;
          }

          if (error.status === 404) {
            setState({
              status: "not-found",
              note: null,
              message: error.message,
            });

            return;
          }

          setState({
            status: "error",
            note: null,
            message: error.message,
          });

          return;
        }

        if (
          error instanceof
          OfflineNoteDetailUnavailableError
        ) {
          setState({
            status: "error",
            note: null,
            message: error.message,
          });

          return;
        }

        setState({
          status: "error",
          note: null,
          message:
            "Unable to load note details.",
        });
      }
    }

    void loadNote();

    return () => {
      controller.abort();
    };
  }, [
    noteId,
    actorRole,
    retryToken,
  ]);

  return {
    state,
    retry,
  };
}