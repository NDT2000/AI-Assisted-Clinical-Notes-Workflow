export interface PatientOption {
  id: string;
  displayName: string;
}

interface PatientsResponse {
  items: PatientOption[];
}

export async function getPatients(
  query: string,
  signal?: AbortSignal,
): Promise<PatientOption[]> {
  const searchParams = new URLSearchParams();

  if (query !== "") {
    searchParams.set("q", query);
  }

  const response = await fetch(
    `/api/patients?${searchParams.toString()}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error("Unable to load patients.");
  }

  const data: PatientsResponse = await response.json();

  return data.items;
}