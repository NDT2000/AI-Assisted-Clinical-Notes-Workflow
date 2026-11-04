import workflowDefinition from "../../../contract/note-workflow.json";

import type {
  NoteStatus,
  Trigger,
  UserRole,
} from "./noteAttributes";

/*
 * The note workflow shared with the backend: contract/note-workflow.json.
 * Both sides implement these rules from the same file and are tested
 * against contract/note-workflow.cases.json.
 */

export interface WorkflowGuard {
  roles: readonly UserRole[];
  reviewer?: "assigned" | "unassignedOrAssigned";
  requireMfa?: boolean;
  requireRejectionReason?: boolean;
  requireCompleteContent?: boolean;
  withinHoursOfApproval?: number;
  messages: {
    role: string;
    reviewer?: string;
    mfa?: string;
    rejectionReason?: string;
    content?: string;
    approvalMissing?: string;
    approvalWindow?: string;
  };
}

export interface ContentEditingRule {
  statuses: readonly NoteStatus[];
  statusMessage: string;
  assignedReviewerOnly?: boolean;
  assignedReviewerMessage?: string;
}

export interface NoteWorkflow {
  statuses: readonly NoteStatus[];
  roles: readonly UserRole[];
  triggers: readonly Trigger[];
  lockedStatus: NoteStatus;
  messages: {
    locked: string;
    notAllowed: string;
  };
  transitions: Record<
    NoteStatus,
    Partial<Record<Trigger, NoteStatus>>
  >;
  guards: Partial<Record<Trigger, WorkflowGuard>>;
  contentEditing: {
    deniedRoles: Partial<Record<UserRole, string>>;
    lockedMessage: string;
    byRole: Partial<Record<UserRole, ContentEditingRule>>;
    defaultMessage: string;
  };
  reviewerAssignment: {
    roles: readonly UserRole[];
    roleMessage: string;
    statuses: readonly NoteStatus[];
    statusMessage: string;
  };
  regeneration: {
    trigger: Trigger;
    statusMessage: string;
  };
}

export const noteWorkflow =
  workflowDefinition as unknown as NoteWorkflow;

export function formatWorkflowMessage(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    /\{(\w+)\}/g,
    (placeholder, name: string) =>
      values[name] ?? placeholder,
  );
}
