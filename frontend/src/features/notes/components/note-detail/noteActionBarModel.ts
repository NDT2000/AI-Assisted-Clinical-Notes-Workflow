import type { Trigger } from "../../../../domain/noteAttributes";
import type { Actor, Guard, } from "../../../../domain/noteGuards";
import { canTransition } from "../../../../domain/noteGuards";
import { noteTransitions } from "../../../../domain/noteTransitions";

interface ActionDefinition {
  label: string;
  requiresReason: boolean;
}

const ACTION_DEFINITIONS = {
  REGENERATE: {
    label: "Regenerate",
    requiresReason: false,
  },
  START_REVIEW: {
    label: "Start Review",
    requiresReason: false,
  },
  RETURN_TO_QUEUE: {
    label: "Return to Queue",
    requiresReason: false,
  },
  APPROVE: {
    label: "Approve",
    requiresReason: false,
  },
  REJECT: {
    label: "Reject",
    requiresReason: true,
  },
  RESUBMIT: {
    label: "Resubmit",
    requiresReason: false,
  },
  AMEND: {
    label: "Amend",
    requiresReason: false,
  },
} satisfies Partial<Record<Trigger, ActionDefinition>>;

export type UserActionTrigger =
  keyof typeof ACTION_DEFINITIONS;

export type ActionExecutionState =
  | "IDLE"
  | "PENDING"
  | "OPTIMISTICALLY_APPLIED"
  | "SUCCEEDED"
  | "FAILED_AND_ROLLED_BACK";

export interface AvailableNoteAction {
  trigger: UserActionTrigger;
  label: string;
  enabled: boolean;
  requiresReason: boolean;
  executionState: ActionExecutionState;
  disabledReason?: string;
}

export interface DeriveAvailableNoteActionsInput {
  note: Guard["note"];
  version: Guard["version"];
  actor: Actor;
  now: string;
  rejectionReason?: string;
  workspaceBlockReason?: string;
  executionStates?: Partial<
    Record<UserActionTrigger, ActionExecutionState>
  >;
}

function isUserActionTrigger(
  trigger: Trigger,
): trigger is UserActionTrigger {
  return Object.prototype.hasOwnProperty.call(
    ACTION_DEFINITIONS,
    trigger,
  );
}

export function deriveAvailableNoteActions({
  note,
  version,
  actor,
  now,
  rejectionReason,
  workspaceBlockReason,
  executionStates = {},
}: DeriveAvailableNoteActionsInput): AvailableNoteAction[] {
  const structuralTriggers = Object.keys(
    noteTransitions[note.status],
  ) as Trigger[];

  return structuralTriggers
    .filter(isUserActionTrigger)
    .map((trigger) => {
      const definition = ACTION_DEFINITIONS[trigger];

      const context: Guard = {
        note,
        version,
        actor,
        action: trigger,
        now,
        ...(rejectionReason !== undefined
          ? { rejectionReason }
          : {}),
      };

      const result = canTransition(context);

      const disabledReason =
        workspaceBlockReason ??
        (result.allowed ? undefined : result.reason);

      const action: AvailableNoteAction = {
        trigger,
        label: definition.label,
        enabled:
          result.allowed &&
          workspaceBlockReason === undefined,
        requiresReason: definition.requiresReason,
        executionState:
          executionStates[trigger] ?? "IDLE",
      };

      return disabledReason
        ? {
            ...action,
            disabledReason,
          }
        : action;
    });
}