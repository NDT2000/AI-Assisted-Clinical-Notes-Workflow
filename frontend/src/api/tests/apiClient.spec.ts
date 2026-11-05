import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AccessTokenStore,
  SignInError,
} from "../../auth/accessTokens";
import { setActiveActor } from "../../auth/activeActor";
import { CURRENT_ACTOR } from "../../auth/currentActor";
import type { Actor } from "../../domain/actor";
import { apiFetch } from "../apiClient";

const clinician: Actor = {
  id: "clinician-1",
  displayName: "Dr. Maya Brooks",
  role: "CLINICIAN",
};

const admin: Actor = {
  id: "admin-1",
  displayName: "Jordan Lee",
  role: "ADMIN",
  mfaVerified: true,
};

function fakeTokens(): AccessTokenStore & {
  getToken: ReturnType<typeof vi.fn>;
  forget: ReturnType<typeof vi.fn>;
} {
  let issued = 0;

  return {
    getToken: vi.fn(async (actor: Actor) => {
      issued += 1;
      return `${actor.id}-token-${issued}`;
    }),
    forget: vi.fn(),
  } as unknown as AccessTokenStore & {
    getToken: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  };
}

function authorizationOf(call: unknown[] | undefined): string | null {
  const init = call?.[1] as RequestInit | undefined;
  return new Headers(init?.headers).get("authorization");
}

describe("apiFetch", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    setActiveActor(clinician);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setActiveActor(CURRENT_ACTOR);
  });

  it("sends the active identity's token and keeps other headers", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    const tokens = fakeTokens();

    await apiFetch(
      "/api/notes",
      { method: "POST", headers: { "content-type": "application/json" } },
      { tokens },
    );

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/notes");
    expect(authorizationOf(call)).toBe("Bearer clinician-1-token-1");
    expect(new Headers(call?.[1]?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(call?.[1]?.method).toBe("POST");
  });

  it("sends a named identity's token", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));

    await apiFetch("/api/notes", {}, { actor: admin, tokens: fakeTokens() });

    expect(authorizationOf(fetchMock.mock.calls[0])).toBe(
      "Bearer admin-1-token-1",
    );
  });

  it("renews a rejected token once", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const tokens = fakeTokens();

    const response = await apiFetch("/api/notes", {}, { tokens });

    expect(response.status).toBe(200);
    expect(tokens.forget).toHaveBeenCalledWith("clinician-1");
    expect(authorizationOf(fetchMock.mock.calls[1])).toBe(
      "Bearer clinician-1-token-2",
    );
  });

  it("returns the second 401 instead of retrying forever", async () => {
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 401 }),
    );

    const response = await apiFetch(
      "/api/notes",
      {},
      { tokens: fakeTokens() },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the API's answer when signing in is refused", async () => {
    const refused = new Response("{}", { status: 401 });
    const tokens = fakeTokens();
    tokens.getToken.mockRejectedValue(new SignInError(refused));

    await expect(apiFetch("/api/notes", {}, { tokens })).resolves.toBe(
      refused,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets network failures through, as fetch does", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(
      apiFetch("/api/notes", {}, { tokens: fakeTokens() }),
    ).rejects.toThrow(TypeError);
  });
});
