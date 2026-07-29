import { generateNoteSummaries } from "../mock-data/generateNoteSummary";
import type { NoteSummary } from "../domain/noteSummary";

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

/*
 * Both mutation functions below return the set of ids ACTUALLY
 * changed, not just "success: true". This matters because a bulk
 * action can be partially valid — e.g. 2 of 3 selected notes are
 * FAILED and eligible for regeneration, 1 is APPROVED and isn't.
 * The caller (the handler) needs to distinguish "updated" from
 * "skipped as ineligible" so the frontend can show a partial-success
 * message rather than a flat success/fail.
 */

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
): string[] {
  const noteIdSet = new Set(noteIds);
  const updatedIds: string[] = [];

  notes = notes.map((note) => {
    if (!noteIdSet.has(note.id)) {
      return note;
    }

    /*
     * Mirrors the domain state machine's FAILED -> GENERATING
     * transition (noteTransitions.ts). This mock store doesn't run
     * the actual guard functions from noteGuards.ts — see the
     * frontend eligibility check for why that's a known, documented
     * gap rather than an oversight — but the STATUS condition here
     * must stay consistent with the real transition table, or the
     * mock backend and the real state machine would silently
     * disagree about what's allowed.
     */
    if (note.status !== "FAILED") {
      return note;
    }

    updatedIds.push(note.id);

    return { ...note, status: "GENERATING" as const };
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