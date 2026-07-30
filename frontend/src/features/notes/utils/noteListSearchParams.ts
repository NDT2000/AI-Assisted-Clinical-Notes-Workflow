import { NOTE_STATUS, type NoteStatus, } from "../../../domain/noteAttributes";
import { REVIEWERS, } from "../../../mock-data/generateNoteSummary";

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
  query: string;
}

export const DEFAULT_NOTE_LIST_FILTERS: NoteListFilters = {
  statuses: [],
  reviewerId: "",
  patientId: "",
  createdFrom: "",
  createdTo: "",
  sortField: "updatedAt",
  sortDirection: "desc",
  query: "",
};

const NOTE_SORT_FIELDS:
  readonly NoteSortField[] = [
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
  return (
    value === "asc" ||
    value === "desc"
  );
}

function isValidReviewerId(
  value: string,
): boolean {
  return REVIEWERS.some(
    (reviewer) =>
      reviewer.id === value,
  );
}

function isValidPatientIdFormat(
  value: string,
): boolean {
  return /^patient-[1-9]\d*$/.test(
    value,
  );
}

function isValidDateParameter(
  value: string,
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return false;
  }

  const [
    year,
    month,
    day,
  ] = value
    .split("-")
    .map(Number);

  const parsedDate = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
    ),
  );

  return (
    parsedDate.getUTCFullYear() ===
      year &&
    parsedDate.getUTCMonth() ===
      month - 1 &&
    parsedDate.getUTCDate() ===
      day
  );
}

function parseDateParameter(
  value: string | null,
): string {
  if (value === null) {
    return "";
  }

  const trimmedValue = value.trim();

  return isValidDateParameter(
    trimmedValue,
  )
    ? trimmedValue
    : "";
}

function parseSortParameter(
  rawSort: string | null,
): {
  sortField: NoteSortField;
  sortDirection: SortDirection;
} {
  if (rawSort === null) {
    return {
      sortField:
        DEFAULT_NOTE_LIST_FILTERS
          .sortField,
      sortDirection:
        DEFAULT_NOTE_LIST_FILTERS
          .sortDirection,
    };
  }

  const parts = rawSort.split(":");

  if (parts.length !== 2) {
    return {
      sortField:
        DEFAULT_NOTE_LIST_FILTERS
          .sortField,
      sortDirection:
        DEFAULT_NOTE_LIST_FILTERS
          .sortDirection,
    };
  }

  const [field, direction] = parts;

  if (
    !isNoteSortField(field) ||
    !isSortDirection(direction)
  ) {
    return {
      sortField:
        DEFAULT_NOTE_LIST_FILTERS
          .sortField,
      sortDirection:
        DEFAULT_NOTE_LIST_FILTERS
          .sortDirection,
    };
  }

  return {
    sortField: field,
    sortDirection: direction,
  };
}

export function parseNoteListSearchParams(
  searchParams: URLSearchParams,
): NoteListFilters {
  const rawStatuses =
    searchParams.get("status") ?? "";

  const statuses = Array.from(
    new Set(
      rawStatuses
        .split(",")
        .map((status) =>
          status.trim(),
        )
        .filter(
          (status) =>
            status.length > 0,
        )
        .filter(isNoteStatus),
    ),
  );

  const rawReviewerId = (
    searchParams.get("reviewer") ??
    ""
  ).trim();

  const reviewerId =
    isValidReviewerId(
      rawReviewerId,
    )
      ? rawReviewerId
      : "";

  let createdFrom =
    parseDateParameter(
      searchParams.get(
        "createdFrom",
      ),
    );

  let createdTo =
    parseDateParameter(
      searchParams.get(
        "createdTo",
      ),
    );

  if (
    createdFrom !== "" &&
    createdTo !== "" &&
    createdFrom > createdTo
  ) {
    createdFrom = "";
    createdTo = "";
  }

  const hasPatientContext =
    statuses.length > 0 ||
    reviewerId !== "" ||
    createdFrom !== "" ||
    createdTo !== "";

  const rawPatientId = (
    searchParams.get("patient") ??
    ""
  ).trim();

  /*
   * Patient is a dependent filter. Ignore it when no valid
   * status, reviewer or date filter provides context.
   */
  const patientId =
    hasPatientContext &&
    isValidPatientIdFormat(
      rawPatientId,
    )
      ? rawPatientId
      : "";

  const query = (
    searchParams.get("q") ??
    ""
  ).trim();

  const {
    sortField,
    sortDirection,
  } = parseSortParameter(
    searchParams.get("sort"),
  );

  return {
    statuses,
    reviewerId,
    patientId,
    createdFrom,
    createdTo,
    sortField,
    sortDirection,
    query,
  };
}