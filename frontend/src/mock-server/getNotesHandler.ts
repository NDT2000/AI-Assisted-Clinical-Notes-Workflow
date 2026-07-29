import { http, HttpResponse } from "msw";

import { getNotes } from "./noteStore";
import { SimulatedNetworkFailure, simulateNetwork } from "./mockNetwork";
import { type NoteStatus, NOTE_STATUS } from "../domain/noteAttributes";
import type { NoteSummary } from "../domain/noteSummary";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

interface NotesCursor {
  sortValue: string;
  id: string;
}

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

function getSortValue(
  note: NoteSummary,
  sortField: NoteSortField,
): string {
  switch (sortField) {
    case "createdAt":
      return note.createdAt;

    case "updatedAt":
      return note.updatedAt;

    case "patientName":
      return note.patient.displayName;

    case "status":
      return note.status;
  }
}

function encodeCursor(
  cursor: NotesCursor,
): string {
  return btoa(JSON.stringify(cursor));
}

function getCursor(
  searchParams: URLSearchParams,
): NotesCursor | null {
  const rawCursor =
    searchParams.get("cursor");

  if (!rawCursor) {
    return null;
  }

  try {
    const decodedCursor =
      atob(rawCursor);

    const parsedCursor: unknown =
      JSON.parse(decodedCursor);

    if (
      typeof parsedCursor !== "object" ||
      parsedCursor === null ||
      !("sortValue" in parsedCursor) ||
      !("id" in parsedCursor) ||
      typeof parsedCursor.sortValue !== "string" ||
      typeof parsedCursor.id !== "string"
    ) {
      return null;
    }

    return {
      sortValue: parsedCursor.sortValue,
      id: parsedCursor.id,
    };
  } catch {
    return null;
  }
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

function compareNotes(
  firstNote: NoteSummary,
  secondNote: NoteSummary,
  sortField: NoteSortField,
  sortOrder: SortOrder,
): number {
  let primaryComparison: number;

  switch (sortField) {
    case "createdAt":
      primaryComparison =
        new Date(firstNote.createdAt).getTime() -
        new Date(secondNote.createdAt).getTime();
      break;

    case "updatedAt":
      primaryComparison =
        new Date(firstNote.updatedAt).getTime() -
        new Date(secondNote.updatedAt).getTime();
      break;

    case "patientName":
      primaryComparison =
        firstNote.patient.displayName.localeCompare(
          secondNote.patient.displayName,
        );
      break;

    case "status":
      primaryComparison =
        firstNote.status.localeCompare(
          secondNote.status,
        );
      break;
  }

  const directionMultiplier =
    sortOrder === "asc" ? 1 : -1;

  if (primaryComparison !== 0) {
    return primaryComparison * directionMultiplier;
  }

  return (
    firstNote.id.localeCompare(secondNote.id) *
    directionMultiplier
  );
}

function sortNotes(
  notes: NoteSummary[],
  sortField: NoteSortField,
  sortOrder: SortOrder,
): NoteSummary[] {
  return [...notes].sort(
    (firstNote, secondNote) =>
      compareNotes(
        firstNote,
        secondNote,
        sortField,
        sortOrder,
      ),
  );
}

function getStartIndex(
  sortedNotes: NoteSummary[],
  cursor: NotesCursor | null,
  sortField: NoteSortField,
): number {
  if (cursor === null) {
    return 0;
  }

  const cursorIndex = sortedNotes.findIndex(
    (note) =>
      note.id === cursor.id &&
      getSortValue(note, sortField) ===
        cursor.sortValue,
  );

  if (cursorIndex === -1) {
    return 0;
  }

  return cursorIndex + 1;
}

export const getNotesHandler = http.get(
  "*/api/notes",
  async ({ request }) => {
    try {
      await simulateNetwork();
    } catch (error) {
      if (error instanceof SimulatedNetworkFailure) {
        return HttpResponse.json(
          { error: "internal_error", message: "Simulated failure" },
          { status: 503 },
        );
      }
      throw error;
    }

    const notes = getNotes();
    const url = new URL(request.url);
    const limit = getLimit(url.searchParams);
    const decodedCursor = getCursor(url.searchParams);
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
    const startIndex = getStartIndex(
      sortedNotes,
      decodedCursor,
      sortField,
    );

    const items = sortedNotes.slice(
        startIndex,
        startIndex + limit);
    
    
    const hasMore = startIndex + items.length < sortedNotes.length;
    const lastItem =
      items.length > 0
        ? items[items.length - 1]
        : null;
    
    const nextCursor =
      hasMore && lastItem !== null
        ? encodeCursor({
            sortValue: getSortValue(
              lastItem,
              sortField,
            ),
            id: lastItem.id,
          })
        : null;

    return HttpResponse.json({
      items,
      cursor: {
        next: nextCursor,
        hasMore,
      },
      meta: {
        total: sortedNotes.length,
        returned: items.length,
      },
    });
  },
);