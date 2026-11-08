import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionStore } from "../../auth/session";
import { apiFetch } from "../apiClient";

const clinician = {
  id: "clinician-1",
  displayName: "Dr. Maya Brooks",
  role: "CLINICIAN" as const,
};

function signedInSession(tokens: (string | null)[]) {
  const store = new SessionStore({ useMockTokens: false });
  store.signInForTests(clinician);

  const getAccessToken = vi
    .spyOn(store, "getAccessToken")
    .mockResolvedValue(tokens[0] ?? null);
  const renewAfterRejection = vi
    .spyOn(store, "renewAfterRejection")
    .mockResolvedValue(tokens[1] ?? null);

  return { store, getAccessToken, renewAfterRejection };
}

function authorizationOf(call: unknown[] | undefined): string | null {
  const init = call?.[1] as RequestInit | undefined;
  return new Headers(init?.headers).get("authorization");
}

describe("apiFetch", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("sends the signed-in user's token and keeps other headers", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    const { store } = signedInSession(["token-1"]);

    await apiFetch(
      "/api/notes",
      { method: "POST", headers: { "content-type": "application/json" } },
      { session: store },
    );

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/notes");
    expect(authorizationOf(call)).toBe("Bearer token-1");
    expect(new Headers(call?.[1]?.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("renews a rejected token once and retries", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { store, renewAfterRejection } = signedInSession([
      "token-1",
      "token-2",
    ]);

    const response = await apiFetch("/api/notes", {}, { session: store });

    expect(response.status).toBe(200);
    expect(renewAfterRejection).toHaveBeenCalledTimes(1);
    expect(authorizationOf(fetchMock.mock.calls[1])).toBe("Bearer token-2");
  });

  it("returns the API's 401 when the session cannot be renewed", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const { store } = signedInSession(["token-1", null]);

    const response = await apiFetch("/api/notes", {}, { session: store });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers 401 without a request when no one is signed in", async () => {
    const store = new SessionStore({ useMockTokens: false });
    store.resetForTests();

    const response = await apiFetch("/api/notes", {}, { session: store });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends another user's change with this sign-in", async () => {
    const { store } = signedInSession(["token-1"]);

    const response = await apiFetch(
      "/api/notes/note-1/versions",
      { method: "POST" },
      {
        session: store,
        actor: { id: "reviewer-1", displayName: "Alex Kim", role: "REVIEWER" },
      },
    );

    expect(response.status).toBe(403);
    expect((await response.json()).message).toContain("another user");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets network failures through, as fetch does", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { store } = signedInSession(["token-1"]);

    await expect(
      apiFetch("/api/notes", {}, { session: store }),
    ).rejects.toThrow(TypeError);
  });
});
