import {
  useCallback,
  useMemo,
} from "react";
import {
  useSearchParams,
} from "react-router-dom";

import type {
  NoteStatus,
} from "../../../domain/noteAttributes";
import {
  parseNoteListSearchParams,
  type NoteListFilters,
  type NoteSortField,
  type SortDirection,
} from "../utils/noteListSearchParams";

export interface NoteListFilterActions {
  applyWorkspaceView(
    statuses: NoteStatus[],
    reviewerId: string,
  ): void;
  setStatuses(statuses: NoteStatus[]): void;
  setReviewer(reviewerId: string): void;
  setPatient(patientId: string): void;
  setCreatedFrom(createdFrom: string): void;
  setCreatedTo(createdTo: string): void;
  setSortField(sortField: NoteSortField): void;
  setSortDirection(
    sortDirection: SortDirection,
  ): void;
  setQuery(query: string): void;
}

export interface UseNoteListFiltersResult {
  filters: NoteListFilters;
  /* Stable string form of the URL filters, for keys and resets. */
  filtersKey: string;
  actions: NoteListFilterActions;
}

const WORKSPACE_VIEW_PARAMETERS = [
  "status",
  "reviewer",
  "patient",
  "createdFrom",
  "createdTo",
  "q",
] as const;

function setOrDelete(
  searchParams: URLSearchParams,
  name: string,
  value: string,
): void {
  if (value === "") {
    searchParams.delete(name);
    return;
  }

  searchParams.set(name, value);
}

/*
 * Filters, sorting and search live in the URL so a view survives
 * refreshes and can be shared. Changing a context filter (status,
 * reviewer, dates) clears the dependent patient filter.
 */
export function useNoteListFilters(): UseNoteListFiltersResult {
  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  const filtersKey =
    searchParams.toString();

  const filters = useMemo(
    () =>
      parseNoteListSearchParams(
        new URLSearchParams(filtersKey),
      ),
    [filtersKey],
  );

  const update = useCallback(
    (
      change: (
        next: URLSearchParams,
      ) => void,
      options?: { replace?: boolean },
    ) => {
      setSearchParams(
        current => {
          const next =
            new URLSearchParams(current);

          change(next);
          next.delete("cursor");

          return next;
        },
        {
          replace:
            options?.replace ?? false,
        },
      );
    },
    [setSearchParams],
  );

  const actions =
    useMemo<NoteListFilterActions>(
      () => ({
        applyWorkspaceView(
          statuses,
          reviewerId,
        ) {
          update(next => {
            for (const parameter of WORKSPACE_VIEW_PARAMETERS) {
              next.delete(parameter);
            }

            if (statuses.length > 0) {
              next.set(
                "status",
                statuses.join(","),
              );
            }

            setOrDelete(
              next,
              "reviewer",
              reviewerId,
            );
          });
        },

        setStatuses(statuses) {
          update(next => {
            setOrDelete(
              next,
              "status",
              statuses.join(","),
            );
            next.delete("patient");
          });
        },

        setReviewer(reviewerId) {
          update(next => {
            setOrDelete(
              next,
              "reviewer",
              reviewerId,
            );
            next.delete("patient");
          });
        },

        setPatient(patientId) {
          update(next => {
            setOrDelete(
              next,
              "patient",
              patientId,
            );
          });
        },

        setCreatedFrom(createdFrom) {
          update(next => {
            setOrDelete(
              next,
              "createdFrom",
              createdFrom,
            );
            next.delete("patient");
          });
        },

        setCreatedTo(createdTo) {
          update(next => {
            setOrDelete(
              next,
              "createdTo",
              createdTo,
            );
            next.delete("patient");
          });
        },

        setSortField(sortField) {
          update(next => {
            next.set(
              "sort",
              `${sortField}:${filters.sortDirection}`,
            );
          });
        },

        setSortDirection(sortDirection) {
          update(next => {
            next.set(
              "sort",
              `${filters.sortField}:${sortDirection}`,
            );
          });
        },

        setQuery(query) {
          update(
            next => {
              setOrDelete(next, "q", query);
            },
            { replace: true },
          );
        },
      }),
      [
        filters.sortDirection,
        filters.sortField,
        update,
      ],
    );

  return {
    filters,
    filtersKey,
    actions,
  };
}
