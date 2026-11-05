import { apiFetch } from "../../../api/apiClient";
import type {
  Actor,
} from "../../../domain/actor";

interface AssignReviewerResponse {
  updated: string[];
}

interface RegenerateResponse {
  updated: string[];
  skipped: string[];
}

interface ErrorResponseBody {
  message?: string;
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body =
      (await response.json()) as
        ErrorResponseBody;

    if (
      typeof body.message ===
        "string" &&
      body.message.trim().length >
        0
    ) {
      return body.message;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

const JSON_HEADERS = {
  "content-type":
    "application/json",
};

export async function postAssignReviewer(
  noteIds: string[],
  reviewer:
    | {
        id: string;
        displayName: string;
      }
    | null,
  actor:
    Actor,
): Promise<AssignReviewerResponse> {
  const response = await apiFetch(
    "/api/notes/bulk/assign-reviewer",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        noteIds,
        reviewerId:
          reviewer?.id ?? null,
        reviewerDisplayName:
          reviewer?.displayName ??
          null,
      }),
    },
    { actor },
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        "Unable to assign reviewer.",
      ),
    );
  }

  return response.json();
}

export async function postRequestRegeneration(
  noteIds: string[],
  actor:
    Actor,
): Promise<RegenerateResponse> {
  const response = await apiFetch(
    "/api/notes/bulk/regenerate",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body:
        JSON.stringify({
          noteIds,
        }),
    },
    { actor },
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        "Unable to request regeneration.",
      ),
    );
  }

  return response.json();
}
