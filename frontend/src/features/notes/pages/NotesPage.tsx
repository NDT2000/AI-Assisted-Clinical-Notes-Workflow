import { useCallback, useEffect, useMemo, useRef, useState, } from "react";
import { useSearchParams } from "react-router-dom";

import type { NoteSortField, SortDirection, } from "../utils/noteListSearchParams";
import { parseNoteListSearchParams, } from "../utils/noteListSearchParams";
import type { NoteStatus, UserRole } from "../../../domain/noteAttributes";
import { canRequestRegeneration } from "../../../domain/noteGuards";
import type { NoteSummary, } from "../../../domain/noteSummary";
import { getNotes } from "../api/getNotes";
import { postAssignReviewer, postRequestRegeneration, } from "../api/bulkActions";
import { NotesFilters } from "../components/note-list/NotesFilters";
import { NotesTable } from "../components/note-list/NoteTable";
import { NotesTableSkeleton } from "../components/note-list/NotesTableSkeleton";
import { REVIEWERS, } from "../../../mock-data/generateNoteSummary";

const CURRENT_ACTOR_ROLE: UserRole =
  "CLINICIAN";

type ReviewerOption = {
  id: string;
  displayName: string;
};

export function NotesPage() {
  const [searchParams, setSearchParams] =
    useSearchParams();

  const [items, setItems] =
    useState<NoteSummary[]>([]);

  const [nextCursor, setNextCursor] =
    useState<string | null>(null);

  const [hasMore, setHasMore] =
    useState(false);

  const [total, setTotal] =
    useState(0);

  const [isLoading, setIsLoading] =
    useState(true);

  const [isLoadingMore, setIsLoadingMore] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [
    loadMoreError,
    setLoadMoreError,
  ] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] =
    useState<Set<string>>(new Set());

  const [
    bulkActionError,
    setBulkActionError,
  ] = useState<string | null>(null);

  const [
    isBulkActionInFlight,
    setIsBulkActionInFlight,
  ] = useState(false);

  const searchParamsString =
    searchParams.toString();

  const filters = useMemo(
    () =>
      parseNoteListSearchParams(
        new URLSearchParams(
          searchParamsString,
        ),
      ),
    [searchParamsString],
  );

  const requestTokenRef = useRef(0);

  const abortControllerRef =
    useRef<AbortController | null>(null);

  const loadMoreInFlightRef =
    useRef(false);

  const startNewRequest =
    useCallback((): AbortSignal => {
      if (
        abortControllerRef.current !==
        null
      ) {
        abortControllerRef.current.abort();
      }

      const controller =
        new AbortController();

      abortControllerRef.current =
        controller;

      return controller.signal;
    }, []);

  const loadFirstPage =
    useCallback(async () => {
      const requestToken =
        ++requestTokenRef.current;

      const signal =
        startNewRequest();

      try {
        setIsLoading(true);
        setError(null);
        setLoadMoreError(null);

        const response = await getNotes(
          filters,
          null,
          signal,
        );

        if (
          requestToken !==
          requestTokenRef.current
        ) {
          return;
        }

        setItems(response.items);
        setNextCursor(
          response.cursor.next,
        );
        setHasMore(
          response.cursor.hasMore,
        );
        setTotal(response.meta.total);
      } catch (caughtError) {
        if (
          caughtError instanceof
            DOMException &&
          caughtError.name ===
            "AbortError"
        ) {
          return;
        }

        if (
          requestToken ===
          requestTokenRef.current
        ) {
          setError(
            "Unable to load notes.",
          );
        }
      } finally {
        if (
          requestToken ===
          requestTokenRef.current
        ) {
          setIsLoading(false);
        }
      }
    }, [
      filters,
      startNewRequest,
    ]);

  const loadMore = useCallback(
    async (
      forceRetry = false,
    ): Promise<void> => {
      if (
        !hasMore ||
        nextCursor === null ||
        isLoadingMore ||
        loadMoreInFlightRef.current
      ) {
        return;
      }

      if (
        loadMoreError !== null &&
        !forceRetry
      ) {
        return;
      }

      const requestToken =
        requestTokenRef.current;

      const signal =
        startNewRequest();

      loadMoreInFlightRef.current =
        true;

      try {
        setIsLoadingMore(true);
        setLoadMoreError(null);

        const response = await getNotes(
          filters,
          nextCursor,
          signal,
        );

        if (
          requestToken !==
          requestTokenRef.current
        ) {
          return;
        }

        setItems((previousItems) => {
          const existingIds = new Set(
            previousItems.map(
              (item) => item.id,
            ),
          );

          const newItems =
            response.items.filter(
              (item) =>
                !existingIds.has(
                  item.id,
                ),
            );

          return [
            ...previousItems,
            ...newItems,
          ];
        });

        setNextCursor(
          response.cursor.next,
        );
        setHasMore(
          response.cursor.hasMore,
        );
        setTotal(response.meta.total);
      } catch (caughtError) {
        if (
          caughtError instanceof
            DOMException &&
          caughtError.name ===
            "AbortError"
        ) {
          return;
        }

        if (
          requestToken ===
          requestTokenRef.current
        ) {
          setLoadMoreError(
            "Unable to load more notes.",
          );
        }
      } finally {
        loadMoreInFlightRef.current =
          false;

        setIsLoadingMore(false);
      }
    },
    [
      filters,
      hasMore,
      isLoadingMore,
      loadMoreError,
      nextCursor,
      startNewRequest,
    ],
  );

  function toggleRow(
    noteId: string,
  ) {
    setSelectedIds((previous) => {
      const next = new Set(previous);

      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }

      return next;
    });
  }

  function toggleAllVisible() {
    const allVisibleSelected =
      items.length > 0 &&
      items.every((item) =>
        selectedIds.has(item.id),
      );

    setSelectedIds((previous) => {
      const next = new Set(previous);

      for (const item of items) {
        if (allVisibleSelected) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
      }

      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const selectedNotes =
    items.filter((item) =>
      selectedIds.has(item.id),
    );

  const eligibleForRegeneration =
  selectedNotes.filter((note) =>
    canRequestRegeneration(
      note.status,
      CURRENT_ACTOR_ROLE,
    ).allowed,
  );

  const ineligibleForRegenerationCount =
    selectedNotes.length -
    eligibleForRegeneration.length;

  async function handleBulkAssignReviewer(
    reviewer: ReviewerOption | null,
  ) {
    if (
      selectedNotes.length === 0 ||
      isBulkActionInFlight
    ) {
      return;
    }

    const previousItems = items;

    const selectedIdSet = new Set(
      selectedNotes.map(
        (note) => note.id,
      ),
    );

    setBulkActionError(null);
    setIsBulkActionInFlight(true);

    setItems((currentItems) =>
      currentItems.map((item) =>
        selectedIdSet.has(item.id) &&
        item.status !== "LOCKED"
          ? {
              ...item,
              assignedReviewer:
                reviewer,
            }
          : item,
      ),
    );

    try {
      const response =
        await postAssignReviewer(
          Array.from(selectedIdSet),
          reviewer,
        );

      const updatedIdSet =
        new Set(response.updated);

      setItems((currentItems) =>
        currentItems.map((item) => {
          if (
            !selectedIdSet.has(
              item.id,
            )
          ) {
            return item;
          }

          if (
            updatedIdSet.has(item.id)
          ) {
            return item;
          }

          const original =
            previousItems.find(
              (previousItem) =>
                previousItem.id ===
                item.id,
            );

          return original ?? item;
        }),
      );
    } catch {
      setItems(previousItems);

      setBulkActionError(
        "Unable to assign reviewer. Changes were rolled back.",
      );
    } finally {
      setIsBulkActionInFlight(false);
    }
  }

  async function handleBulkRegenerate() {
    if (
      eligibleForRegeneration.length ===
        0 ||
      isBulkActionInFlight
    ) {
      return;
    }

    const previousItems = items;

    const eligibleIdSet = new Set(
      eligibleForRegeneration.map(
        (note) => note.id,
      ),
    );

    setBulkActionError(null);
    setIsBulkActionInFlight(true);

    setItems((currentItems) =>
      currentItems.map((item) =>
        eligibleIdSet.has(item.id)
          ? {
              ...item,
              status: "GENERATING",
            }
          : item,
      ),
    );

    try {
      const response =
        await postRequestRegeneration(
          Array.from(eligibleIdSet,),
          CURRENT_ACTOR_ROLE,
        );

      const updatedIdSet =
        new Set(response.updated);

      setItems((currentItems) =>
        currentItems.map((item) => {
          if (
            !eligibleIdSet.has(
              item.id,
            )
          ) {
            return item;
          }

          if (
            updatedIdSet.has(item.id)
          ) {
            return item;
          }

          const original =
            previousItems.find(
              (previousItem) =>
                previousItem.id ===
                item.id,
            );

          return original ?? item;
        }),
      );
    } catch {
      setItems(previousItems);

      setBulkActionError(
        "Unable to request regeneration. Changes were rolled back.",
      );
    } finally {
      setIsBulkActionInFlight(false);
    }
  }

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkActionError(null);
  }, [searchParamsString]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setHasMore(false);
    setTotal(0);
    setLoadMoreError(null);

    void loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    return () => {
      if (
        abortControllerRef.current !==
        null
      ) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  function updateSearchParams(
    update: (
      nextSearchParams: URLSearchParams,
    ) => void,
    options?: {
      replace?: boolean;
    },
  ) {
    const nextSearchParams =
      new URLSearchParams(
        searchParams,
      );

    update(nextSearchParams);

    nextSearchParams.delete("cursor");

    setSearchParams(
      nextSearchParams,
      {
        replace:
          options?.replace ??
          false,
      },
    );
  }

  function setOrDeleteSearchParam(
    nextSearchParams:
      URLSearchParams,
    name: string,
    value: string,
  ) {
    if (value === "") {
      nextSearchParams.delete(name);
      return;
    }

    nextSearchParams.set(
      name,
      value,
    );
  }

  function handleStatusesChange(
    statuses: NoteStatus[],
  ) {
    updateSearchParams(
      (nextSearchParams) => {
        if (
          statuses.length === 0
        ) {
          nextSearchParams.delete(
            "status",
          );
        } else {
          nextSearchParams.set(
            "status",
            statuses.join(","),
          );
        }

        nextSearchParams.delete(
          "patient",
        );
      },
    );
  }

  function handleReviewerChange(
    reviewerId: string,
  ) {
    updateSearchParams(
      (nextSearchParams) => {
        setOrDeleteSearchParam(
          nextSearchParams,
          "reviewer",
          reviewerId,
        );

        nextSearchParams.delete(
          "patient",
        );
      },
    );
  }

  const handlePatientChange =
    useCallback(
      (
        patientId: string,
        _patientDisplayName: string,
      ) => {
        const nextSearchParams =
          new URLSearchParams(
            searchParams,
          );

        if (patientId === "") {
          nextSearchParams.delete(
            "patient",
          );
        } else {
          nextSearchParams.set(
            "patient",
            patientId,
          );
        }

        nextSearchParams.delete(
          "cursor",
        );

        setSearchParams(
          nextSearchParams,
        );
      },
      [
        searchParams,
        setSearchParams,
      ],
    );

  function handleQueryChange(
    query: string,
  ) {
    updateSearchParams(
      (nextSearchParams) => {
        setOrDeleteSearchParam(
          nextSearchParams,
          "q",
          query,
        );
      },
      {
        replace: true,
      },
    );
  }

  function handleCreatedFromChange(
    createdFrom: string,
  ) {
    updateSearchParams(
      (nextSearchParams) => {
        setOrDeleteSearchParam(
          nextSearchParams,
          "createdFrom",
          createdFrom,
        );

        nextSearchParams.delete(
          "patient",
        );
      },
    );
  }

  function handleCreatedToChange(
    createdTo: string,
  ) {
    updateSearchParams(
      (nextSearchParams) => {
        setOrDeleteSearchParam(
          nextSearchParams,
          "createdTo",
          createdTo,
        );

        nextSearchParams.delete(
          "patient",
        );
      },
    );
  }

  function handleSortFieldChange(
    sortField: NoteSortField,
  ) {
    updateSearchParams(
      (nextSearchParams) => {
        nextSearchParams.set(
          "sort",
          `${sortField}:${filters.sortDirection}`,
        );
      },
    );
  }

  function handleSortDirectionChange(
    sortDirection: SortDirection,
  ) {
    updateSearchParams(
      (nextSearchParams) => {
        nextSearchParams.set(
          "sort",
          `${filters.sortField}:${sortDirection}`,
        );
      },
    );
  }

  const filtersSection = (
    <NotesFilters
      filters={filters}
      onStatusesChange={
        handleStatusesChange
      }
      onReviewerChange={
        handleReviewerChange
      }
      onPatientChange={
        handlePatientChange
      }
      onCreatedFromChange={
        handleCreatedFromChange
      }
      onCreatedToChange={
        handleCreatedToChange
      }
      onSortFieldChange={
        handleSortFieldChange
      }
      onSortDirectionChange={
        handleSortDirectionChange
      }
      onQueryChange={
        handleQueryChange
      }
    />
  );

  if (isLoading) {
    return (
      <main>
        <h1>Notes</h1>

        {filtersSection}

        <NotesTableSkeleton />
      </main>
    );
  }

  if (
    error !== null &&
    items.length === 0
  ) {
    return (
      <main>
        <h1>Notes</h1>

        {filtersSection}

        <p role="alert">
          {error}
        </p>

        <button
          type="button"
          onClick={() =>
            void loadFirstPage()
          }
        >
          Try again
        </button>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main>
        <h1>Notes</h1>

        {filtersSection}

        <p>
          {filters.query !== ""
            ? `No notes match the search "${filters.query}".`
            : "No notes match the current filters."}
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Notes</h1>

      {filtersSection}

      <p>
        Showing {items.length} of{" "}
        {total} notes
      </p>

      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={
            selectedIds.size
          }
          eligibleForRegenerationCount={
            eligibleForRegeneration.length
          }
          ineligibleForRegenerationCount={
            ineligibleForRegenerationCount
          }
          isBusy={
            isBulkActionInFlight
          }
          error={bulkActionError}
          onAssignReviewer={
            handleBulkAssignReviewer
          }
          onRegenerate={() =>
            void handleBulkRegenerate()
          }
          onClearSelection={
            clearSelection
          }
        />
      )}

      <NotesTable
        key={searchParamsString}
        notes={items}
        hasMore={hasMore}
        isLoadingMore={
          isLoadingMore
        }
        onLoadMore={loadMore}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAllVisible={
          toggleAllVisible
        }
      />

      {loadMoreError !== null && (
        <div role="alert">
          <p>{loadMoreError}</p>

          <button
            type="button"
            onClick={() =>
              void loadMore(true)
            }
            disabled={
              isLoadingMore
            }
          >
            Retry loading more
          </button>
        </div>
      )}
    </main>
  );
}

function BulkActionBar({
  selectedCount,
  eligibleForRegenerationCount,
  ineligibleForRegenerationCount,
  isBusy,
  error,
  onAssignReviewer,
  onRegenerate,
  onClearSelection,
}: {
  selectedCount: number;
  eligibleForRegenerationCount:
    number;
  ineligibleForRegenerationCount:
    number;
  isBusy: boolean;
  error: string | null;
  onAssignReviewer: (
    reviewer:
      | ReviewerOption
      | null,
  ) => void;
  onRegenerate: () => void;
  onClearSelection: () => void;
}) {
  const [
    selectedReviewerId,
    setSelectedReviewerId,
  ] = useState("");

  function handleAssignClick() {
    const reviewer =
      REVIEWERS.find(
        (candidate) =>
          candidate.id ===
          selectedReviewerId,
      ) ?? null;

    onAssignReviewer(reviewer);
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
    >
      <p>
        {selectedCount} selected
      </p>

      <select
        aria-label="Reviewer to assign"
        value={selectedReviewerId}
        onChange={(event) =>
          setSelectedReviewerId(
            event.target.value,
          )
        }
        disabled={isBusy}
      >
        <option value="">
          Choose reviewer…
        </option>

        {REVIEWERS.map(
          (reviewer) => (
            <option
              key={reviewer.id}
              value={reviewer.id}
            >
              {
                reviewer.displayName
              }
            </option>
          ),
        )}
      </select>

      <button
        type="button"
        onClick={handleAssignClick}
        disabled={
          isBusy ||
          selectedReviewerId === ""
        }
      >
        Assign reviewer
      </button>

      <button
        type="button"
        onClick={onRegenerate}
        disabled={
          isBusy ||
          eligibleForRegenerationCount ===
            0
        }
        title={
          eligibleForRegenerationCount ===
          0
            ? "Only FAILED notes are eligible for regeneration."
            : undefined
        }
      >
        Request regeneration (
        {
          eligibleForRegenerationCount
        }
        )
      </button>

      {ineligibleForRegenerationCount >
        0 && (
        <p>
          {
            ineligibleForRegenerationCount
          }{" "}
          selected note
          {ineligibleForRegenerationCount ===
          1
            ? ""
            : "s"}{" "}
          not eligible for regeneration
          (not FAILED).
        </p>
      )}

      <button
        type="button"
        onClick={
          onClearSelection
        }
        disabled={isBusy}
      >
        Clear selection
      </button>

      {error !== null && (
        <p role="alert">
          {error}
        </p>
      )}
    </div>
  );
}