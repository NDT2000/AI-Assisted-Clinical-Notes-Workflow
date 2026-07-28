import type { Trigger, NoteStatus } from "./noteAttributes";

export const noteTransitions: Record<NoteStatus, Partial<Record<Trigger, NoteStatus>>
    > = {
        GENERATING: {
            GENERATION_COMPLETE: "READY_FOR_REVIEW",
            GENERATION_ERROR: "FAILED"
        },
        FAILED: {
            REGENERATE: "GENERATING"
        },
        READY_FOR_REVIEW: {
            START_REVIEW: "IN_REVIEW"
        },
        IN_REVIEW: {
            RETURN_TO_QUEUE: "READY_FOR_REVIEW",
            APPROVE: "APPROVED",
            REJECT: "REJECTED"
        },
        REJECTED: {
            RESUBMIT: "READY_FOR_REVIEW"
        },
        APPROVED: {
            AMEND: "AMENDED",
            GRACE_EXPIRED: "LOCKED"
        },
        AMENDED: {
            START_REVIEW: "IN_REVIEW"
        },
        LOCKED: {},
    };