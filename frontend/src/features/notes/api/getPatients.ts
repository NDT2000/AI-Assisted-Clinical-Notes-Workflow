import type {
  NoteListFilters,
} from "../utils/noteListSearchParams";

export interface PatientOption {
  id: string;
  displayName: string;
}

interface PatientsResponse {
  items: PatientOption[];
}

type PatientLookupFilters = Pick<
  NoteListFilters,
  | "statuses"
  | "reviewerId"
  | "createdFrom"
  | "createdTo"
>;

export async function getPatients(
  query: string,
  filters: PatientLookupFilters,
  signal?: AbortSignal,
): Promise<PatientOption[]> {
  const searchParams = new URLSearchParams();

  if (query !== "") {
    searchParams.set("q", query);
  }

  for (const status of filters.statuses) {
    searchParams.append("status", status);
  }

  if (filters.reviewerId !== "") {
    searchParams.set(
      "reviewerId",
      filters.reviewerId,
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

  const response = await fetch(
    `/api/patients?${searchParams.toString()}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(
      "Unable to load patients.",
    );
  }

  const data: PatientsResponse =
    await response.json();

  return data.items;
}

export async function getPatientById(
  patientId: string,
  signal?: AbortSignal,
): Promise<PatientOption | null> {
  const searchParams = new URLSearchParams({
    patientId,
  });

  const response = await fetch(
    `/api/patients?${searchParams.toString()}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(
      "Unable to load the selected patient.",
    );
  }

  const data: PatientsResponse =
    await response.json();

  return data.items[0] ?? null;
}