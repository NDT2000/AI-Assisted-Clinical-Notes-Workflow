import { http, HttpResponse } from "msw";

import type { SoapContent, UserRole, } from "../domain/noteAttributes";
import type { SaveNoteVersionActor, SaveNoteVersionRequestBody, } from "../domain/noteSave";
import { SimulatedNetworkFailure, simulateNetwork, } from "./mockNetwork";
import { saveNoteVersion } from "./noteStore";

const EDITING_ROLES: readonly UserRole[] = [
  "CLINICIAN",
  "REVIEWER",
  "ADMIN",
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

function isSoapContent(
  value: unknown,
): value is SoapContent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.subjective === "string" &&
    typeof value.objective === "string" &&
    typeof value.assessment === "string" &&
    typeof value.plan === "string"
  );
}

function isSaveNoteVersionRequestBody(
  value: unknown,
): value is SaveNoteVersionRequestBody {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.baseVersionId === "string" &&
    value.baseVersionId.trim().length > 0 &&
    typeof value.clientMutationId === "string" &&
    value.clientMutationId.trim().length > 0 &&
    isSoapContent(value.content)
  );
}

function getSaveActor(
  request: Request,
): SaveNoteVersionActor | null {
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
    !EDITING_ROLES.includes(
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

export const saveNoteVersionHandler =
  http.post(
    "*/api/notes/:noteId/versions",
    async ({ params, request }) => {
      const actor = getSaveActor(request);

      if (!actor) {
        return HttpResponse.json(
          {
            error: "forbidden",
            message:
              "You are not authorized to edit this note.",
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
        requestBody = await request.json();
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
        !isSaveNoteVersionRequestBody(
          requestBody,
        )
      ) {
        return HttpResponse.json(
          {
            error: "invalid_request",
            message:
              "baseVersionId, clientMutationId and complete SOAP content are required.",
          },
          {
            status: 400,
          },
        );
      }

      const result = saveNoteVersion(
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
                "The note has been updated since this draft was opened.",
              currentVersion:
                result.currentVersion,
            },
            {
              status: 409,
            },
          );
        
        case "idempotency-conflict":
          return HttpResponse.json(
            {
              error: "idempotency_conflict",
              message:
                "This clientMutationId has already been used for a different save request.",
            },
            {
              status: 409,
            },
          );

        case "saved":
          return HttpResponse.json(
            result.response,
            {
              status: 201,
            },
          );
      }
    },
  );