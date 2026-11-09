import { useCallback, useEffect, useRef } from "react";

import {
  realtimeConnectionManager,
  type RealtimeConnectionManager,
} from "./RealtimeConnectionManager";

// Without typing for this long, editing becomes viewing again.
export const EDITING_IDLE_MS = 3_000;

/*
 * Presence for the open note: announces that this tab is viewing it, and
 * editing while the user types. Returns the function to call on each
 * change to the draft. Closing the note withdraws the announcement.
 */
export function useNotePresence(
  noteId: string,
  manager: RealtimeConnectionManager = realtimeConnectionManager,
): () => void {
  const isEditing = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isEditing.current = false;
    manager.setPresence({ noteId, activity: "VIEWING" });

    return () => {
      if (idleTimer.current !== null) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      manager.setPresence(null);
    };
  }, [manager, noteId]);

  return useCallback(() => {
    if (!isEditing.current) {
      isEditing.current = true;
      manager.setPresence({ noteId, activity: "EDITING" });
    }

    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
    }
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      isEditing.current = false;
      manager.setPresence({ noteId, activity: "VIEWING" });
    }, EDITING_IDLE_MS);
  }, [manager, noteId]);
}
