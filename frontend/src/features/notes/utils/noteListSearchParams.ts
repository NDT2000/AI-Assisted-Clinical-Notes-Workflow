import { NOTE_STATUS, type NoteStatus } from "../../../domain/noteAttributes";

export type NoteSortField =
  | "createdAt"
  | "updatedAt"
  | "patientName"
  | "status";

export type SortDirection =
  | "asc"
  | "desc";

export interface NoteListFilters {
  statuses: NoteStatus[];
  reviewerId: string;
  patientId: string;
  createdFrom: string;
  createdTo: string;
  sortField: NoteSortField;
  sortDirection: SortDirection;
}

export const DEFAULT_NOTE_LIST_FILTERS: NoteListFilters = {
  statuses: [],
  reviewerId: "",
  patientId: "",
  createdFrom: "",
  createdTo: "",
  sortField: "updatedAt",
  sortDirection: "desc",
};

const NOTE_SORT_FIELDS: readonly NoteSortField[] = [
  "createdAt",
  "updatedAt",
  "patientName",
  "status",
];

function isNoteStatus(
  value: string,
): value is NoteStatus {
  return NOTE_STATUS.includes(
    value as NoteStatus,
  );
}

function isNoteSortField(
  value: string,
): value is NoteSortField {
  return NOTE_SORT_FIELDS.includes(
    value as NoteSortField,
  );
}

function isSortDirection(
  value: string,
): value is SortDirection {
  return value === "asc" || value === "desc";
}

export function parseNoteListSearchParams(
  searchParams: URLSearchParams,
): NoteListFilters {
  const rawStatuses =
    searchParams.get("status") ?? "";

  const statuses = rawStatuses
    .split(",")
    .filter((status) => status.length > 0)
    .filter(isNoteStatus);

  const reviewerId =
    searchParams.get("reviewer") ?? "";

  const patientId =
    searchParams.get("patient") ?? "";

  const createdFrom =
    searchParams.get("createdFrom") ?? "";

  const createdTo =
    searchParams.get("createdTo") ?? "";

  const rawSort =
    searchParams.get("sort");

  let sortField =
    DEFAULT_NOTE_LIST_FILTERS.sortField;

  let sortDirection =
    DEFAULT_NOTE_LIST_FILTERS.sortDirection;

  if (rawSort !== null) {
    const [
      field,
      direction,
    ] = rawSort.split(":");

    if (isNoteSortField(field)) {
      sortField = field;
    }

    if (isSortDirection(direction)) {
      sortDirection = direction;
    }
  }

  return {
    statuses,
    reviewerId,
    patientId,
    createdFrom,
    createdTo,
    sortField,
    sortDirection,
  };
}