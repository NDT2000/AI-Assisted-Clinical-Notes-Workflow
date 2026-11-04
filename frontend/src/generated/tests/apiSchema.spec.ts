// @vitest-environment node
import { readFileSync } from "node:fs";

import openapiTS, {
  COMMENT_HEADER,
  astToString,
} from "openapi-typescript";
import {
  describe,
  expect,
  it,
} from "vitest";

const OPENAPI_DOCUMENT = new URL(
  "../../../../contract/openapi.json",
  import.meta.url,
);

const GENERATED_SCHEMA = new URL(
  "../api-schema.ts",
  import.meta.url,
);

describe("generated API types", () => {
  it("match contract/openapi.json", async () => {
    const expected =
      COMMENT_HEADER +
      astToString(await openapiTS(OPENAPI_DOCUMENT));

    const committed = readFileSync(GENERATED_SCHEMA, "utf8");

    // Run `npm run api:types` if this fails.
    expect(committed.replace(/\r\n/g, "\n")).toBe(expected);
  });
});
