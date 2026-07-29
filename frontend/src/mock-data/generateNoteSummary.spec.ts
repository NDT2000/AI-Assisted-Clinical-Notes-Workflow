import { describe, expect, it } from "vitest";

import { generateNoteSummaries } from "./generateNoteSummary";

describe("generateNoteSummaries", () => {
  it("generates the requested number of notes", () => {
    const notes = generateNoteSummaries(5_000, 42);

    expect(notes).toHaveLength(5_000);
  });

  it("generates identical data for the same seed", () => {
    const firstResult = generateNoteSummaries(20, 42);
    const secondResult = generateNoteSummaries(20, 42);

    expect(firstResult).toEqual(secondResult);
  });

  it("generates different data for different seeds", () => {
    const firstResult = generateNoteSummaries(20, 42);
    const secondResult = generateNoteSummaries(20, 99);

    expect(firstResult).not.toEqual(secondResult);
  });

  it("generates notes with the expected structure", () => {
    const notes = generateNoteSummaries(1, 42);
    const note = notes[0];

    expect(note).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        patient: expect.objectContaining({
          id: expect.any(String),
          displayName: expect.any(String),
        }),
        status: expect.any(String),
        currentVersion: expect.objectContaining({
          id: expect.any(String),
          revision: expect.any(Number),
        }),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
  });

  it("does not generate an updated date before the created date", () => {
    const notes = generateNoteSummaries(500, 42);

    for (const note of notes) {
      expect(
        new Date(note.updatedAt).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(note.createdAt).getTime(),
      );
    }
  });
});