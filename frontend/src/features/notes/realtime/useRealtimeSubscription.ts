import {
  useEffect,
  useMemo,
  useRef,
} from "react";

import {
  realtimeConnectionManager,
  type RealtimeConnectionManager,
} from "./RealtimeConnectionManager";
import type {
  NoteRealtimeEvent,
} from "./realtimeTypes";

export interface UseRealtimeSubscriptionOptions {
  noteIds: readonly string[];
  onEvent: (
    event: NoteRealtimeEvent,
  ) => void;
  manager?: RealtimeConnectionManager;
}

export function useRealtimeSubscription({
  noteIds,
  onEvent,
  manager =
    realtimeConnectionManager,
}: UseRealtimeSubscriptionOptions): void {
  const onEventRef =
    useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const normalizedNoteIds =
    useMemo(
      () =>
        [
          ...new Set(noteIds),
        ].sort(),
      [noteIds],
    );

  const noteIdsKey =
    normalizedNoteIds.join("\u0000");

  useEffect(() => {
    if (
      normalizedNoteIds.length === 0
    ) {
      return;
    }

    const subscription =
      manager.subscribe(
        normalizedNoteIds,
        event => {
          onEventRef.current(event);
        },
      );

    return () => {
      subscription.disconnect();
    };
  }, [
    manager,
    noteIdsKey,
  ]);
}
