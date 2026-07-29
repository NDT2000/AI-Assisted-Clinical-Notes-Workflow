import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

import type {
  NoteSortField,
  SortDirection,
} from "../utils/noteListSearchParams";
import {
  parseNoteListSearchParams,
} from "../utils/noteListSearchParams";
import type { NoteStatus } from "../../../domain/noteAttributes";
import type { NoteSummary } from "../../../domain/noteSummary";
import { getNotes } from "../api/getNotes";
import {
  postAssignReviewer,
  postRequestRegeneration,
} from "../api/bulkActions";
import { NotesFilters, REVIEWERS } from "../components/NotesFilters";
import { NotesTable } from "../components/NoteTable";
import { NotesTableSkeleton } from "../components/NotesTableSkeleton";

export function NotesPage() {
  const [searchParams, setSearchParams] =
    useSearchParams();

  /*
   * Accumulated rows across every page fetched so far for the
   * CURRENT filter set. This resets to [] whenever filters change —
   * see the effect below — but grows via loadMore() otherwise.
   */
  const [items, setItems] =
    useState<NoteSummary[]>([]);

  const [nextCursor, setNextCursor] =
    useState<string | null>(null);

  const [hasMore, setHasMore] =
    useState(false);

  const [total, setTotal] =
    useState(0);

  /*
   * isLoading = the very first page for this filter set is in
   * flight (skeleton replaces the whole table).
   *
   * isLoadingMore = a subsequent page is in flight (small inline
   * loader at the bottom; existing rows stay exactly as they are).
   *
   * These are deliberately separate booleans, not one shared flag —
   * collapsing them would make the skeleton flash every time the
   * user scrolls near the bottom, which is the "list jumps or
   * blinks" failure mode the doc explicitly calls out.
   */
  const [isLoading, setIsLoading] =
    useState(true);

  const [isLoadingMore, setIsLoadingMore] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  /*
   * Selection state is deliberately NOT part of the reset-on-filter-
   * change effect below, and is NOT cleared by loadMore(). The doc
   * requires selection to "survive pagination and filter changes for
   * as long as the row is in view" — meaning a selected id remains
   * selected even if the user changes a filter and later changes it
   * back, or scrolls away and back. It only changes via explicit user
   * action (checking/unchecking a row, or "Clear selection").
   *
   * A selected id that's no longer in `items` (filtered out) simply
   * has no visible checkbox to represent it — the Set still holds
   * the id, so if that row reappears later, it renders as selected
   * again. This is why selection lives independently of `items`
   * rather than as a derived/computed property of it.
   */
  const [selectedIds, setSelectedIds] =
    useState<Set<string>>(new Set());

  const [bulkActionError, setBulkActionError] =
    useState<string | null>(null);

  const [isBulkActionInFlight, setIsBulkActionInFlight] =
    useState(false);

  /*
   * URLSearchParams is an object. Converting it to a string
   * gives us a stable dependency representing its contents.
   */
  const searchParamsString =
    searchParams.toString();

  /*
   * The URL is the source of truth.
   *
   * We do not copy these filters into separate React state.
   */
  const filters = useMemo(
    () =>
      parseNoteListSearchParams(
        new URLSearchParams(searchParamsString),
      ),
    [searchParamsString],
  );

  /*
   * Guards against a stale response overwriting fresher state.
   *
   * Scenario this prevents: user is mid-scroll (a loadMore request
   * for the OLD filters is in flight) and changes a filter before
   * that request resolves. Without this guard, the old request's
   * response could land after the reset and get appended onto the
   * new filter set's rows — silently wrong data, no error, hard to
   * notice. Every fetch captures the current token; a response is
   * only applied if the token it captured still matches the latest
   * one issued.
   */
  const requestTokenRef = useRef(0);

  /*
   * requestTokenRef (above) prevents a stale response from being
   * APPLIED to state. abortControllerRef goes further: it actually
   * cancels the underlying network request. The two solve different
   * problems — the token guard is a correctness backstop that works
   * even if cancellation is imperfect; the AbortController is what
   * stops wasted network/server work when the user changes filters
   * or types quickly. Keeping both is deliberate, not redundant.
   */
  const abortControllerRef = useRef<AbortController | null>(null);

  function startNewRequest(): AbortSignal {
    if (abortControllerRef.current !== null) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller.signal;
  }

  const loadFirstPage = useCallback(async () => {
    const requestToken = ++requestTokenRef.current;
    const signal = startNewRequest();

    try {
      setIsLoading(true);
      setError(null);

      const response = await getNotes(filters, null, signal);

      if (requestToken !== requestTokenRef.current) {
        // A newer request has since been issued; this response is
        // stale and must not overwrite newer state.
        return;
      }

      setItems(response.items);
      setNextCursor(response.cursor.next);
      setHasMore(response.cursor.hasMore);
      setTotal(response.meta.total);
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        // Cancelled by a newer request; not a real failure.
        return;
      }

      if (requestToken === requestTokenRef.current) {
        setError("Unable to load notes.");
      }
    } finally {
      if (requestToken === requestTokenRef.current) {
        setIsLoading(false);
      }
    }
  }, [filters]);

  const loadMore = useCallback(async () => {
    /*
     * Two separate guards, both necessary:
     *
     * - hasMore false: server has told us there is nothing left;
     *   calling again would just re-fetch an empty tail forever.
     * - isLoadingMore true: a page request is already in flight.
     *   Without this, rapid scroll events (fired many times per
     *   second) would each trigger their own request, producing
     *   duplicate pages and duplicate rows once they all resolve.
     */
    if (!hasMore || isLoadingMore || nextCursor === null) {
      return;
    }

    const requestToken = requestTokenRef.current;
    const signal = startNewRequest();

    try {
      setIsLoadingMore(true);

      const response = await getNotes(filters, nextCursor, signal);

      if (requestToken !== requestTokenRef.current) {
        return;
      }

      setItems((previousItems) => [
        ...previousItems,
        ...response.items,
      ]);
      setNextCursor(response.cursor.next);
      setHasMore(response.cursor.hasMore);
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      // A failed "load more" should not blank the list that's
      // already rendered — only surface a retry affordance for the
      // next page, not a full-page error.
      setError("Unable to load more notes.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [filters, hasMore, isLoadingMore, nextCursor]);

  // ---- Selection ----

  function toggleRow(noteId: string) {
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
      items.every((item) => selectedIds.has(item.id));

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

  const selectedNotes = items.filter((item) =>
    selectedIds.has(item.id),
  );

  /*
   * Eligibility for "Request regeneration" mirrors the Day 1 state
   * machine's FAILED -> GENERATING transition (canRegenerate in
   * noteGuards.ts): only FAILED notes qualify, and canRegenerate
   * itself only checks actor.role — there's no per-note ownership
   * guard for this particular transition. This is intentionally
   * OUTSIDE canTransition() rather than calling it directly, and
   * that gap is worth stating explicitly rather than hiding it:
   * canTransition expects a full `Note`/`NoteVersion` shape (matching
   * noteAttributes.ts), but the list view only has `NoteSummary`
   * (matching noteSummary.ts) — a deliberately lighter shape for
   * 100k+-row scale. Reconstructing a fake Note/Version per row just
   * to satisfy the guard's type signature would be wasted work for a
   * list screen. The Note Detail page (Day 3), which DOES have the
   * full Note object, is where the real canTransition/getAllowedActions
   * call belongs for actions on an individual note. This inline
   * check exists only to gate which rows a BULK action applies to,
   * and duplicates just the one status condition — not the general
   * pattern. Flagging this here so it doesn't quietly drift out of
   * sync with noteGuards.ts if that guard's condition ever changes.
   */
  const eligibleForRegeneration = selectedNotes.filter(
    (note) => note.status === "FAILED",
  );

  const ineligibleForRegenerationCount =
    selectedNotes.length - eligibleForRegeneration.length;

  async function handleBulkAssignReviewer(
    reviewer: { id: string; displayName: string } | null,
  ) {
    if (selectedNotes.length === 0 || isBulkActionInFlight) {
      return;
    }

    /*
     * Optimistic update pattern, same shape as everywhere else in
     * this app: snapshot current state, apply the change immediately
     * so the UI feels instant, then either discard the snapshot on
     * success or restore it on failure. `previousItems` captures
     * the exact pre-mutation array by closing over `items` at call
     * time — not a live reference, so it can't be mutated out from
     * under the rollback by anything else that runs while the
     * request is in flight.
     */
    const previousItems = items;
    const selectedIdSet = new Set(
      selectedNotes.map((note) => note.id),
    );

    setBulkActionError(null);
    setIsBulkActionInFlight(true);

    setItems((currentItems) =>
      currentItems.map((item) =>
        selectedIdSet.has(item.id) && item.status !== "LOCKED"
          ? { ...item, assignedReviewer: reviewer }
          : item,
      ),
    );

    try {
      const response = await postAssignReviewer(
        Array.from(selectedIdSet),
        reviewer,
      );

      /*
       * Reconcile against the server's actual `updated` list rather
       * than trusting the optimistic guess unconditionally. The mock
       * backend independently enforces "not LOCKED" too (noteStore.ts),
       * so this should normally match — but if it ever diverges (a
       * note locked between the optimistic apply and the server
       * processing it), the updatedIds set here is the correction.
       */
      const updatedIdSet = new Set(response.updated);

      setItems((currentItems) =>
        currentItems.map((item) => {
          if (!selectedIdSet.has(item.id)) {
            return item;
          }

          if (updatedIdSet.has(item.id)) {
            return item;
          }

          // Server didn't update this one; revert just this row
          // from the pre-mutation snapshot rather than the whole
          // list, since other rows' optimistic updates DID succeed.
          const original = previousItems.find(
            (previousItem) => previousItem.id === item.id,
          );

          return original ?? item;
        }),
      );
    } catch {
      // Full rollback: the request itself failed, so nothing the
      // server said should be trusted — restore the exact
      // pre-mutation snapshot.
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
      eligibleForRegeneration.length === 0 ||
      isBulkActionInFlight
    ) {
      return;
    }

    const previousItems = items;
    const eligibleIdSet = new Set(
      eligibleForRegeneration.map((note) => note.id),
    );

    setBulkActionError(null);
    setIsBulkActionInFlight(true);

    setItems((currentItems) =>
      currentItems.map((item) =>
        eligibleIdSet.has(item.id)
          ? { ...item, status: "GENERATING" }
          : item,
      ),
    );

    try {
      const response = await postRequestRegeneration(
        Array.from(eligibleIdSet),
      );

      const updatedIdSet = new Set(response.updated);

      setItems((currentItems) =>
        currentItems.map((item) => {
          if (!eligibleIdSet.has(item.id)) {
            return item;
          }

          if (updatedIdSet.has(item.id)) {
            return item;
          }

          const original = previousItems.find(
            (previousItem) => previousItem.id === item.id,
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

  /*
   * Filters changed (including on first mount) -> the accumulated
   * page list for the OLD filters is meaningless for the new ones.
   * Reset everything and fetch page 1 fresh. This is also where the
   * request token advances, which is what invalidates any in-flight
   * loadMore() from the previous filter set.
   */
  useEffect(() => {
    requestTokenRef.current += 1;
    setItems([]);
    setNextCursor(null);
    setHasMore(false);
    void loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  /*
   * Changing the URL changes `filters`, which the effect above
   * already reacts to by resetting and re-fetching. No second
   * effect is needed here — keeping both would fire two initial
   * fetches on mount.
   */

  function updateSearchParams(
    update: (
      nextSearchParams: URLSearchParams,
    ) => void,
    options?: { replace?: boolean },
  ) {
    const nextSearchParams =
      new URLSearchParams(searchParams);

    update(nextSearchParams);

    /*
     * Later, the cursor will identify a page produced using
     * the old filters. It must therefore be removed whenever
     * any filter or sort value changes.
     */
    nextSearchParams.delete("cursor");

    /*
     * By default, this creates a browser-history entry so Back and
     * Forward can restore earlier filters. For debounced search
     * (`replace: true`), we deliberately skip that: every pause
     * while typing would otherwise push a new history entry, so
     * pressing Back once would only undo the last keystroke-pause
     * rather than leaving the search box, which is not what a user
     * expects "Back" to do.
     */
    setSearchParams(nextSearchParams, {
      replace: options?.replace ?? false,
    });
  }

  function setOrDeleteSearchParam(
    nextSearchParams: URLSearchParams,
    name: string,
    value: string,
  ) {
    if (value === "") {
      nextSearchParams.delete(name);
      return;
    }

    nextSearchParams.set(name, value);
  }

  function handleStatusesChange(
    statuses: NoteStatus[],
  ) {
    updateSearchParams((nextSearchParams) => {
      if (statuses.length === 0) {
        nextSearchParams.delete("status");
        return;
      }

      nextSearchParams.set(
        "status",
        statuses.join(","),
      );
    });
  }

  function handleReviewerChange(
    reviewerId: string,
  ) {
    updateSearchParams((nextSearchParams) => {
      setOrDeleteSearchParam(
        nextSearchParams,
        "reviewer",
        reviewerId,
      );
    });
  }

  function handlePatientChange(
    patientId: string,
    _patientDisplayName: string,
  ) {
    updateSearchParams((nextSearchParams) => {
      setOrDeleteSearchParam(
        nextSearchParams,
        "patient",
        patientId,
      );
    });
  }

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
      { replace: true },
    );
  }

  function handleCreatedFromChange(
    createdFrom: string,
  ) {
    updateSearchParams((nextSearchParams) => {
      setOrDeleteSearchParam(
        nextSearchParams,
        "createdFrom",
        createdFrom,
      );
    });
  }

  function handleCreatedToChange(
    createdTo: string,
  ) {
    updateSearchParams((nextSearchParams) => {
      setOrDeleteSearchParam(
        nextSearchParams,
        "createdTo",
        createdTo,
      );
    });
  }

  function handleSortFieldChange(
    sortField: NoteSortField,
  ) {
    updateSearchParams((nextSearchParams) => {
      nextSearchParams.set(
        "sort",
        `${sortField}:${filters.sortDirection}`,
      );
    });
  }

  function handleSortDirectionChange(
    sortDirection: SortDirection,
  ) {
    updateSearchParams((nextSearchParams) => {
      nextSearchParams.set(
        "sort",
        `${filters.sortField}:${sortDirection}`,
      );
    });
  }

  const filtersSection = (
    <NotesFilters
      filters={filters}
      onStatusesChange={handleStatusesChange}
      onReviewerChange={handleReviewerChange}
      onPatientChange={handlePatientChange}
      onCreatedFromChange={
        handleCreatedFromChange
      }
      onCreatedToChange={handleCreatedToChange}
      onSortFieldChange={handleSortFieldChange}
      onSortDirectionChange={
        handleSortDirectionChange
      }
      onQueryChange={handleQueryChange}
    />
  );

  // ---- Full-page states: only apply when we have no rows at all ----

  if (isLoading) {
    return (
      <main>
        <h1>Notes</h1>

        {filtersSection}

        <NotesTableSkeleton />
      </main>
    );
  }

  if (error !== null && items.length === 0) {
    return (
      <main>
        <h1>Notes</h1>

        {filtersSection}

        <p role="alert">{error}</p>

        <button
          type="button"
          onClick={() => void loadFirstPage()}
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

  // ---- Populated state: rows are shown; loading/errors for
  // subsequent pages render as small inline affordances below the
  // table, never replacing what's already rendered. ----

  return (
    <main>
      <h1>Notes</h1>

      {filtersSection}

      <p>
        Showing {items.length} of {total} notes
      </p>

      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          eligibleForRegenerationCount={
            eligibleForRegeneration.length
          }
          ineligibleForRegenerationCount={
            ineligibleForRegenerationCount
          }
          isBusy={isBulkActionInFlight}
          error={bulkActionError}
          onAssignReviewer={handleBulkAssignReviewer}
          onRegenerate={() => void handleBulkRegenerate()}
          onClearSelection={clearSelection}
        />
      )}

      <NotesTable
        notes={items}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMore}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAllVisible={toggleAllVisible}
      />

      {error !== null && items.length > 0 && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void loadMore()}>
            Retry
          </button>
        </div>
      )}
    </main>
  );
}

/*
 * Kept local to this file rather than split out — it's small, has
 * no reuse elsewhere yet, and its only job is presenting state
 * NotesPage already owns. If a second bulk-action surface appears
 * later (e.g. the Note Detail page needs similar affordances), this
 * is the natural point to extract it into its own component file.
 */
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
  eligibleForRegenerationCount: number;
  ineligibleForRegenerationCount: number;
  isBusy: boolean;
  error: string | null;
  onAssignReviewer: (
    reviewer: { id: string; displayName: string } | null,
  ) => void;
  onRegenerate: () => void;
  onClearSelection: () => void;
}) {
  const [selectedReviewerId, setSelectedReviewerId] =
    useState("");

  function handleAssignClick() {
    const reviewer =
      REVIEWERS.find((r) => r.id === selectedReviewerId) ?? null;

    onAssignReviewer(reviewer);
  }

  return (
    <div role="toolbar" aria-label="Bulk actions">
      <p>{selectedCount} selected</p>

      <select
        aria-label="Reviewer to assign"
        value={selectedReviewerId}
        onChange={(event) =>
          setSelectedReviewerId(event.target.value)
        }
        disabled={isBusy}
      >
        <option value="">Choose reviewer…</option>
        {REVIEWERS.map((reviewer) => (
          <option key={reviewer.id} value={reviewer.id}>
            {reviewer.displayName}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={handleAssignClick}
        disabled={isBusy || selectedReviewerId === ""}
      >
        Assign reviewer
      </button>

      <button
        type="button"
        onClick={onRegenerate}
        disabled={isBusy || eligibleForRegenerationCount === 0}
        title={
          eligibleForRegenerationCount === 0
            ? "Only FAILED notes are eligible for regeneration."
            : undefined
        }
      >
        Request regeneration ({eligibleForRegenerationCount})
      </button>

      {ineligibleForRegenerationCount > 0 && (
        <p>
          {ineligibleForRegenerationCount} selected note
          {ineligibleForRegenerationCount === 1 ? "" : "s"} not
          eligible for regeneration (not FAILED).
        </p>
      )}

      <button type="button" onClick={onClearSelection}>
        Clear selection
      </button>

      {error !== null && <p role="alert">{error}</p>}
    </div>
  );
}