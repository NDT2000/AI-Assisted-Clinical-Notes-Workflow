import { describe, expect, it, vi } from "vitest";

import {
  OFFLINE_AT_START,
  SESSION_ENDED,
  SIGNED_OUT,
  SIGNED_OUT_ELSEWHERE,
  SessionStore,
} from "../session";

const USER_BODY = {
  id: "clinician-1",
  username: "clinician-1",
  display_name: "Dr. Maya Brooks",
  role: "CLINICIAN",
  mfa_verified: false,
};

function tokenResponse(token: string, expiresIn = 900): Response {
  return new Response(
    JSON.stringify({
      access_token: token,
      token_type: "bearer",
      expires_in: expiresIn,
      user: USER_BODY,
    }),
    { status: 200 },
  );
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: "unauthenticated", message }),
    { status },
  );
}

type Message = { type: "signedIn" } | { type: "signedOut" };

function fakeChannel() {
  let listener: ((event: MessageEvent<Message>) => void) | null = null;

  return {
    posted: [] as Message[],
    postMessage(message: Message) {
      this.posted.push(message);
    },
    addEventListener(
      _type: "message",
      callback: (event: MessageEvent<Message>) => void,
    ) {
      listener = callback;
    },
    close() {},
    receive(message: Message) {
      listener?.({ data: message } as MessageEvent<Message>);
    },
  };
}

function setup(
  responses: (Response | Error)[],
  { now = () => 0 }: { now?: () => number } = {},
) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("unexpected request");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  const request = vi.fn((_name: string, callback: () => Promise<unknown>) =>
    callback(),
  );
  const locks = {
    request: request as <T>(
      name: string,
      callback: () => Promise<T>,
    ) => Promise<T>,
  };
  const channel = fakeChannel();
  const store = new SessionStore({
    useMockTokens: false,
    fetchImplementation: fetchMock,
    now,
    locks,
    channel,
  });

  return { store, fetchMock, locks, channel };
}

function urlOf(call: unknown[] | undefined): string {
  return String(call?.[0]);
}

describe("SessionStore", () => {
  it("resumes a session from the renewal cookie at start", async () => {
    const { store, fetchMock, locks } = setup([tokenResponse("token-1")]);

    await store.start();

    expect(urlOf(fetchMock.mock.calls[0])).toBe("/api/auth/refresh");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    expect(locks.request).toHaveBeenCalledTimes(1);
    expect(store.getUser()).toEqual({
      id: "clinician-1",
      username: "clinician-1",
      displayName: "Dr. Maya Brooks",
      role: "CLINICIAN",
      mfaVerified: false,
    });
    expect(await store.getAccessToken()).toBe("token-1");
  });

  it("asks for a sign-in, without a notice, when there is no cookie", async () => {
    const { store } = setup([errorResponse(401, "Sign in to continue.")]);

    await store.start();

    expect(store.getState()).toEqual({ status: "signedOut", notice: null });
  });

  it("says so when it starts offline", async () => {
    const { store } = setup([new TypeError("Failed to fetch")]);

    await store.start();

    expect(store.getState()).toEqual({
      status: "signedOut",
      notice: OFFLINE_AT_START,
    });
  });

  it("signs in and tells the other tabs", async () => {
    const { store, fetchMock, channel } = setup([tokenResponse("token-1")]);

    const result = await store.signIn("clinician-1", "a-long-password");

    expect(result.ok).toBe(true);
    expect(urlOf(fetchMock.mock.calls[0])).toBe("/api/auth/login");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      username: "clinician-1",
      password: "a-long-password",
    });
    expect(store.getState().status).toBe("signedIn");
    expect(channel.posted).toEqual([{ type: "signedIn" }]);
  });

  it("passes on the API's reason when signing in is refused", async () => {
    const { store } = setup([
      errorResponse(429, "Too many failed sign-ins. Try again in 15 minutes."),
    ]);

    const result = await store.signIn("clinician-1", "wrong");

    expect(result).toEqual({
      ok: false,
      message: "Too many failed sign-ins. Try again in 15 minutes.",
    });
    expect(store.getUser()).toBeNull();
  });

  it("explains when the server cannot be reached", async () => {
    const { store } = setup([new TypeError("Failed to fetch")]);

    const result = await store.signIn("clinician-1", "a-long-password");

    expect(result).toEqual({
      ok: false,
      message: "The server could not be reached. Check your connection.",
    });
  });

  it("renews the token shortly before it expires", async () => {
    let now = 0;
    const { store, fetchMock } = setup(
      [tokenResponse("token-1", 900), tokenResponse("token-2", 900)],
      { now: () => now },
    );
    await store.signIn("clinician-1", "a-long-password");

    now = 800_000;
    expect(await store.getAccessToken()).toBe("token-1");

    now = 880_000; // within 30 seconds of expiry
    expect(await store.getAccessToken()).toBe("token-2");
    expect(urlOf(fetchMock.mock.calls[1])).toBe("/api/auth/refresh");
  });

  it("shares one renewal between requests at the same moment", async () => {
    const { store, fetchMock } = setup([
      tokenResponse("token-1"),
      tokenResponse("token-2"),
    ]);
    await store.signIn("clinician-1", "a-long-password");

    const tokens = await Promise.all([
      store.renewAfterRejection(),
      store.renewAfterRejection(),
      store.getAccessToken(),
    ]);

    expect(tokens).toEqual(["token-2", "token-2", "token-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ends the session when renewal is refused", async () => {
    const { store } = setup([
      tokenResponse("token-1"),
      errorResponse(401, "Your session has ended. Sign in again."),
    ]);
    const signedOut = vi.fn();
    store.onSignedOut(signedOut);
    await store.signIn("clinician-1", "a-long-password");

    expect(await store.renewAfterRejection()).toBeNull();

    expect(store.getState()).toEqual({
      status: "signedOut",
      notice: SESSION_ENDED,
    });
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(await store.getAccessToken()).toBeNull();
  });

  it("signs out on the server and in the other tabs", async () => {
    const { store, fetchMock, channel } = setup([
      tokenResponse("token-1"),
      new Response(null, { status: 204 }),
    ]);
    const signedOut = vi.fn();
    store.onSignedOut(signedOut);
    await store.signIn("clinician-1", "a-long-password");

    await store.signOut();

    expect(urlOf(fetchMock.mock.calls[1])).toBe("/api/auth/logout");
    expect(store.getState()).toEqual({
      status: "signedOut",
      notice: SIGNED_OUT,
    });
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(channel.posted.at(-1)).toEqual({ type: "signedOut" });
  });

  it("still signs out here when the server cannot be reached", async () => {
    const { store } = setup([
      tokenResponse("token-1"),
      new TypeError("Failed to fetch"),
    ]);
    await store.signIn("clinician-1", "a-long-password");

    await store.signOut();

    expect(store.getUser()).toBeNull();
  });

  it("follows sign-in and sign-out in another tab", async () => {
    const { store, channel } = setup([
      tokenResponse("token-1"),
      tokenResponse("token-2"),
    ]);
    await store.signIn("clinician-1", "a-long-password");

    channel.receive({ type: "signedOut" });

    expect(store.getState()).toEqual({
      status: "signedOut",
      notice: SIGNED_OUT_ELSEWHERE,
    });

    channel.receive({ type: "signedIn" });

    await vi.waitFor(() => {
      expect(store.getState().status).toBe("signedIn");
    });
    expect(await store.getAccessToken()).toBe("token-2");
  });

  it("makes mock tokens for tests without any request", async () => {
    const store = new SessionStore({ useMockTokens: true });

    store.signInForTests({
      id: "admin-1",
      displayName: "Jordan Lee",
      role: "ADMIN",
    });

    expect(await store.getAccessToken()).toMatch(/^mock\./);
    expect(await store.renewAfterRejection()).toBeNull();
  });
});
