import { http, HttpResponse, } from "msw";

import type { UserRole } from "../domain/noteAttributes";
import { USER_NOTE_ACTION_TRIGGERS, type TransitionNoteActor, type TransitionNoteRequestBody, type UserNoteActionTrigger, } from "../domain/noteTransition";
import { SimulatedNetworkFailure, simulateNetwork, } from "./mockNetwork";
import { transitionNote } from "./noteStore";

const USER_ROLES: readonly UserRole[] = [
  "CLINICIAN",
  "REVIEWER",
  "ADMIN",
  "READONLY_AUDITOR",
];

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isUserNoteActionTrigger(
  value: unknown,
): value is UserNoteActionTrigger {
  return (
    typeof value === "string" &&
    USER_NOTE_ACTION_TRIGGERS.includes(
      value as UserNoteActionTrigger,
    )
  );
}

function isTransitionNoteRequestBody(
  value: unknown,
): value is TransitionNoteRequestBody {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.baseVersionId ===
      "string" &&
    value.baseVersionId.trim().length > 0 &&
    isUserNoteActionTrigger(
      value.trigger,
    ) &&
    (value.rejectionReason === undefined ||
      typeof value.rejectionReason ===
        "string")
  );
}

function getTransitionActor(
  request: Request,
): TransitionNoteActor | null {
  const id = request.headers
    .get("x-actor-id")
    ?.trim();

  const displayName = request.headers
    .get("x-actor-display-name")
    ?.trim();

  const rawRole = request.headers.get(
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
    mfaVerified:
      request.headers.get(
        "x-mfa-verified",
      ) === "true",
  };
}

export const transitionNoteHandler =
  http.post(
    "*/api/notes/:noteId/transitions",
    async ({ params, request }) => {
      const actor =
        getTransitionActor(request);

      if (!actor) {
        return HttpResponse.json(
          {
            error: "forbidden",
            message:
              "A valid actor is required to transition this note.",
          },
          {
            status: 403,
          },
        );
      }

      try {
        await simulateNetwork();
      } catch (error) {
        if (
          error instanceof
          SimulatedNetworkFailure
        ) {
          return HttpResponse.json(
            {
              error: "internal_error",
              message:
                "Simulated network failure.",
            },
            {
              status: 503,
            },
          );
        }

        throw error;
      }

      const noteId =
        typeof params.noteId === "string"
          ? params.noteId
          : "";

      if (!noteId) {
        return HttpResponse.json(
          {
            error: "invalid_request",
            message:
              "A valid note ID is required.",
          },
          {
            status: 400,
          },
        );
      }

      let requestBody: unknown;

      try {
        requestBody =
          await request.json();
      } catch {
        return HttpResponse.json(
          {
            error: "invalid_request",
            message:
              "The request body must contain valid JSON.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        !isTransitionNoteRequestBody(
          requestBody,
        )
      ) {
        return HttpResponse.json(
          {
            error: "invalid_request",
            message:
              "baseVersionId and a valid transition trigger are required.",
          },
          {
            status: 400,
          },
        );
      }

      const result = transitionNote(
        noteId,
        requestBody,
        actor,
      );

      switch (result.outcome) {
        case "not-found":
          return HttpResponse.json(
            {
              error: "not_found",
              message:
                `Note ${noteId} was not found.`,
            },
            {
              status: 404,
            },
          );

        case "version-conflict":
          return HttpResponse.json(
            {
              error: "version_conflict",
              message:
                "The note version is stale. Save or reload the latest version before running this action.",
              currentVersion:
                result.currentVersion,
            },
            {
              status: 409,
            },
          );

        case "transition-rejected":
          return HttpResponse.json(
            {
              error:
                "transition_not_allowed",
              message: result.reason,
            },
            {
              status: 422,
            },
          );

        case "transitioned":
          return HttpResponse.json(
            result.response,
            {
              status: 200,
            },
          );
      }
    },
  );