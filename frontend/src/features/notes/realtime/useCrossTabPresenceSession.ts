import type {
  Actor,
} from "../../../domain/actor";
import {
  useCallback,
  useEffect,
  useRef,
} from "react";

import {
  mockRealtimePresenceService,
  type MockRealtimePresenceService,
  type PresenceSessionHandle,
} from "./mockRealtimePresenceService";

interface UseCrossTabPresenceSessionOptions {
  noteId: string;
  actor: Actor;
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
        {
          id: actor.id,
          displayName:
            actor.displayName,
          role: actor.role,
        },
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
