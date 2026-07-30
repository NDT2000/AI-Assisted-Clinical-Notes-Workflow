import type { UserRole, } from "../../../domain/noteAttributes";

interface AssignReviewerResponse {
  updated: string[];
}

interface RegenerateResponse {
  updated: string[];
  skipped: string[];
}

export async function postAssignReviewer(
  noteIds: string[],
  reviewer: { id: string; displayName: string } | null,
): Promise<AssignReviewerResponse> {
  const response = await fetch(
    "/api/notes/bulk/assign-reviewer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        noteIds,
        reviewerId: reviewer?.id ?? null,
        reviewerDisplayName: reviewer?.displayName ?? null,
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Unable to assign reviewer.");
  }

  return response.json();
}

export async function postRequestRegeneration(
  noteIds: string[],
  actorRole: UserRole,
): Promise<RegenerateResponse> {
  const response = await fetch(
    "/api/notes/bulk/regenerate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteIds, actorRole, }),
    },
  );

  if (!response.ok) {
    throw new Error("Unable to request regeneration.");
  }

  return response.json();
}