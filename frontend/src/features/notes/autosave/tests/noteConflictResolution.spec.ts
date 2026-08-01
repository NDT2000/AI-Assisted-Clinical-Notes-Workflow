import { describe, expect, it, } from "vitest";

import type { SoapContent } from "../../../../domain/noteAttributes";

import { compareSoapConflict, resolveSoapConflict, } from "../noteConflictResolution";

const ancestor: SoapContent = {
  subjective: "Original subjective",
  objective: "Original objective",
  assessment: "Original assessment",
  plan: "Original plan",
};

describe("note conflict resolution", () => {
  it(
    "automatically keeps a local-only change",
    () => {
      const local: SoapContent = {
        ...ancestor,
        subjective:
          "Local subjective change",
      };

      const comparison =
        compareSoapConflict(
          ancestor,
          local,
          ancestor,
        );

      expect(
        comparison.subjective.status,
      ).toBe("local-only");

      expect(
        resolveSoapConflict(
          comparison,
          {},
        ),
      ).toEqual(local);
    },
  );

  it(
    "automatically keeps a server-only change",
    () => {
      const server: SoapContent = {
        ...ancestor,
        objective:
          "Server objective change",
      };

      const comparison =
        compareSoapConflict(
          ancestor,
          ancestor,
          server,
        );

      expect(
        comparison.objective.status,
      ).toBe("server-only");

      expect(
        resolveSoapConflict(
          comparison,
          {},
        ),
      ).toEqual(server);
    },
  );

  it(
    "automatically accepts the same change from both sides",
    () => {
      const changed: SoapContent = {
        ...ancestor,
        assessment:
          "Shared assessment change",
      };

      const comparison =
        compareSoapConflict(
          ancestor,
          changed,
          changed,
        );

      expect(
        comparison.assessment.status,
      ).toBe("same-change");

      expect(
        resolveSoapConflict(
          comparison,
          {},
        ),
      ).toEqual(changed);
    },
  );

  it(
    "requires a resolution when both sides changed differently",
    () => {
      const local: SoapContent = {
        ...ancestor,
        plan: "Local plan",
      };

      const server: SoapContent = {
        ...ancestor,
        plan: "Server plan",
      };

      const comparison =
        compareSoapConflict(
          ancestor,
          local,
          server,
        );

      expect(
        comparison.plan.status,
      ).toBe("conflict");

      expect(
        resolveSoapConflict(
          comparison,
          {},
        ),
      ).toBeNull();
    },
  );

  it(
    "resolves a conflicting section using the selected source",
    () => {
      const local: SoapContent = {
        ...ancestor,
        plan: "Local plan",
      };

      const server: SoapContent = {
        ...ancestor,
        plan: "Server plan",
      };

      const comparison =
        compareSoapConflict(
          ancestor,
          local,
          server,
        );

      expect(
        resolveSoapConflict(
          comparison,
          {
            plan: {
              source: "local",
            },
          },
        ),
      ).toEqual(local);

      expect(
        resolveSoapConflict(
          comparison,
          {
            plan: {
              source: "server",
            },
          },
        ),
      ).toEqual(server);
    },
  );

  it(
    "supports manually merged content",
    () => {
      const local: SoapContent = {
        ...ancestor,
        subjective:
          "Local symptoms",
      };

      const server: SoapContent = {
        ...ancestor,
        subjective:
          "Server symptoms",
      };

      const comparison =
        compareSoapConflict(
          ancestor,
          local,
          server,
        );

      const resolved =
        resolveSoapConflict(
          comparison,
          {
            subjective: {
              source: "manual",
              value:
                "Local and server symptoms",
            },
          },
        );

      expect(
        resolved?.subjective,
      ).toBe(
        "Local and server symptoms",
      );
    },
  );
});