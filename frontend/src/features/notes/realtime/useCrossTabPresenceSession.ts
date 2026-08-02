import {
  useCallback,
  useEffect,
  useRef,
} from "react";

import type {
  TransitionNoteActor,
} from "../../../domain/noteTransition";
import {
  mockRealtimePresenceService,
  type MockRealtimePresenceService,
  type PresenceSessionHandle,
} from "./mockRealtimePresenceService";

interface UseCrossTabPresenceSessionOptions {
  noteId: string;
  actor: TransitionNoteActor;
  service?:
    MockRealtimePresenceService;
}

interface CrossTabPresenceSession {
  markEditing(): void;
}

export function useCrossTabPresenceSession({
  noteId,
  actor,
  service =
    mockRealtimePresenceService,
}: UseCrossTabPresenceSessionOptions):
  CrossTabPresenceSession {
  const sessionHandleRef =
    useRef<
      PresenceSessionHandle | null
    >(null);

  useEffect(() => {
    const sessionHandle =
      service.openNote(
        noteId,
        actor,
      );

    sessionHandleRef.current =
      sessionHandle;

    return () => {
      sessionHandle.disconnect();

      if (
        sessionHandleRef.current ===
        sessionHandle
      ) {
        sessionHandleRef.current =
          null;
      }
    };
  }, [
    actor.displayName,
    actor.id,
    actor.role,
    noteId,
    service,
  ]);

  const markEditing =
    useCallback(() => {
      sessionHandleRef.current?.markEditing();
    }, []);

  return {
    markEditing,
  };
}
