import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  NoteSummary,
} from "../../../domain/noteSummary";
import {
  applyRealtimeEventToNoteSummaries,
} from "./realtimeReconciliation";
import {
  useRealtimeSubscription,
} from "./useRealtimeSubscription";

export function useVisibleNotesRealtime(
  notes: readonly NoteSummary[],
  visibleNoteIds: readonly string[],
): readonly NoteSummary[] {
  const [
    realtimeNotes,
    setRealtimeNotes,
  ] = useState<NoteSummary[]>(
    () => [...notes],
  );

  useEffect(() => {
    setRealtimeNotes(
      current =>
        notes.map(note => {
          const existing =
            current.find(
              candidate =>
                candidate.id === note.id,
            );

          if (
            existing === undefined
          ) {
            return note;
          }

          if (
            existing.updatedAt >
            note.updatedAt
          ) {
            return existing;
          }

          return note;
        }),
    );
  }, [notes]);

  const stableVisibleIds =
    useMemo(
      () =>
        [
          ...new Set(
            visibleNoteIds,
          ),
        ].sort(),
      [visibleNoteIds],
    );

  useRealtimeSubscription({
    noteIds: stableVisibleIds,

    onEvent: event => {
      setRealtimeNotes(
        current =>
          applyRealtimeEventToNoteSummaries(
            current,
            event,
          ),
      );
    },
  });

  return realtimeNotes;
}
