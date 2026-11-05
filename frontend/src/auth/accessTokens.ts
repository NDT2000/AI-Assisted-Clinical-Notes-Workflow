import type { Actor } from "../domain/actor";
import {
  apiUrl,
  DEMO_PASSWORD,
  USE_MOCK_API,
} from "../api/apiConfig";

// Renew a little early, so a request never leaves with a token that is
// about to expire.
const EXPIRY_MARGIN_MS = 30_000;

/* Signing in was refused; `response` is the API's answer. */
export class SignInError extends Error {
  readonly response: Response;

  constructor(response: Response) {
    super(`Signing in failed with status ${response.status}.`);
    this.name = "SignInError";
    this.response = response;
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface LoginResponse {
  access_token: string;
  expires_in: number;
}

export interface AccessTokenStoreOptions {
  /* Make mock-server tokens locally instead of signing in. */
  useMockTokens: boolean;
  password: string;
  loginUrl: string;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

/*
 * Access tokens for the demo identities. Switching identity signs in
 * behind the scenes with the shared demo password; each identity's token
 * is kept until shortly before it expires, and concurrent requests share
 * one sign-in.
 */
export class AccessTokenStore {
  private readonly tokens = new Map<string, CachedToken>();

  private readonly pending = new Map<string, Promise<string>>();

  private readonly options: AccessTokenStoreOptions;

  constructor(options: AccessTokenStoreOptions) {
    this.options = options;
  }

  async getToken(actor: Actor): Promise<string> {
    if (this.options.useMockTokens) {
      const { createMockToken } = await import(
        "../mock-server/mockAuth"
      );

      return createMockToken(actor);
    }

    const cached = this.tokens.get(actor.id);

    if (
      cached !== undefined &&
      cached.expiresAt - EXPIRY_MARGIN_MS > this.now()
    ) {
      return cached.token;
    }

    const pending = this.pending.get(actor.id);

    if (pending !== undefined) {
      return pending;
    }

    const signIn = this.signIn(actor.id).finally(() => {
      this.pending.delete(actor.id);
    });

    this.pending.set(actor.id, signIn);

    return signIn;
  }

  /* Drop a token the API no longer accepts. */
  forget(actorId: string): void {
    this.tokens.delete(actorId);
  }

  private async signIn(actorId: string): Promise<string> {
    // Looked up per call, so test doubles of fetch are honoured.
    const fetchImplementation =
      this.options.fetchImplementation ?? globalThis.fetch;

    const response = await fetchImplementation(this.options.loginUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: actorId,
        password: this.options.password,
      }),
    });

    if (!response.ok) {
      throw new SignInError(response);
    }

    const body = (await response.json()) as LoginResponse;

    this.tokens.set(actorId, {
      token: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    });

    return body.access_token;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}

export const accessTokens = new AccessTokenStore({
  useMockTokens: USE_MOCK_API,
  password: DEMO_PASSWORD,
  loginUrl: apiUrl("/api/auth/login"),
});
