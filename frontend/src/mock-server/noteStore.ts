import { generateNoteSummaries } from "../mock-data/generateNoteSummary";
import type { NoteSummary } from "../domain/noteSummary";

const DEFAULT_SEED_COUNT = 5_000;
const DEFAULT_SEED_VALUE = 42;

let notes: NoteSummary[] = generateNoteSummaries(
  DEFAULT_SEED_COUNT,
  DEFAULT_SEED_VALUE,
);

export function getNotes(): NoteSummary[] {
  return notes;
}

export function seedNotes(
  count: number,
  seed: number = DEFAULT_SEED_VALUE,
): number {
  notes = generateNoteSummaries(count, seed);
  return notes.length;
}