import type { Note, Trigger, NoteStatus, UserRole } from "./noteAttributes";

export interface Actor{
    id: string;
    role: UserRole;
}

export interface Guard {
    note: Note;
    actor: Actor;
    action: Trigger;
    reason?: string;
    now: string;
}

export type GuardResult =
    | {
        allowed: true;
        nextStatus: NoteStatus;
    }
    | {
        allowed: false;
        reason: string;
    };

export type GuardFunction = (
    context: Guard
) => GuardResult;