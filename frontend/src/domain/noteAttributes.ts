export type NoteStatus = 
    | "GENERATING"
    | "FAILED"
    | "READY_FOR_REVIEW"
    | "IN_REVIEW"
    | "REJECTED"
    | "APPROVED"
    | "AMENDED"
    | "LOCKED";

export type UserRole = 
    | "CLINICIAN"
    | "REVIEWER"
    | "ADMIN"
    | "READONLY_AUDITOR";

export type Trigger = 
    |"GENERATION_COMPLETE"
    | "GENERATION_ERROR"
    | "REGENERATE"
    | "START_REVIEW"
    | "RETURN_TO_QUEUE"
    | "APPROVE"
    | "REJECT"
    | "RESUBMIT"
    | "AMEND"
    | "GRACE_EXPIRED"
    | "START_REVIEW"

export interface SoapContent {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
}

export interface Note {
    id: string;
    patientId: string;
    sessionId: string;
    status: NoteStatus;
    currentVersionId: string;
    assignedReviewerId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface NoteVersion {
    versionId: string;
    noteId: string;
    revisionNumber: number;
    parentVersionId: string | null;
    content: SoapContent;
    authorId: string;
    authorRole: UserRole;
    createdAt: string;
}

export interface ReviewEvent {
    eventId: string;
    noteId: string;
    versionId: string | null;
    fromStatus: NoteStatus;
    toStatus: NoteStatus;
    actorId: string;
    actorRole: UserRole;
    reason?: string;
    occuredAt: string;
}