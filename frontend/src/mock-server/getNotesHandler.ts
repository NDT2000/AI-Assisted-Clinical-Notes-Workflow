import { http, HttpResponse } from "msw";

import { generateNoteSummaries } from "../mock-data/generateNoteSummary";
import { type NoteStatus, NOTE_STATUS } from "../domain/noteAttributes";
import type { NoteSummary } from "../domain/noteSummary";

const notes = generateNoteSummaries(5_000, 42);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const DEFAULT_CURSOR = 0;

type NoteSortField =
  | "createdAt"
  | "updatedAt"
  | "patientName"
  | "status";

type SortOrder = "asc" | "desc";

const NOTE_SORT_FIELDS: readonly NoteSortField[] = [
  "createdAt",
  "updatedAt",
  "patientName",
  "status",
];

const SORT_ORDERS: readonly SortOrder[] = [
  "asc",
  "desc",
];

function getLimit(searchParams: URLSearchParams): number {
    const rawLimit = searchParams.get("limit");

    if(rawLimit === null) {
        return DEFAULT_LIMIT;
    }

    const parsedLimit = Number(rawLimit);

    if(!Number.isInteger(parsedLimit) || parsedLimit <= 0){
        return DEFAULT_LIMIT;
    }

    return Math.min(parsedLimit, MAX_LIMIT);
}

function getCursor(searchParams: URLSearchParams): number {
  const rawCursor = searchParams.get("cursor");

  if (rawCursor === null) {
    return DEFAULT_CURSOR;
  }

  const parsedCursor = Number(rawCursor);

  if (!Number.isInteger(parsedCursor) || parsedCursor < 0) {
    return DEFAULT_CURSOR;
  }

  return parsedCursor;
}

function getStatuses(
  searchParams: URLSearchParams,
): NoteStatus[] {
  return searchParams
    .getAll("status")
    .filter(
      (status): status is NoteStatus =>
        NOTE_STATUS.includes(
          status as NoteStatus,
        ),
    );
}

function filterByStatuses(
  notes: NoteSummary[],
  statuses: NoteStatus[],
): NoteSummary[] {
  if (statuses.length === 0) {
    return notes;
  }

  return notes.filter((note) =>
    statuses.includes(note.status),
  );
}

function getReviewerIds(
  searchParams: URLSearchParams,
): string[] {
  return searchParams
    .getAll("reviewerId")
    .map((reviewerId) => reviewerId.trim())
    .filter((reviewerId) => reviewerId.length > 0);
}

function filterByReviewers(
  notes: NoteSummary[],
  reviewerIds: string[],
): NoteSummary[] {
  if (reviewerIds.length === 0) {
    return notes;
  }

  return notes.filter((note) =>
    note.assignedReviewer !== null &&
    reviewerIds.includes(note.assignedReviewer.id),
  );
}

function getPatientIds(
  searchParams: URLSearchParams,
): string[] {
  return searchParams
    .getAll("patientId")
    .map((patientId) => patientId.trim())
    .filter((patientId) => patientId.length > 0);
}

function filterByPatients(
  notes: NoteSummary[],
  patientIds: string[],
): NoteSummary[] {
  if (patientIds.length === 0) {
    return notes;
  }

  return notes.filter((note) =>
    patientIds.includes(note.patient.id),
  );
}

function getDateParameter(
  searchParams: URLSearchParams,
  key: string,
): Date | null {
  const rawDate = searchParams.get(key);

  if (rawDate === null || rawDate.trim().length === 0) {
    return null;
  }

  const parsedDate = new Date(rawDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function getCreatedTo(
  searchParams: URLSearchParams,
): Date | null {
  const rawDate = searchParams.get("createdTo");

  if (rawDate === null || rawDate.trim().length === 0) {
    return null;
  }

  const parsedDate = new Date(`${rawDate}T23:59:59.999Z`);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function getCreatedFrom(
  searchParams: URLSearchParams,
): Date | null {
  const rawDate = searchParams.get("createdFrom");

  if (rawDate === null || rawDate.trim().length === 0) {
    return null;
  }

  const parsedDate = new Date(`${rawDate}T00:00:00.000Z`);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function filterByCreatedDateRange(
  notes: NoteSummary[],
  createdFrom: Date | null,
  createdTo: Date | null,
): NoteSummary[] {
  if (createdFrom === null && createdTo === null) {
    return notes;
  }

  return notes.filter((note) => {
    const createdAt = new Date(note.createdAt);

    if (
      createdFrom !== null &&
      createdAt < createdFrom
    ) {
      return false;
    }

    if (
      createdTo !== null &&
      createdAt > createdTo
    ) {
      return false;
    }

    return true;
  });
}

function getSortField(
  searchParams: URLSearchParams,
): NoteSortField {
  const rawSortField =
    searchParams.get("sortBy");

  if (
    rawSortField !== null &&
    NOTE_SORT_FIELDS.includes(
      rawSortField as NoteSortField,
    )
  ) {
    return rawSortField as NoteSortField;
  }

  return "updatedAt";
}

function getSortOrder(
  searchParams: URLSearchParams,
): SortOrder {
  const rawSortOrder =
    searchParams.get("sortOrder");

  if (
    rawSortOrder !== null &&
    SORT_ORDERS.includes(
      rawSortOrder as SortOrder,
    )
  ) {
    return rawSortOrder as SortOrder;
  }

  return "desc";
}

function sortNotes(
  notes: NoteSummary[],
  sortField: NoteSortField,
  sortOrder: SortOrder,
): NoteSummary[] {
  const direction =
    sortOrder === "asc" ? 1 : -1;

  return [...notes].sort(
    (firstNote, secondNote) => {
      let comparison = 0;

      switch (sortField) {
        case "createdAt":
          comparison =
            new Date(
              firstNote.createdAt,
            ).getTime() -
            new Date(
              secondNote.createdAt,
            ).getTime();
          break;

        case "updatedAt":
          comparison =
            new Date(
              firstNote.updatedAt,
            ).getTime() -
            new Date(
              secondNote.updatedAt,
            ).getTime();
          break;

        case "patientName":
          comparison =
            firstNote.patient.displayName
              .localeCompare(
                secondNote.patient.displayName,
              );
          break;

        case "status":
          comparison =
            firstNote.status.localeCompare(
              secondNote.status,
            );
          break;
      }

      if (comparison === 0) {
        comparison =
          firstNote.id.localeCompare(
            secondNote.id,
          );
      }

      return comparison * direction;
    },
  );
}

export const getNotesHandler = http.get(
  "*/api/notes",
  ({ request }) => {
    const url = new URL(request.url);
    const limit = getLimit(url.searchParams);
    const cursor = getCursor(url.searchParams);
    const statuses = getStatuses(url.searchParams);
    const reviewerIds = getReviewerIds(url.searchParams);
    const patientIds = getPatientIds(url.searchParams);
    const createdFrom = getCreatedFrom(url.searchParams);
    const createdTo = getCreatedTo(url.searchParams);
    const sortField = getSortField(url.searchParams);
    const sortOrder = getSortOrder(url.searchParams);

    const statusFilteredNotes = filterByStatuses(
        notes,
        statuses,
    );
    const reviewerFilteredNotes = filterByReviewers(
        statusFilteredNotes,
        reviewerIds,
    );
    const patientFilteredNotes = filterByPatients(
        reviewerFilteredNotes,
        patientIds,
    );
    const dateFilteredNotes = filterByCreatedDateRange(
        patientFilteredNotes,
        createdFrom,
        createdTo,
    );
    const sortedNotes = sortNotes(
        dateFilteredNotes,
        sortField,
        sortOrder,
    );

    const items = sortedNotes.slice(
        cursor,
        cursor + limit);

    const nextCursor = cursor + items.length;
    const hasMore = nextCursor < sortedNotes.length;

    return HttpResponse.json({
      items,
      cursor: {
        next: hasMore
        ? String(nextCursor)
        : null,
        hasMore,
      },
      meta: {
        total: sortedNotes.length,
        returned: items.length,
      },
    });
  },
);