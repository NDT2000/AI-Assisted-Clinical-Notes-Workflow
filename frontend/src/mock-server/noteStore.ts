import { generateNoteSummaries } from "../mock-data/generateNoteSummary";
import type { NoteSummary } from "../domain/noteSummary";
import type { UserRole } from "../domain/noteAttributes";
import { canRequestRegeneration } from "../domain/noteGuards";
import type { NoteDetail } from "../domain/noteDetail";
import { generateNoteDetail } from "../mock-data/generateNoteDetail";

const DEFAULT_SEED_COUNT = 5_000;
const DEFAULT_SEED_VALUE = 42;

let notes: NoteSummary[] = generateNoteSummaries(
  DEFAULT_SEED_COUNT,
  DEFAULT_SEED_VALUE,
);

const noteDetails = new Map<string, NoteDetail>();

export function getNotes(): NoteSummary[] {
  return notes;
}

export function getNoteSummary(
  noteId: string,
): NoteSummary | undefined {
  return notes.find((note) => note.id === noteId);
}

export function getNoteDetail(
  noteId: string,
): NoteDetail | undefined {
  const cachedDetail = noteDetails.get(noteId);

  if (cachedDetail) {
    return cachedDetail;
  }

  const summary = getNoteSummary(noteId);

  if (!summary) {
    return undefined;
  }

  const detail = generateNoteDetail(summary);

  noteDetails.set(noteId, detail);

  return detail;
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

    if (note.status === "LOCKED") {
      return note;
    }

    updatedIds.push(note.id);

    noteDetails.delete(note.id);

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

    noteDetails.delete(note.id);

    return { ...note, status: eligibility.nextStatus};
  });

  return updatedIds;
}

export function seedNotes(
  count: number,
  seed: number = DEFAULT_SEED_VALUE,
): number {
  notes = generateNoteSummaries(count, seed);
  noteDetails.clear();
  return notes.length;
}