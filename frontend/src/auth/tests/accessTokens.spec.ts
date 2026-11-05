import { describe, expect, it, vi } from "vitest";

import type { Actor } from "../../domain/actor";
import { getMockActor } from "../../mock-server/mockAuth";
import { AccessTokenStore, SignInError } from "../accessTokens";

const reviewer: Actor = {
  id: "reviewer-1",
  displayName: "Alex Kim",
  role: "REVIEWER",
  mfaVerified: true,
};

function loginResponse(token: string, expiresIn = 3600): Response {
  return Response.json({
    access_token: token,
    token_type: "bearer",
    expires_in: expiresIn,
    user: {},
  });
}

function createStore(
  fetchImplementation: typeof fetch,
  now: () => number = () => 0,
): AccessTokenStore {
  return new AccessTokenStore({
    useMockTokens: false,
    password: "demo-password",
    loginUrl: "http://api.test/api/auth/login",
    fetchImplementation,
    now,
  });
}

describe("AccessTokenStore", () => {
  it("signs in as the actor with the demo password", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      loginResponse("token-1"),
    );

    await expect(
      createStore(fetchMock).getToken(reviewer),
    ).resolves.toBe("token-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/api/auth/login");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      username: "reviewer-1",
      password: "demo-password",
    });
  });

  it("reuses a token until shortly before it expires", async () => {
    let now = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(loginResponse("first", 60))
      .mockResolvedValueOnce(loginResponse("second", 60));
    const store = createStore(fetchMock, () => now);

    await store.getToken(reviewer);
    now = 20_000;
    await expect(store.getToken(reviewer)).resolves.toBe("first");

    // Within 30 s of expiry, a new token is fetched.
    now = 31_000;
    await expect(store.getToken(reviewer)).resolves.toBe("second");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one sign-in between concurrent requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      loginResponse("token-1"),
    );
    const store = createStore(fetchMock);

    const tokens = await Promise.all([
      store.getToken(reviewer),
      store.getToken(reviewer),
      store.getToken(reviewer),
    ]);

    expect(tokens).toEqual(["token-1", "token-1", "token-1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("signs in again after a token is forgotten", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(loginResponse("first"))
      .mockResolvedValueOnce(loginResponse("second"));
    const store = createStore(fetchMock);

    await store.getToken(reviewer);
    store.forget(reviewer.id);

    await expect(store.getToken(reviewer)).resolves.toBe("second");
  });

  it("keeps a separate token per identity", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
      loginResponse(
        `token-for-${JSON.parse(String(init?.body)).username}`,
      ),
    );
    const store = createStore(fetchMock);

    await expect(store.getToken(reviewer)).resolves.toBe(
      "token-for-reviewer-1",
    );
    await expect(
      store.getToken({ ...reviewer, id: "admin-1", role: "ADMIN" }),
    ).resolves.toBe("token-for-admin-1");
  });

  it("reports a refused sign-in with the API's response", async () => {
    const refused = Response.json(
      { error: "unauthenticated", message: "Wrong password." },
      { status: 401 },
    );
    const store = createStore(vi.fn<typeof fetch>(async () => refused));

    const error = await store.getToken(reviewer).catch((caught) => caught);

    expect(error).toBeInstanceOf(SignInError);
    expect((error as SignInError).response).toBe(refused);
  });

  it("makes mock tokens locally when mocks are on", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const store = new AccessTokenStore({
      useMockTokens: true,
      password: "unused",
      loginUrl: "unused",
      fetchImplementation: fetchMock,
    });

    const token = await store.getToken(reviewer);
    const request = new Request("http://localhost/api/notes", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(getMockActor(request)).toEqual(reviewer);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
