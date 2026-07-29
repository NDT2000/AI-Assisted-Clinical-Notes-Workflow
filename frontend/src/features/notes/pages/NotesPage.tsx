import {
  useCallback,
  useEffect,
  useMemo,
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
import { getNotes } from "../api/getNotes";
import type { NoteListResponse } from "../api/noteListResponse";
import { NotesFilters } from "../components/NotesFilters";
import { NotesTable } from "../components/NoteTable";
import { NotesTableSkeleton } from "../components/NotesTableSkeleton";

export function NotesPage() {
  const [searchParams, setSearchParams] =
    useSearchParams();

  const [data, setData] =
    useState<NoteListResponse | null>(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

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

  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await getNotes(filters);

      setData(response);
    } catch {
      setError("Unable to load notes.");
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  /*
   * Changing the URL changes `filters`, which recreates
   * `loadNotes`, which causes this effect to run again.
   */
  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  function updateSearchParams(
    update: (
      nextSearchParams: URLSearchParams,
    ) => void,
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
     * By default, this creates a browser-history entry.
     * Therefore, Back and Forward can restore earlier filters.
     */
    setSearchParams(nextSearchParams);
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
  ) {
    updateSearchParams((nextSearchParams) => {
      setOrDeleteSearchParam(
        nextSearchParams,
        "patient",
        patientId,
      );
    });
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

  if (error !== null) {
    return (
      <main>
        <h1>Notes</h1>

        {filtersSection}

        <p role="alert">{error}</p>

        <button
          type="button"
          onClick={() => void loadNotes()}
        >
          Try again
        </button>
      </main>
    );
  }

  if (
    data === null ||
    data.items.length === 0
  ) {
    return (
      <main>
        <h1>Notes</h1>

        {filtersSection}

        <p>No notes match the current filters.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Notes</h1>

      {filtersSection}

      <NotesTable notes={data.items} />
    </main>
  );
}