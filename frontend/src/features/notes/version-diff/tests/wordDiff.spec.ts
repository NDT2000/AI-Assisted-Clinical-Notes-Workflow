import { describe, expect, it, } from "vitest";

import type { SoapContent } from "../../../../domain/noteAttributes";
import { compareSoapVersions, diffWords, } from "../wordDiff";

describe("diffWords", () => {
  it(
    "returns unchanged content when both values match",
    () => {
      expect(
        diffWords(
          "Follow up in 7 days.",
          "Follow up in 7 days.",
        ),
      ).toEqual([
        {
          type: "unchanged",
          value:
            "Follow up in 7 days.",
        },
      ]);
    },
  );

  it(
    "marks inserted words as added",
    () => {
      expect(
        diffWords(
          "Follow up tomorrow.",
          "Follow up early tomorrow.",
        ),
      ).toEqual([
        {
          type: "unchanged",
          value: "Follow up ",
        },
        {
          type: "added",
          value: "early ",
        },
        {
          type: "unchanged",
          value: "tomorrow.",
        },
      ]);
    },
  );

  it(
    "marks deleted words as removed",
    () => {
      expect(
        diffWords(
          "Continue the current treatment.",
          "Continue treatment.",
        ),
      ).toEqual([
        {
          type: "unchanged",
          value: "Continue ",
        },
        {
          type: "removed",
          value: "the current ",
        },
        {
          type: "unchanged",
          value: "treatment.",
        },
      ]);
    },
  );

  it(
    "represents replacement as removed and added content",
    () => {
      const result = diffWords(
        "Review in 7 days.",
        "Review in 14 days.",
      );

      expect(result).toEqual([
        {
          type: "unchanged",
          value: "Review in ",
        },
        {
          type: "removed",
          value: "7",
        },
        {
          type: "added",
          value: "14",
        },
        {
          type: "unchanged",
          value: " days.",
        },
      ]);
    },
  );

  it(
    "handles empty previous content",
    () => {
      expect(
        diffWords(
          "",
          "New clinical information.",
        ),
      ).toEqual([
        {
          type: "added",
          value:
            "New clinical information.",
        },
      ]);
    },
  );

  it(
    "handles empty next content",
    () => {
      expect(
        diffWords(
          "Removed clinical information.",
          "",
        ),
      ).toEqual([
        {
          type: "removed",
          value:
            "Removed clinical information.",
        },
      ]);
    },
  );
});

describe(
  "compareSoapVersions",
  () => {
    it(
      "compares every SOAP section",
      () => {
        const previousContent:
          SoapContent = {
          subjective:
            "Patient reports pain.",
          objective:
            "Temperature normal.",
          assessment:
            "Condition stable.",
          plan:
            "Review in 7 days.",
        };

        const nextContent:
          SoapContent = {
          ...previousContent,

          assessment:
            "Condition improving.",

          plan:
            "Review in 14 days.",
        };

        const result =
          compareSoapVersions(
            previousContent,
            nextContent,
          );

        expect(
          result.subjective,
        ).toEqual([
          {
            type: "unchanged",
            value:
              "Patient reports pain.",
          },
        ]);

        expect(
          result.objective,
        ).toEqual([
          {
            type: "unchanged",
            value:
              "Temperature normal.",
          },
        ]);

        expect(
          result.assessment.some(
            (segment) =>
              segment.type === "removed",
          ),
        ).toBe(true);

        expect(
          result.assessment.some(
            (segment) =>
              segment.type === "added",
          ),
        ).toBe(true);

        expect(
          result.plan,
        ).toContainEqual({
          type: "removed",
          value: "7",
        });

        expect(
          result.plan,
        ).toContainEqual({
          type: "added",
          value: "14",
        });
      },
    );
  },
);