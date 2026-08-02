import { generateNoteSummaries } from "../mock-data/generateNoteSummary";
import type { NoteSummary } from "../domain/noteSummary";
import type { SoapContent, UserRole } from "../domain/noteAttributes";
import { canAssignReviewer, canEditNoteContent, canRequestRegeneration, canTransition } from "../domain/noteGuards";
import type { NoteDetail, NoteVersionDetail, ReviewTimelineEvent } from "../domain/noteDetail";
import { generateNoteDetail } from "../mock-data/generateNoteDetail";
import type { SaveNoteVersionActor, SaveNoteVersionRequestBody, SaveNoteVersionResponse, } from "../domain/noteSave";
import type { TransitionNoteActor, TransitionNoteRequestBody, TransitionNoteResponse, } from "../domain/noteTransition";
import { findCommonAncestor } from "../domain/versionGraph";

const DEFAULT_SEED_COUNT = 5_000;
const DEFAULT_SEED_VALUE = 42;

export type SaveNoteVersionStoreResult =
  | {
      outcome: "saved";
      response: SaveNoteVersionResponse;
    }
  | {
      outcome: "not-found";
    }
  | {
      outcome: "forbidden";
      reason: string;
    }
  | {
      outcome: "version-conflict";
      currentVersion: NoteVersionDetail;
      commonAncestor: NoteVersionDetail | null;
    }
  | {
      outcome: "idempotency-conflict";
    };

export type TransitionNoteStoreResult =
  | {
      outcome: "transitioned";
      response: TransitionNoteResponse;
    }
  | {
      outcome: "not-found";
    }
  | {
      outcome: "version-conflict";
      currentVersion: NoteVersionDetail;
    }
  | {
      outcome: "idempotency-conflict";
    }
  | {
      outcome: "transition-rejected";
      reason: string;
    };
  

const CONTENT_PREVIEW_MAX_LENGTH = 120;

let notes: NoteSummary[] = generateNoteSummaries(
  DEFAULT_SEED_COUNT,
  DEFAULT_SEED_VALUE,
);

const noteDetails = new Map<string, NoteDetail>();
const transitionMutations = new Map<
  string,
  TransitionMutationRecord
>();

interface SaveMutationRecord {
  actorId: string;
  actorRole: UserRole;
  request: SaveNoteVersionRequestBody;
  response: SaveNoteVersionResponse;
}

interface TransitionMutationRecord {
  requestSignature: string;
  response: TransitionNoteResponse;
}

const saveMutationRecords = new Map<
  string,
  SaveMutationRecord
>();

function createContentPreview(
  content: SoapContent,
): string {
  const firstNonEmptySection = [
    content.subjective,
    content.objective,
    content.assessment,
    content.plan,
  ]
    .map((section) => section.trim())
    .find((section) => section.length > 0);

  if (!firstNonEmptySection) {
    return "No note content available.";
  }

  if (
    firstNonEmptySection.length <=
    CONTENT_PREVIEW_MAX_LENGTH
  ) {
    return firstNonEmptySection;
  }

  return `${firstNonEmptySection.slice(
    0,
    CONTENT_PREVIEW_MAX_LENGTH - 3,
  )}...`;
}

function createNextVersionId(
  noteId: string,
  currentVersionId: string,
  nextRevision: number,
): string {
  const versionPrefix =
    currentVersionId.replace(/-\d+$/, "");

  if (versionPrefix === currentVersionId) {
    return `${noteId}-version-${nextRevision}`;
  }

  return `${versionPrefix}-${nextRevision}`;
}

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

function createSaveMutationKey(
  noteId: string,
  clientMutationId: string,
): string {
  return `${noteId}:${clientMutationId}`;
}

function hasSameSoapContent(
  first: SoapContent,
  second: SoapContent,
): boolean {
  return (
    first.subjective === second.subjective &&
    first.objective === second.objective &&
    first.assessment === second.assessment &&
    first.plan === second.plan
  );
}

function isSameLogicalSave(
  record: SaveMutationRecord,
  request: SaveNoteVersionRequestBody,
  actor: SaveNoteVersionActor,
): boolean {
  return (
    record.actorId === actor.id &&
    record.actorRole === actor.role &&
    record.request.baseVersionId ===
      request.baseVersionId &&
    record.request.clientMutationId ===
      request.clientMutationId &&
    hasSameSoapContent(
      record.request.content,
      request.content,
    )
  );
}

export function saveNoteVersion(
  noteId: string,
  request: SaveNoteVersionRequestBody,
  actor: SaveNoteVersionActor,
  savedAt: string = new Date().toISOString(),
): SaveNoteVersionStoreResult {
  const mutationKey = createSaveMutationKey(
    noteId,
    request.clientMutationId,
  );

  const previousMutation =
    saveMutationRecords.get(mutationKey);

  if (previousMutation) {
    if (
      !isSameLogicalSave(
        previousMutation,
        request,
        actor,
      )
    ) {
      return {
        outcome: "idempotency-conflict",
      };
    }

    return {
      outcome: "saved",
      response: previousMutation.response,
    };
  }
  const detail = getNoteDetail(noteId);

  if (!detail) {
    return {
      outcome: "not-found",
    };
  }

  const editPermission =
    canEditNoteContent(
      detail.note,
      actor,
    );

  if (!editPermission.allowed) {
    return {
      outcome: "forbidden",
      reason:
        editPermission.reason,
    };
  }

  if (
    request.baseVersionId !==
    detail.note.currentVersionId
  ) {
    const commonAncestor =
      findCommonAncestor(
        detail.versions,
        request.baseVersionId,
        detail.currentVersion.versionId,
      );

    return {
      outcome: "version-conflict",
      currentVersion: detail.currentVersion,
      commonAncestor,
    };
  }

  const nextRevision =
    detail.currentVersion.revisionNumber + 1;

  const savedVersion: NoteVersionDetail = {
    versionId: createNextVersionId(
      noteId,
      detail.currentVersion.versionId,
      nextRevision,
    ),
    noteId,
    revisionNumber: nextRevision,
    parentVersionId:
      detail.currentVersion.versionId,
    content: {
      ...request.content,
    },
    authorId: actor.id,
    authorRole: actor.role,
    authorDisplayName: actor.displayName,
    createdAt: savedAt,
  };

  const updatedNote = {
    ...detail.note,
    currentVersionId:
      savedVersion.versionId,
    updatedAt: savedAt,
  };

  const updatedDetail: NoteDetail = {
    ...detail,
    note: updatedNote,
    currentVersion: savedVersion,
    versions: [
      ...detail.versions,
      savedVersion,
    ],
  };

  noteDetails.set(noteId, updatedDetail);

  notes = notes.map((summary) => {
    if (summary.id !== noteId) {
      return summary;
    }

    return {
      ...summary,
      currentVersion: {
        id: savedVersion.versionId,
        revision:
          savedVersion.revisionNumber,
      },
      contentPreview:
        createContentPreview(
          savedVersion.content,
        ),
      updatedAt: savedAt,
    };
  });

  const response: SaveNoteVersionResponse = {
    clientMutationId:
      request.clientMutationId,
    note: updatedNote,
    savedVersion,
  };

  saveMutationRecords.set(mutationKey, {
    actorId: actor.id,
    actorRole: actor.role,
    request: {
      ...request,
      content: {
        ...request.content,
      },
    },
    response,
  });

  return {
    outcome: "saved",
    response,
  };
}

function getTransitionMutationKey(
  noteId: string,
  clientMutationId: string,
): string {
  return `${noteId}:${clientMutationId}`;
}

function getTransitionRequestSignature(
  request: TransitionNoteRequestBody,
  actor: TransitionNoteActor,
): string {
  return JSON.stringify({
    baseVersionId:
      request.baseVersionId,
    trigger: request.trigger,
    rejectionReason:
      request.rejectionReason ??
      null,
    actorId: actor.id,
    actorRole: actor.role,
  });
}

export function transitionNote(
  noteId: string,
  request: TransitionNoteRequestBody,
  actor: TransitionNoteActor,
  transitionedAt: string = new Date().toISOString(),
): TransitionNoteStoreResult {
  const mutationKey =
    getTransitionMutationKey(
      noteId,
      request.clientMutationId,
    );

  const requestSignature =
    getTransitionRequestSignature(
      request,
      actor,
    );

  const existingMutation =
    transitionMutations.get(mutationKey);

  if (existingMutation) {
    if (
      existingMutation.requestSignature !==
      requestSignature
    ) {
      return {
        outcome: "idempotency-conflict",
      };
    }

    return {
      outcome: "transitioned",
      response: existingMutation.response,
    };
  }

  const detail = getNoteDetail(noteId);

  if (!detail) {
    return {
      outcome: "not-found",
    };
  }

  if (
    request.baseVersionId !==
    detail.note.currentVersionId
  ) {
    return {
      outcome: "version-conflict",
      currentVersion: detail.currentVersion,
    };
  }

  const transitionResult = canTransition({
    note: detail.note,
    version: detail.currentVersion,
    actor,
    action: request.trigger,
    now: transitionedAt,
    ...(request.rejectionReason !== undefined
      ? {
          rejectionReason:
            request.rejectionReason,
        }
      : {}),
  });

  if (!transitionResult.allowed) {
    return {
      outcome: "transition-rejected",
      reason: transitionResult.reason,
    };
  }

  const shouldAssignReviewer =
    request.trigger ===
      "START_REVIEW";

  const shouldReleaseReviewer =
    request.trigger ===
      "RETURN_TO_QUEUE" ||
    request.trigger ===
      "RESUBMIT" ||
    request.trigger === "AMEND" ||
    request.trigger ===
      "REGENERATE";

  const nextAssignedReviewerId =
    shouldAssignReviewer
      ? actor.id
      : shouldReleaseReviewer
      ? null
      : detail.note
          .assignedReviewerId;

  const nextAssignedReviewer =
    shouldAssignReviewer
      ? {
          id: actor.id,
          displayName:
            actor.displayName,
          role: actor.role,
        }
      : shouldReleaseReviewer
      ? null
      : detail.assignedReviewer;

  const updatedNote = {
    ...detail.note,
    status:
      transitionResult.nextStatus,
    assignedReviewerId:
      nextAssignedReviewerId,
    updatedAt: transitionedAt,
    ...(transitionResult.nextStatus ===
    "APPROVED"
      ? {
          approvedAt:
            transitionedAt,
        }
      : {}),
  };
  const rejectionReason =
    request.trigger === "REJECT"
      ? request.rejectionReason?.trim()
      : undefined;

  const timelineEvent: ReviewTimelineEvent = {
    eventId:
      `${noteId}-transition-${request.clientMutationId}`,
    noteId,
    versionId:
      detail.currentVersion.versionId,
    fromStatus: detail.note.status,
    toStatus: transitionResult.nextStatus,
    actorId: actor.id,
    actorRole: actor.role,
    actorDisplayName: actor.displayName,
    occurredAt: transitionedAt,
    ...(rejectionReason
      ? {
          reason: rejectionReason,
        }
      : {}),
  };

  const updatedDetail: NoteDetail = {
    ...detail,
    note: updatedNote,
    assignedReviewer:
      nextAssignedReviewer,
    timeline: [
      ...detail.timeline,
      timelineEvent,
    ],
  };

  noteDetails.set(noteId, updatedDetail);

  notes = notes.map((summary) => {
    if (summary.id !== noteId) {
      return summary;
    }

    return {
      ...summary,
      status:
        transitionResult.nextStatus,
      assignedReviewer:
        nextAssignedReviewer ===
        null
          ? null
          : {
              id:
                nextAssignedReviewer.id,
              displayName:
                nextAssignedReviewer
                  .displayName,
            },
      updatedAt: transitionedAt,
    };
  });

  const response: TransitionNoteResponse = {
    clientMutationId:
      request.clientMutationId,
    note: updatedNote,
    timelineEvent,
    currentVersion:
      detail.currentVersion,
  };

  transitionMutations.set(mutationKey, {
    requestSignature,
    response,
  });

  return {
    outcome: "transitioned",
    response,
  };
}

export function reassignNotes(
  noteIds: string[],
  reviewer: { id: string; displayName: string } | null,
  actorRole: UserRole = "ADMIN",
): string[] {
  const noteIdSet = new Set(noteIds);
  const updatedIds: string[] = [];

  notes = notes.map((note) => {
    if (!noteIdSet.has(note.id)) {
      return note;
    }

    const permission =
      canAssignReviewer(
        note.status,
        actorRole,
      );

    if (!permission.allowed) {
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

    return {
      ...note,
      status:
        eligibility.nextStatus,
      assignedReviewer: null,
    };
  });

  return updatedIds;
}

export function seedNotes(
  count: number,
  seed: number = DEFAULT_SEED_VALUE,
): number {
  notes = generateNoteSummaries(count, seed);
  noteDetails.clear();
  transitionMutations.clear();
  saveMutationRecords.clear();
  return notes.length;
}