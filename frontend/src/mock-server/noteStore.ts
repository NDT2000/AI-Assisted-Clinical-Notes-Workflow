import { generateNoteSummaries } from "../mock-data/generateNoteSummary";
import type { NoteSummary } from "../domain/noteSummary";
import type { UserRole } from "../domain/noteAttributes";
import { canRequestRegeneration } from "../domain/noteGuards";

/*
 * The store is intentionally a plain in-memory array, not a "mock" in
 * the sense of canned/static data. seed() genuinely regenerates real
 * records; getNotesHandler filters/sorts/paginates against whatever is
 * currently in `notes`, exactly like a real database-backed handler
 * would query a real table.
 *
 * Resets on server restart — acceptable per the doc, since seeding is
 * deterministic and expected to run at the start of every session.
 */

const DEFAULT_SEED_COUNT = 5_000;
const DEFAULT_SEED_VALUE = 42;

let notes: NoteSummary[] = generateNoteSummaries(
  DEFAULT_SEED_COUNT,
  DEFAULT_SEED_VALUE,
);

export function getNotes(): NoteSummary[] {
  return notes;
}

export function reassignNotes(
  noteIds: string[],
  reviewer: { id: string; displayName: string } | null,
): string[] {
  const noteIdSet = new Set(noteIds);
  const updatedIds: string[] = [];

  notes = notes.map((note) => {
    if (!noteIdSet.has(note.id)) {
      return note;
    }

    // A LOCKED note is read-only by design; reassignment must not
    // silently succeed against it even in this simplified mock.
    if (note.status === "LOCKED") {
      return note;
    }

    updatedIds.push(note.id);

    return { ...note, assignedReviewer: reviewer };
  });

  return updatedIds;
}

export function regenerateNotes(
  noteIds: string[],
  actorRole: UserRole,
): string[] {
  const noteIdSet = new Set(noteIds);
  const updatedIds: string[] = [];

  notes = notes.map((note) => {
    if (!noteIdSet.has(note.id)) {
      return note;
    }

    const eligibility =
      canRequestRegeneration(
        note.status,
        actorRole,
      );

    if (!eligibility.allowed) {
      return note;
    }

    updatedIds.push(note.id);

    return { ...note, status: eligibility.nextStatus};
  });

  return updatedIds;
}

export function seedNotes(
  count: number,
  seed: number = DEFAULT_SEED_VALUE,
): number {
  notes = generateNoteSummaries(count, seed);
  return notes.length;
}