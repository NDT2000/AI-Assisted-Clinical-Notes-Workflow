import {
  http,
  HttpResponse,
} from "msw";

import type {
  UserRole,
} from "../domain/noteAttributes";
import {
  canManageReviewerAssignments,
  canRequestRegeneration,
} from "../domain/noteGuards";
import type {
  TransitionNoteActor,
} from "../domain/noteTransition";
import {
  reassignNotes,
  regenerateNotes,
} from "./noteStore";
import {
  SimulatedNetworkFailure,
  simulateNetwork,
} from "./mockNetwork";

interface AssignReviewerBody {
  noteIds: string[];
  reviewerId: string | null;
  reviewerDisplayName:
    | string
    | null;
}

interface RegenerateBody {
  noteIds: string[];
}

const USER_ROLES:
  readonly UserRole[] = [
  "CLINICIAN",
  "REVIEWER",
  "ADMIN",
  "READONLY_AUDITOR",
];

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNoteIds(
  value: unknown,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      noteId =>
        typeof noteId ===
          "string" &&
        noteId.trim().length > 0,
    )
  );
}

function isAssignReviewerBody(
  value: unknown,
): value is AssignReviewerBody {
  if (!isRecord(value)) {
    return false;
  }

  if (!isNoteIds(value.noteIds)) {
    return false;
  }

  const reviewerId =
    value.reviewerId;

  const reviewerDisplayName =
    value.reviewerDisplayName;

  const bothNull =
    reviewerId === null &&
    reviewerDisplayName ===
      null;

  const bothStrings =
    typeof reviewerId ===
      "string" &&
    reviewerId.trim().length >
      0 &&
    typeof reviewerDisplayName ===
      "string" &&
    reviewerDisplayName.trim()
      .length > 0;

  return bothNull || bothStrings;
}

function isRegenerateBody(
  value: unknown,
): value is RegenerateBody {
  return (
    isRecord(value) &&
    isNoteIds(value.noteIds)
  );
}

function getActor(
  request: Request,
): TransitionNoteActor | null {
  const id =
    request.headers
      .get("x-actor-id")
      ?.trim();

  const displayName =
    request.headers
      .get(
        "x-actor-display-name",
      )
      ?.trim();

  const rawRole =
    request.headers.get(
      "x-actor-role",
    );

  if (
    !id ||
    !displayName ||
    rawRole === null ||
    !USER_ROLES.includes(
      rawRole as UserRole,
    )
  ) {
    return null;
  }

  return {
    id,
    displayName,
    role: rawRole as UserRole,
  };
}

async function parseRequestBody(
  request: Request,
): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function applyNetworkSimulation():
  Promise<
    Response | null
  > {
  try {
    await simulateNetwork();

    return null;
  } catch (error) {
    if (
      error instanceof
      SimulatedNetworkFailure
    ) {
      return HttpResponse.json(
        {
          error:
            "internal_error",
          message:
            "Simulated failure.",
        },
        {
          status: 503,
        },
      );
    }

    throw error;
  }
}

export const assignReviewerHandler =
  http.post(
    "*/api/notes/bulk/assign-reviewer",
    async ({ request }) => {
      const actor =
        getActor(request);

      if (actor === null) {
        return HttpResponse.json(
          {
            error: "forbidden",
            message:
              "A valid actor is required to assign reviewers.",
          },
          {
            status: 403,
          },
        );
      }

      const permission =
        canManageReviewerAssignments(
          actor.role,
        );

      if (!permission.allowed) {
        return HttpResponse.json(
          {
            error: "forbidden",
            message:
              permission.reason,
          },
          {
            status: 403,
          },
        );
      }

      const body =
        await parseRequestBody(
          request,
        );

      if (
        !isAssignReviewerBody(
          body,
        )
      ) {
        return HttpResponse.json(
          {
            error:
              "invalid_request",
            message:
              "noteIds and a complete reviewer selection are required.",
          },
          {
            status: 400,
          },
        );
      }

      const networkFailure =
        await applyNetworkSimulation();

      if (
        networkFailure !== null
      ) {
        return networkFailure;
      }

      const reviewer =
        body.reviewerId !==
          null &&
        body.reviewerDisplayName !==
          null
          ? {
              id:
                body.reviewerId,
              displayName:
                body.reviewerDisplayName,
            }
          : null;

      const updated =
        reassignNotes(
          body.noteIds,
          reviewer,
          actor.role,
        );

      return HttpResponse.json({
        updated,
      });
    },
  );

export const regenerateHandler =
  http.post(
    "*/api/notes/bulk/regenerate",
    async ({ request }) => {
      const actor =
        getActor(request);

      if (actor === null) {
        return HttpResponse.json(
          {
            error: "forbidden",
            message:
              "A valid actor is required to regenerate notes.",
          },
          {
            status: 403,
          },
        );
      }

      const rolePermission =
        canRequestRegeneration(
          "FAILED",
          actor.role,
        );

      if (
        !rolePermission.allowed
      ) {
        return HttpResponse.json(
          {
            error: "forbidden",
            message:
              rolePermission.reason,
          },
          {
            status: 403,
          },
        );
      }

      const body =
        await parseRequestBody(
          request,
        );

      if (
        !isRegenerateBody(body)
      ) {
        return HttpResponse.json(
          {
            error:
              "invalid_request",
            message:
              "A non-empty noteIds array is required.",
          },
          {
            status: 400,
          },
        );
      }

      const networkFailure =
        await applyNetworkSimulation();

      if (
        networkFailure !== null
      ) {
        return networkFailure;
      }

      const updated =
        regenerateNotes(
          body.noteIds,
          actor.role,
        );

      const updatedSet =
        new Set(updated);

      const skipped =
        body.noteIds.filter(
          noteId =>
            !updatedSet.has(
              noteId,
            ),
        );

      return HttpResponse.json({
        updated,
        skipped,
      });
    },
  );
