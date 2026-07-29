import type { NoteListFilters } from "../utils/noteListSearchParams";
import type { NoteListResponse } from "./noteListResponse";

export async function getNotes(
  filters: NoteListFilters,
): Promise<NoteListResponse> {
  const searchParams = new URLSearchParams();

  searchParams.set("limit", "20");

  for (const status of filters.statuses) {
    searchParams.append("status", status);
  }

  if (filters.reviewerId !== "") {
    searchParams.set(
      "reviewerId",
      filters.reviewerId,
    );
  }

  if (filters.patientId !== "") {
    searchParams.set(
      "patientId",
      filters.patientId,
    );
  }

  if (filters.createdFrom !== "") {
    searchParams.set(
      "createdFrom",
      filters.createdFrom,
    );
  }

  if (filters.createdTo !== "") {
    searchParams.set(
      "createdTo",
      filters.createdTo,
    );
  }

  searchParams.set(
    "sortBy",
    filters.sortField,
  );

  searchParams.set(
    "sortOrder",
    filters.sortDirection,
  );

  const response = await fetch(
    `/api/notes?${searchParams.toString()}`,
  );

  if (!response.ok) {
    throw new Error("Unable to load notes.");
  }

  return response.json();
}