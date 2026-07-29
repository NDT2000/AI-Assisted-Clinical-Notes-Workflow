// The fixed Status of Notes saved in a Union type
export type NoteStatus = 
    | "GENERATING"
    | "FAILED"
    | "READY_FOR_REVIEW"
    | "IN_REVIEW"
    | "REJECTED"
    | "APPROVED"
    | "AMENDED"
    | "LOCKED";

export const NOTE_STATUS: readonly NoteStatus[] = [
    "GENERATING",
    "FAILED",
    "READY_FOR_REVIEW",
    "IN_REVIEW",
    "REJECTED",
    "APPROVED",
    "AMENDED",
    "LOCKED",
]

// Fixed set of User roles stored in Union type
export type UserRole = 
    | "CLINICIAN"
    | "REVIEWER"
    | "ADMIN"
    | "READONLY_AUDITOR";

// Fixed set of actions/triggers in a Union type
export type Trigger = 
    |"GENERATION_COMPLETE"
    | "GENERATION_ERROR"
    | "REGENERATE"
    | "RETURN_TO_QUEUE"
    | "APPROVE"
    | "REJECT"
    | "RESUBMIT"
    | "AMEND"
    | "GRACE_EXPIRED"
    | "START_REVIEW"

// This is the interface of SOAP which is the structure of each note    
export interface SoapContent {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
}

// Interface of Notes that has all the required attributes of Notes
export interface Note {
    id: string;
    patientId: string;
    sessionId: string;
    status: NoteStatus;
    currentVersionId: string;
    assignedReviewerId: string | null;
    createdAt: string;
    updatedAt: string;
    approvedAt?: string;
}

// Interface of Note Version that has all the attributes required by note version 
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

// Interface of Review event with all the attributes needed by review event listed
export interface ReviewEvent {
    eventId: string;
    noteId: string;
    versionId: string | null;
    fromStatus: NoteStatus;
    toStatus: NoteStatus;
    actorId: string;
    actorRole: UserRole;
    reason?: string;
    occurredAt: string;
}