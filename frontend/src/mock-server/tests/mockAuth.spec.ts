import { describe, expect, it } from "vitest";

import type { Actor } from "../../domain/actor";
import { createMockToken, getMockActor } from "../mockAuth";

function requestWith(authorization: string | null): Request {
  return new Request("http://localhost/api/notes", {
    headers:
      authorization === null ? {} : { authorization },
  });
}

describe("mock access tokens", () => {
  it("carry the actor to the handlers", () => {
    const actor: Actor = {
      id: "admin-1",
      displayName: "Jordan Lee — Ådmin",
      role: "ADMIN",
      mfaVerified: true,
    };

    expect(
      getMockActor(requestWith(`Bearer ${createMockToken(actor)}`)),
    ).toEqual(actor);
  });

  it.each([
    ["no header", null],
    ["another scheme", "Basic abc"],
    ["a real API token", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x"],
    ["garbage", "Bearer mock.%%%"],
    [
      "an unknown role",
      `Bearer ${createMockToken({
        id: "x",
        displayName: "X",
        role: "PATIENT",
      } as unknown as Actor)}`,
    ],
  ])("reject %s", (_label, authorization) => {
    expect(getMockActor(requestWith(authorization))).toBeNull();
  });
});
