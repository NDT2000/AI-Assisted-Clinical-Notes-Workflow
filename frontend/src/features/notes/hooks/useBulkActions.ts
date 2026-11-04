import {
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  Actor,
} from "../../../domain/actor";
import {
  canRequestRegeneration,
} from "../../../domain/noteGuards";
import type {
  NoteSummary,
} from "../../../domain/noteSummary";
import type {
  Reviewer,
} from "../../../domain/reviewers";
import {
  postAssignReviewer,
  postRequestRegeneration,
} from "../api/bulkActions";

interface UseBulkActionsOptions {
  actor: Actor;
  items: NoteSummary[];
  setItems: Dispatch<
    SetStateAction<NoteSummary[]>
  >;
  selectedNotes: NoteSummary[];
  /* Clears the error when the user or filters change. */
  resetKey: string;
}

export interface UseBulkActionsResult {
  isBusy: boolean;
  error: string | null;
  eligibleForRegeneration: NoteSummary[];
  assignReviewer(
    reviewer: Reviewer | null,
  ): Promise<void>;
  requestRegeneration(): Promise<void>;
}

interface KeyedError {
  key: string;
  message: string | null;
}

/*
 * Applies a bulk change optimistically, then keeps it only for the
 * notes the server reports as updated. Any other selected note is
 * restored; a failed request restores the whole list.
 */
async function applyOptimistically(
  targetIds: ReadonlySet<string>,
  previousItems: NoteSummary[],
  setItems: UseBulkActionsOptions["setItems"],
  optimistic: (
    item: NoteSummary,
  ) => NoteSummary,
  send: () => Promise<{
    updated: string[];
  }>,
): Promise<void> {
  setItems(currentItems =>
    currentItems.map(item =>
      targetIds.has(item.id)
        ? optimistic(item)
        : item,
    ),
  );

  try {
    const response = await send();
    const updatedIds = new Set(
      response.updated,
    );

    setItems(currentItems =>
      currentItems.map(item => {
        if (
          !targetIds.has(item.id) ||
          updatedIds.has(item.id)
        ) {
          return item;
        }

        return (
          previousItems.find(
            previousItem =>
              previousItem.id === item.id,
          ) ?? item
        );
      }),
    );
  } catch (error) {
    setItems(previousItems);
    throw error;
  }
}

export function useBulkActions({
  actor,
  items,
  setItems,
  selectedNotes,
  resetKey,
}: UseBulkActionsOptions): UseBulkActionsResult {
  const [isBusy, setIsBusy] =
    useState(false);

  const [error, setError] =
    useState<KeyedError>({
      key: resetKey,
      message: null,
    });

  const eligibleForRegeneration =
    selectedNotes.filter(
      note =>
        canRequestRegeneration(
          note.status,
          actor.role,
        ).allowed,
    );

  async function run(
    targetNotes: NoteSummary[],
    failureMessage: string,
    optimistic: (
      item: NoteSummary,
    ) => NoteSummary,
    send: (
      noteIds: string[],
    ) => Promise<{ updated: string[] }>,
  ): Promise<void> {
    if (
      targetNotes.length === 0 ||
      isBusy
    ) {
      return;
    }

    const targetIds = new Set(
      targetNotes.map(note => note.id),
    );

    setError({
      key: resetKey,
      message: null,
    });
    setIsBusy(true);

    try {
      await applyOptimistically(
        targetIds,
        items,
        setItems,
        optimistic,
        () => send(Array.from(targetIds)),
      );
    } catch {
      setError({
        key: resetKey,
        message: failureMessage,
      });
    } finally {
      setIsBusy(false);
    }
  }

  return {
    isBusy,
    error:
      error.key === resetKey
        ? error.message
        : null,
    eligibleForRegeneration,

    assignReviewer(reviewer) {
      return run(
        selectedNotes,
        "Unable to assign reviewer. Changes were rolled back.",
        item =>
          item.status === "LOCKED"
            ? item
            : {
                ...item,
                assignedReviewer: reviewer,
              },
        noteIds =>
          postAssignReviewer(
            noteIds,
            reviewer,
            actor,
          ),
      );
    },

    requestRegeneration() {
      return run(
        eligibleForRegeneration,
        "Unable to request regeneration. Changes were rolled back.",
        item => ({
          ...item,
          status: "GENERATING",
        }),
        noteIds =>
          postRequestRegeneration(
            noteIds,
            actor,
          ),
      );
    },
  };
}
