import {
  accessTokens,
  SignInError,
  type AccessTokenStore,
} from "../auth/accessTokens";
import { getActiveActor } from "../auth/activeActor";
import type { Actor } from "../domain/actor";
import { apiUrl } from "./apiConfig";

export interface ApiFetchOptions {
  /* Who the request is sent as; the active identity by default. */
  actor?: Actor;
  tokens?: AccessTokenStore;
}

/*
 * fetch for API paths ("/api/..."): adds the API's base URL and the
 * actor's access token. A token the API rejects (401) is renewed once.
 * If signing in itself is refused, its 401 response is returned, so
 * callers handle it like any other error response. Network failures
 * throw, as fetch does.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const actor = options.actor ?? getActiveActor();
  const tokens = options.tokens ?? accessTokens;

  async function send(): Promise<Response> {
    const token = await tokens.getToken(actor);
    const headers = new Headers(init.headers);

    headers.set("authorization", `Bearer ${token}`);

    return fetch(apiUrl(path), { ...init, headers });
  }

  try {
    const response = await send();

    if (response.status !== 401) {
      return response;
    }

    tokens.forget(actor.id);

    return await send();
  } catch (error) {
    if (error instanceof SignInError) {
      return error.response;
    }

    throw error;
  }
}
