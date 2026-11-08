import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { session } from "../auth/session";
import { MOCK_ACTORS } from "../mock-data/mockUsers";

// Tests run as a signed-in reviewer unless they sign in as someone else.
beforeEach(() => {
  session.signInForTests(MOCK_ACTORS.REVIEWER);
});

afterEach(() => {
  // Unmount first, so nothing on screen reacts to the session ending.
  cleanup();
  session.resetForTests();
});
