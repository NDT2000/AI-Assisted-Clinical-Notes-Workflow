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

  // Subscribe by the set of ids, not the array identity, so callers
  // can pass a fresh array each render.
  const noteIdsKey = [
    ...new Set(noteIds),
  ]
    .sort()
    .join("\u0000");

  const normalizedNoteIds =
    useMemo(
      () =>
        noteIdsKey === ""
          ? []
          : noteIdsKey.split("\u0000"),
      [noteIdsKey],
    );

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
    normalizedNoteIds,
  ]);
}
