import type {
  SoapContent,
  Trigger,
} from "../../../domain/noteAttributes";
import { formatNoteStatus } from "../../../shared/formatters";
import { compareSoapConflict } from "../autosave/noteConflictResolution";
import type { NoteRealtimeEvent } from "./realtimeTypes";

/* A change someone made while this page was disconnected. */
export interface MissedChange {
  eventId: string;
  kind: "version" | "status";
  actorName: string;
  occurredAt: string;
  description: string;
}

const ACTION_WORDS: Partial<Record<Trigger, string>> = {
  START_REVIEW: "started reviewing the note",
  RETURN_TO_QUEUE: "returned the note to the queue",
  APPROVE: "approved the note",
  REJECT: "rejected the note",
  RESUBMIT: "resubmitted the note",
  AMEND: "started an amendment",
  REGENERATE: "sent the note back for regeneration",
};

export function describeMissedChange(
  event: NoteRealtimeEvent,
): MissedChange | null {
  if (event.type === "note.version_added") {
    return {
      eventId: event.eventId,
      kind: "version",
      actorName: event.response.savedVersion.authorDisplayName,
      occurredAt: event.occurredAt,
      description: "saved a new version",
    };
  }

  if (event.type === "note.status_changed") {
    const { timelineEvent } = event.response;
    return {
      eventId: event.eventId,
      kind: "status",
      actorName: timelineEvent.actorDisplayName,
      occurredAt: event.occurredAt,
      description:
        ACTION_WORDS[event.trigger] ??
        `changed the status to ${formatNoteStatus(timelineEvent.toStatus)}`,
    };
  }

  return null;
}

const SECTION_LABELS: Record<keyof SoapContent, string> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
};

/*
 * The sections both this user (offline) and someone else changed in
 * different ways, which the conflict resolver asks about. Sections only
 * one side changed are filled in automatically.
 */
export function overlappingSections(
  ancestor: SoapContent,
  local: SoapContent,
  server: SoapContent,
): string[] {
  const comparison = compareSoapConflict(ancestor, local, server);

  return (Object.keys(SECTION_LABELS) as (keyof SoapContent)[])
    .filter((section) => comparison[section].status === "conflict")
    .map((section) => SECTION_LABELS[section]);
}
