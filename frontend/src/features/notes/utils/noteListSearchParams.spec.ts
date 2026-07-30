import { describe, expect, it, } from "vitest";

import { DEFAULT_NOTE_LIST_FILTERS, parseNoteListSearchParams, } from "./noteListSearchParams";

function parse(
  queryString: string,
) {
  return parseNoteListSearchParams(
    new URLSearchParams(queryString),
  );
}

describe(
  "parseNoteListSearchParams",
  () => {
    it(
      "returns default filters when the URL has no parameters",
      () => {
        expect(parse("")).toEqual(
          DEFAULT_NOTE_LIST_FILTERS,
        );
      },
    );

    it(
      "parses valid filters, search and sorting",
      () => {
        const result = parse(
          [
            "status=READY_FOR_REVIEW,IN_REVIEW",
            "reviewer=reviewer-1",
            "patient=patient-12",
            "createdFrom=2026-01-01",
            "createdTo=2026-06-30",
            "sort=createdAt:asc",
            "q=Ril",
          ].join("&"),
        );

        expect(result).toEqual({
          statuses: [
            "READY_FOR_REVIEW",
            "IN_REVIEW",
          ],
          reviewerId: "reviewer-1",
          patientId: "patient-12",
          createdFrom: "2026-01-01",
          createdTo: "2026-06-30",
          sortField: "createdAt",
          sortDirection: "asc",
          query: "Ril",
        });
      },
    );

    it(
      "ignores invalid statuses and removes duplicates",
      () => {
        const result = parse(
          "status=FAILED,NOT_A_STATUS,FAILED",
        );

        expect(result.statuses).toEqual([
          "FAILED",
        ]);
      },
    );

    it(
      "falls back when the reviewer ID is invalid",
      () => {
        const result = parse(
          "reviewer=invalid-reviewer",
        );

        expect(result.reviewerId).toBe(
          "",
        );
      },
    );

    it(
      "rejects invalid calendar dates",
      () => {
        const result = parse(
          [
            "createdFrom=2026-02-31",
            "createdTo=not-a-date",
          ].join("&"),
        );

        expect(result.createdFrom).toBe(
          "",
        );

        expect(result.createdTo).toBe(
          "",
        );
      },
    );

    it(
      "clears both dates when the date range is reversed",
      () => {
        const result = parse(
          [
            "createdFrom=2026-08-01",
            "createdTo=2026-01-01",
          ].join("&"),
        );

        expect(result.createdFrom).toBe(
          "",
        );

        expect(result.createdTo).toBe(
          "",
        );
      },
    );

    it(
      "falls back to the complete default sort when either sort part is invalid",
      () => {
        const invalidDirection = parse(
          "sort=createdAt:sideways",
        );

        expect(
          invalidDirection.sortField,
        ).toBe("updatedAt");

        expect(
          invalidDirection.sortDirection,
        ).toBe("desc");

        const invalidField = parse(
          "sort=randomField:asc",
        );

        expect(
          invalidField.sortField,
        ).toBe("updatedAt");

        expect(
          invalidField.sortDirection,
        ).toBe("desc");
      },
    );

    it(
      "ignores a patient filter when no parent filter is active",
      () => {
        const result = parse(
          "patient=patient-12",
        );

        expect(result.patientId).toBe(
          "",
        );
      },
    );

    it(
      "keeps a valid patient ID when a parent filter is active",
      () => {
        const result = parse(
          [
            "status=FAILED",
            "patient=patient-12",
          ].join("&"),
        );

        expect(result.patientId).toBe(
          "patient-12",
        );
      },
    );

    it(
      "rejects malformed patient IDs",
      () => {
        const result = parse(
          [
            "status=FAILED",
            "patient=random-patient",
          ].join("&"),
        );

        expect(result.patientId).toBe(
          "",
        );
      },
    );

    it(
      "trims the search query",
      () => {
        const result = parse(
          "q=%20%20clinical%20note%20%20",
        );

        expect(result.query).toBe(
          "clinical note",
        );
      },
    );
  },
);