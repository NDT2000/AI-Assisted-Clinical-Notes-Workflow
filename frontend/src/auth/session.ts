import { apiUrl, USE_MOCK_API } from "../api/apiConfig";
import type { Actor } from "../domain/actor";
import type { UserRole } from "../domain/noteAttributes";

/*
 * The signed-in user and their access token.
 *
 * Signing in returns a short-lived access token, kept here in memory only,
 * and sets a renewal cookie that scripts cannot read. Before the token
 * expires, or when the API refuses it, the cookie is swapped at
 * /api/auth/refresh for a new token. Tabs take turns renewing (Web Locks),
 * because each cookie works once and two tabs using the same one at the
 * same moment would end the session. Signing in or out in one tab tells
 * the others (BroadcastChannel).
 *
 * With the mock server (tests), tokens are made locally from the user.
 */

export interface SessionUser extends Actor {
  username: string;
}

export type SessionState =
  | { status: "starting" }
  | { status: "signedOut"; notice: string | null }
  | { status: "signedIn"; user: SessionUser };

export type SignInResult =
  | { ok: true; user: SessionUser }
  | { ok: false; message: string };

export const SESSION_ENDED =
  "Your session has ended. Sign in again.";
export const SIGNED_OUT = "You have signed out.";
export const SIGNED_OUT_ELSEWHERE =
  "You were signed out in another tab.";
export const OFFLINE_AT_START =
  "You are offline. Connect to the network to sign in.";

// Renew a little early, so a request never leaves with a token that is
// about to expire.
const EXPIRY_MARGIN_MS = 30_000;
const LOCK_NAME = "clinical-notes-session-renewal";
const CHANNEL_NAME = "clinical-notes-session";

interface TokenResponseBody {
  access_token: string;
  expires_in: number;
  user: {
    id: string;
    username: string;
    display_name: string;
    role: UserRole;
    mfa_verified: boolean;
  };
}

interface ErrorBody {
  message?: string;
}

type SessionMessage = { type: "signedIn" } | { type: "signedOut" };

interface ChannelLike {
  postMessage(message: SessionMessage): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SessionMessage>) => void,
  ): void;
  close(): void;
}

interface LocksLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface SessionStoreOptions {
  useMockTokens: boolean;
  fetchImplementation?: typeof fetch;
  now?: () => number;
  locks?: LocksLike | null;
  channel?: ChannelLike | null;
}

type Listener = () => void;

export function toSessionUser(
  body: TokenResponseBody["user"],
): SessionUser {
  return {
    id: body.id,
    username: body.username,
    displayName: body.display_name,
    role: body.role,
    mfaVerified: body.mfa_verified,
  };
}

async function messageOf(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody;
    return body.message?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function defaultLocks(): LocksLike | null {
  const locks =
    typeof navigator === "undefined" ? undefined : navigator.locks;

  return locks === undefined
    ? null
    : {
        request: (name, callback) => locks.request(name, callback),
      };
}

function defaultChannel(): ChannelLike | null {
  return typeof BroadcastChannel === "undefined"
    ? null
    : (new BroadcastChannel(CHANNEL_NAME) as unknown as ChannelLike);
}

export class SessionStore {
  private state: SessionState = { status: "starting" };

  private token: { value: string; expiresAt: number } | null = null;

  private renewal: Promise<string | null> | null = null;

  private starting: Promise<void> | null = null;

  private readonly listeners = new Set<Listener>();

  private readonly signOutListeners = new Set<Listener>();

  private readonly options: SessionStoreOptions;

  private readonly locks: LocksLike | null;

  private readonly channel: ChannelLike | null;

  constructor(options: SessionStoreOptions) {
    this.options = options;
    // With mock tokens (tests) nothing is shared: test files run side by
    // side, and a broadcast from one must not sign out another.
    const shared = !options.useMockTokens;
    this.locks =
      options.locks === undefined
        ? shared
          ? defaultLocks()
          : null
        : options.locks;
    this.channel =
      options.channel === undefined
        ? shared
          ? defaultChannel()
          : null
        : options.channel;
    this.channel?.addEventListener("message", (event) =>
      this.handleMessage(event.data),
    );
  }

  getState = (): SessionState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /* Called whenever this tab leaves a session, for any reason. */
  onSignedOut(listener: Listener): () => void {
    this.signOutListeners.add(listener);
    return () => {
      this.signOutListeners.delete(listener);
    };
  }

  getUser(): SessionUser | null {
    return this.state.status === "signedIn" ? this.state.user : null;
  }

  /* Resume a session from the renewal cookie, if there is one. */
  start(): Promise<void> {
    if (this.state.status !== "starting") {
      return Promise.resolve();
    }

    this.starting ??= this.renew({ quiet: true })
      .then(() => undefined)
      .catch(() => {
        // Offline: nothing to resume from yet.
        this.setState({ status: "signedOut", notice: OFFLINE_AT_START });
      })
      .finally(() => {
        this.starting = null;
      });

    return this.starting;
  }

  async signIn(username: string, password: string): Promise<SignInResult> {
    let response: Response;

    try {
      response = await this.fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      return {
        ok: false,
        message: "The server could not be reached. Check your connection.",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        message: await messageOf(response, "Signing in failed. Try again."),
      };
    }

    const user = this.accept((await response.json()) as TokenResponseBody);
    this.channel?.postMessage({ type: "signedIn" });

    return { ok: true, user };
  }

  async signOut(): Promise<void> {
    if (!this.options.useMockTokens) {
      try {
        await this.fetch(apiUrl("/api/auth/logout"), { method: "POST" });
      } catch {
        // Offline: the session still ends here; the server's renewal
        // cookie expires on its own.
      }
    }

    this.end(SIGNED_OUT);
    this.channel?.postMessage({ type: "signedOut" });
  }

  /*
   * A valid access token for the signed-in user, renewed if needed. Null
   * when there is no session (any more). Throws when the server cannot be
   * reached, like fetch, so callers treat it as a network failure.
   */
  async getAccessToken(): Promise<string | null> {
    const user = this.getUser();

    if (user === null) {
      return null;
    }

    if (this.options.useMockTokens) {
      const { createMockToken } = await import("../mock-server/mockAuth");
      return createMockToken(user);
    }

    if (
      this.token !== null &&
      this.token.expiresAt - EXPIRY_MARGIN_MS > this.now()
    ) {
      return this.token.value;
    }

    return this.renew();
  }

  /* The API refused the token: get a new one once. */
  async renewAfterRejection(): Promise<string | null> {
    if (this.options.useMockTokens) {
      return null;
    }

    this.token = null;
    return this.renew();
  }

  /* For tests: be signed in as this user, with mock tokens. */
  signInForTests(user: Actor & { username?: string }): void {
    this.token = null;
    this.setState({
      status: "signedIn",
      user: { ...user, username: user.username ?? user.id },
    });
  }

  /* For tests: back to the state before start(). */
  resetForTests(): void {
    this.token = null;
    this.renewal = null;
    this.starting = null;
    this.setState({ status: "starting" });
  }

  private renew(
    { quiet }: { quiet?: boolean } = {},
  ): Promise<string | null> {
    // Requests that need a token at the same moment share one renewal.
    this.renewal ??= this.withLock(() => this.requestRenewal(quiet ?? false))
      .finally(() => {
        this.renewal = null;
      });

    return this.renewal;
  }

  private async requestRenewal(quiet: boolean): Promise<string | null> {
    const response = await this.fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
    });

    if (!response.ok) {
      const wasSignedIn = this.state.status === "signedIn";
      this.end(wasSignedIn && !quiet ? SESSION_ENDED : null);
      return null;
    }

    this.accept((await response.json()) as TokenResponseBody);
    return this.token?.value ?? null;
  }

  private accept(body: TokenResponseBody): SessionUser {
    const user = toSessionUser(body.user);

    this.token = {
      value: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    };

    const current = this.getUser();
    if (
      current === null ||
      current.id !== user.id ||
      current.role !== user.role ||
      current.displayName !== user.displayName ||
      current.mfaVerified !== user.mfaVerified ||
      current.username !== user.username
    ) {
      this.setState({ status: "signedIn", user });
    }

    return user;
  }

  private end(notice: string | null): void {
    const wasSignedIn = this.state.status === "signedIn";

    this.token = null;
    this.setState({ status: "signedOut", notice });

    if (wasSignedIn) {
      for (const listener of this.signOutListeners) {
        listener();
      }
    }
  }

  private handleMessage(message: SessionMessage): void {
    if (message.type === "signedOut" && this.state.status === "signedIn") {
      this.end(SIGNED_OUT_ELSEWHERE);
    }

    if (message.type === "signedIn" && this.state.status === "signedOut") {
      // Another tab signed in: pick up its session from the cookie.
      void this.renew({ quiet: true }).catch(() => undefined);
    }
  }

  private withLock<T>(callback: () => Promise<T>): Promise<T> {
    return this.locks === null
      ? callback()
      : this.locks.request(LOCK_NAME, callback);
  }

  private fetch(input: string, init: RequestInit): Promise<Response> {
    // Looked up per call, so test doubles of fetch are honoured.
    const implementation =
      this.options.fetchImplementation ?? globalThis.fetch;

    return implementation(input, { credentials: "same-origin", ...init });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private setState(state: SessionState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const session = new SessionStore({ useMockTokens: USE_MOCK_API });
