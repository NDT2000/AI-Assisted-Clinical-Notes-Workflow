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
  RealtimeEventMeta,
} from "./realtimeTypes";

export interface UseRealtimeSubscriptionOptions {
  noteIds: readonly string[];
  onEvent: (
    event: NoteRealtimeEvent,
    meta: RealtimeEventMeta,
  ) => void;
  /* Too much changed while disconnected: reload these notes. */
  onReset?: (
    noteIds: readonly string[],
  ) => void;
  manager?: RealtimeConnectionManager;
}

export function useRealtimeSubscription({
  noteIds,
  onEvent,
  onReset,
  manager =
    realtimeConnectionManager,
}: UseRealtimeSubscriptionOptions): void {
  const onEventRef =
    useRef(onEvent);

  const onResetRef =
    useRef(onReset);

  useEffect(() => {
    onEventRef.current = onEvent;
    onResetRef.current = onReset;
  }, [onEvent, onReset]);

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
        (event, meta) => {
          onEventRef.current(
            event,
            meta,
          );
        },
        resetNoteIds => {
          onResetRef.current?.(
            resetNoteIds,
          );
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
