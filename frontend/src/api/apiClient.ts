import { session as defaultSession, type SessionStore } from "../auth/session";
import type { Actor } from "../domain/actor";
import { apiUrl } from "./apiConfig";

export interface ApiFetchOptions {
  /*
   * Who the request is made for, such as the author of a save queued
   * offline. It must be the signed-in user: a change is never sent with
   * someone else's sign-in.
   */
  actor?: Actor;
  session?: SessionStore;
}

function errorResponse(
  status: number,
  error: string,
  message: string,
): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/*
 * fetch for API paths ("/api/..."): adds the API's base URL and the
 * signed-in user's access token. A token the API rejects (401) is renewed
 * once. Without a session the answer is a 401 like the API's, so callers
 * handle it like any other error response. Network failures throw, as
 * fetch does.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const session = options.session ?? defaultSession;
  const user = session.getUser();

  if (user === null) {
    return errorResponse(401, "unauthenticated", "Sign in to continue.");
  }

  if (options.actor !== undefined && options.actor.id !== user.id) {
    return errorResponse(
      403,
      "forbidden",
      "This change was made by another user and cannot be sent with your " +
        "sign-in.",
    );
  }

  function send(token: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(apiUrl(path), { ...init, headers });
  }

  const token = await session.getAccessToken();

  if (token === null) {
    return errorResponse(401, "unauthenticated", "Sign in to continue.");
  }

  const response = await send(token);

  if (response.status !== 401) {
    return response;
  }

  const renewed = await session.renewAfterRejection();

  return renewed === null ? response : send(renewed);
}
