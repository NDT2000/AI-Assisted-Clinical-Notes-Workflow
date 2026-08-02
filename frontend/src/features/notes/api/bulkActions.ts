import type {
  TransitionNoteActor,
} from "../../../domain/noteTransition";

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

function createActorHeaders(
  actor:
    TransitionNoteActor,
): Record<string, string> {
  return {
    "content-type":
      "application/json",
    "x-actor-id": actor.id,
    "x-actor-role":
      actor.role,
    "x-actor-display-name":
      actor.displayName,
  };
}

export async function postAssignReviewer(
  noteIds: string[],
  reviewer:
    | {
        id: string;
        displayName: string;
      }
    | null,
  actor:
    TransitionNoteActor,
): Promise<AssignReviewerResponse> {
  const response = await fetch(
    "/api/notes/bulk/assign-reviewer",
    {
      method: "POST",
      headers:
        createActorHeaders(actor),
      body: JSON.stringify({
        noteIds,
        reviewerId:
          reviewer?.id ?? null,
        reviewerDisplayName:
          reviewer?.displayName ??
          null,
      }),
    },
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
    TransitionNoteActor,
): Promise<RegenerateResponse> {
  const response = await fetch(
    "/api/notes/bulk/regenerate",
    {
      method: "POST",
      headers:
        createActorHeaders(actor),
      body:
        JSON.stringify({
          noteIds,
        }),
    },
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
