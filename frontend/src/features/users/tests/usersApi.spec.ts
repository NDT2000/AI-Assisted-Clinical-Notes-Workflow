import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createUser,
  deactivateUser,
  listUsers,
  updateUser,
  UsersApiError,
} from "../api/usersApi";

describe("users API", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("sends only the filters that are set", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ users: [] })));

    await listUsers({ q: "  park ", role: "", active: "false" });
    await listUsers({ q: "", role: "", active: "" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/users?q=park&active=false");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/users");
  });

  it("sends JSON bodies with the access token", async () => {
    fetchMock.mockImplementation(async () => new Response("{}"));

    await createUser({ username: "dr.park", displayName: "Ada Park", role: "CLINICIAN" });
    await updateUser("user/1", { role: "REVIEWER" });
    await deactivateUser("user-2", true);

    const [create, update, deactivate] = fetchMock.mock.calls;
    const headers = new Headers(create?.[1]?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toMatch(/^Bearer mock\./);
    expect(update?.[0]).toBe("/api/users/user%2F1");
    expect(update?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(deactivate?.[1]?.body))).toEqual({
      confirmOpenReviews: true,
    });
  });

  it("turns refusals into errors with the API's code, message and details", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "has_open_reviews",
          message: "Confirm to deactivate anyway.",
          openReviewCount: 3,
        }),
        { status: 409 },
      ),
    );

    const error = await deactivateUser("reviewer-2").catch((caught) => caught);

    expect(error).toBeInstanceOf(UsersApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "has_open_reviews",
      message: "Confirm to deactivate anyway.",
      details: { openReviewCount: 3 },
    });
  });

  it("has a general message when the answer is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502 }));

    await expect(listUsers({ q: "", role: "", active: "" })).rejects.toMatchObject({
      status: 502,
      code: "request_failed",
      message: "The request failed. Try again.",
    });
  });
});
