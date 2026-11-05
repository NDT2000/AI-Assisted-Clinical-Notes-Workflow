import { getMockActor } from "./mockAuth";
import { http, HttpResponse, } from "msw";

import type { UserRole, } from "../domain/noteAttributes";
import { getNoteDetail, } from "./noteStore";
import { simulateNetwork, SimulatedNetworkFailure, } from "./mockNetwork";

function getActorRole(
  request: Request,
): UserRole | null {
  return getMockActor(request)?.role ?? null;
}

export const getNoteDetailHandler =
  http.get(
    "*/api/notes/:noteId",
    async ({ params, request }) => {
      const actorRole =
        getActorRole(request);

      if (actorRole === null) {
        return HttpResponse.json(
          {
            error: "forbidden",
            message:
              "You are not authorized to view this note.",
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

      const detail =
        getNoteDetail(noteId);

      if (!detail) {
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
      }

      return HttpResponse.json(detail, {
        status: 200,
      });
    },
  );