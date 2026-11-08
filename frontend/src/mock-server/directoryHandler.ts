import { http, HttpResponse } from "msw";

import { MOCK_USERS } from "../mock-data/mockUsers";
import { getMockActor } from "./mockAuth";

/* GET /api/users/directory: active people, for any signed-in user. */
export const directoryHandler = http.get(
  "*/api/users/directory",
  ({ request }) => {
    if (getMockActor(request) === null) {
      return HttpResponse.json(
        { error: "unauthenticated", message: "Sign in to continue." },
        { status: 401 },
      );
    }

    const role = new URL(request.url).searchParams.get("role");

    return HttpResponse.json({
      users: MOCK_USERS.filter(
        (user) => role === null || user.role === role,
      ).map(({ id, displayName, role: userRole }) => ({
        id,
        displayName,
        role: userRole,
      })),
    });
  },
);
