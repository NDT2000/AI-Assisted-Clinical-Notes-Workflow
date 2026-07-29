import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

import { getNotes } from "../api/getNotes";
import type { NoteListResponse } from "../api/noteListResponse";
import { NotesFilters } from "../components/NotesFilters";
import { NotesTable } from "../components/NoteTable";
import { NotesTableSkeleton } from "../components/NotesTableSkeleton";
import type { NoteStatus } from "../../../domain/noteAttributes";
import {
  parseNoteListSearchParams,
} from "../utils/noteListSearchParams";

export function NotesPage() {
  const [searchParams, setSearchParams] =
    useSearchParams();

  const [data, setData] =
    useState<NoteListResponse | null>(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const searchParamsString =
    searchParams.toString();

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

      const response =
        await getNotes(filters);

      setData(response);
    } catch {
      setError("Unable to load notes.");
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  function handleStatusesChange(
    statuses: NoteStatus[],
  ) {
    const nextSearchParams =
      new URLSearchParams(searchParams);

    if (statuses.length === 0) {
      nextSearchParams.delete("status");
    } else {
      nextSearchParams.set(
        "status",
        statuses.join(","),
      );
    }

    nextSearchParams.delete("cursor");

    setSearchParams(nextSearchParams);
  }

  const filtersSection = (
    <NotesFilters
      filters={filters}
      onStatusesChange={
        handleStatusesChange
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

        <p role="alert">
          {error}
        </p>

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

        <p>
          No notes are available.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Notes</h1>

      {filtersSection}

      <NotesTable
        notes={data.items}
      />
    </main>
  );
}