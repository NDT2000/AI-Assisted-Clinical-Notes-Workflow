import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  NoteSummary,
} from "../../../domain/noteSummary";
import {
  getNotes,
} from "../api/getNotes";
import type {
  NoteListFilters,
} from "../utils/noteListSearchParams";

export interface UseNotesListResult {
  items: NoteSummary[];
  /* For optimistic updates by bulk actions. */
  setItems: Dispatch<
    SetStateAction<NoteSummary[]>
  >;
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
  reload(): void;
  loadMore(forceRetry?: boolean): void;
}

function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

/*
 * Cursor-paginated notes for the current filters. A filter change
 * starts over from the first page; responses for an older filter set
 * are dropped, and only one request runs at a time.
 */
export function useNotesList(
  filters: NoteListFilters,
): UseNotesListResult {
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

  const [
    isLoadingMore,
    setIsLoadingMore,
  ] = useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [
    loadMoreError,
    setLoadMoreError,
  ] = useState<string | null>(null);

  const requestTokenRef = useRef(0);

  const abortControllerRef =
    useRef<AbortController | null>(
      null,
    );

  const loadMoreInFlightRef =
    useRef(false);

  const startNewRequest =
    useCallback((): AbortSignal => {
      abortControllerRef.current?.abort();

      const controller =
        new AbortController();

      abortControllerRef.current =
        controller;

      return controller.signal;
    }, []);

  function resetToFirstPage() {
    setItems([]);
    setNextCursor(null);
    setHasMore(false);
    setTotal(0);
    setIsLoading(true);
    setError(null);
    setLoadMoreError(null);
  }

  // New filters start over from an empty first page.
  const [
    previousFilters,
    setPreviousFilters,
  ] = useState(filters);

  if (filters !== previousFilters) {
    setPreviousFilters(filters);
    resetToFirstPage();
  }

  // Bumped by reload() to fetch page one again for the same filters.
  const [reloadCount, setReloadCount] =
    useState(0);

  useEffect(() => {
    const requestToken =
      ++requestTokenRef.current;

    const signal = startNewRequest();

    // State changes only after the response arrives.
    async function fetchFirstPage() {
      try {
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
        if (isAbortError(caughtError)) {
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
    }

    void fetchFirstPage();
  }, [filters, reloadCount, startNewRequest]);

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

      const signal = startNewRequest();

      loadMoreInFlightRef.current = true;

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

        setItems(previousItems => {
          const existingIds = new Set(
            previousItems.map(
              item => item.id,
            ),
          );

          return [
            ...previousItems,
            ...response.items.filter(
              item =>
                !existingIds.has(item.id),
            ),
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
        if (isAbortError(caughtError)) {
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
        loadMoreInFlightRef.current = false;
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

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  function reload() {
    resetToFirstPage();
    setReloadCount(count => count + 1);
  }

  const requestMore = useCallback(
    (forceRetry?: boolean) => {
      void loadMore(forceRetry);
    },
    [loadMore],
  );

  return {
    items,
    setItems,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMoreError,
    reload,
    loadMore: requestMore,
  };
}
