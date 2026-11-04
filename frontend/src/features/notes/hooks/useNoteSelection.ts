import {
  useCallback,
  useState,
} from "react";

import type {
  NoteSummary,
} from "../../../domain/noteSummary";

export interface UseNoteSelectionResult {
  selectedIds: ReadonlySet<string>;
  selectedNotes: NoteSummary[];
  toggle(noteId: string): void;
  toggleAllLoaded(): void;
  clear(): void;
}

const NO_SELECTION: ReadonlySet<string> =
  new Set();

interface KeyedSelection {
  key: string;
  ids: ReadonlySet<string>;
}

/*
 * Row selection that resets whenever resetKey changes (a different
 * user or filter set). The selection is stored with the key it was
 * made under, so a stale selection simply reads as empty.
 */
export function useNoteSelection(
  items: NoteSummary[],
  resetKey: string,
): UseNoteSelectionResult {
  const [selection, setSelection] =
    useState<KeyedSelection>({
      key: resetKey,
      ids: NO_SELECTION,
    });

  const selectedIds =
    selection.key === resetKey
      ? selection.ids
      : NO_SELECTION;

  const update = useCallback(
    (
      change: (
        current: ReadonlySet<string>,
      ) => ReadonlySet<string>,
    ) => {
      setSelection(current => ({
        key: resetKey,
        ids: change(
          current.key === resetKey
            ? current.ids
            : NO_SELECTION,
        ),
      }));
    },
    [resetKey],
  );

  const toggle = useCallback(
    (noteId: string) => {
      update(current => {
        const next = new Set(current);

        if (next.has(noteId)) {
          next.delete(noteId);
        } else {
          next.add(noteId);
        }

        return next;
      });
    },
    [update],
  );

  const toggleAllLoaded =
    useCallback(() => {
      update(current => {
        const allSelected =
          items.length > 0 &&
          items.every(item =>
            current.has(item.id),
          );

        const next = new Set(current);

        for (const item of items) {
          if (allSelected) {
            next.delete(item.id);
          } else {
            next.add(item.id);
          }
        }

        return next;
      });
    }, [items, update]);

  const clear = useCallback(() => {
    update(() => NO_SELECTION);
  }, [update]);

  return {
    selectedIds,
    selectedNotes: items.filter(item =>
      selectedIds.has(item.id),
    ),
    toggle,
    toggleAllLoaded,
    clear,
  };
}
