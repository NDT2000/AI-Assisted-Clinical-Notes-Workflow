// Records what the frontend's workflow rules decide for every combination
// of status, action, role and reviewer ownership, with each extra condition
// (MFA, rejection reason, SOAP content, time since approval) also varied.
// Both the frontend and the backend test their rules against the output,
// note-workflow.cases.json, so the two can never disagree.
//
// Regenerate after an intended rule change, from the repository root:
//
//   npx --prefix frontend vite-node contract/export-workflow-cases.ts
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Note,
  NoteStatus,
  Trigger,
  UserRole,
} from "../frontend/src/domain/noteAttributes";
import {
  canAssignReviewer,
  canEditNoteContent,
  canRequestRegeneration,
  canTransition,
  type GuardActor,
} from "../frontend/src/domain/noteGuards";
import {
  ASSIGNMENTS,
  APPROVALS,
  CONTENTS,
  REASONS,
  ROLES,
  STATUSES,
  TRIGGERS,
  WORKFLOW_CASE_NOW,
  buildCaseInput,
  type CaseExtras,
} from "./workflowCaseInputs";

const messages: string[] = [];

function encode(
  result:
    | { allowed: true; nextStatus?: NoteStatus }
    | { allowed: false; reason: string },
): string | number | true {
  if (result.allowed) {
    return result.nextStatus ?? true;
  }

  let index = messages.indexOf(result.reason);
  if (index === -1) {
    index = messages.push(result.reason) - 1;
  }
  return index;
}

const DEFAULT_EXTRAS: CaseExtras = {
  mfa: true,
  reason: "given",
  content: "complete",
  approval: "1h",
};

const EXTRA_VARIANTS: CaseExtras[] = [
  DEFAULT_EXTRAS,
  { ...DEFAULT_EXTRAS, mfa: false },
  ...REASONS.filter(reason => reason !== "given").map(reason => ({
    ...DEFAULT_EXTRAS,
    reason,
  })),
  ...CONTENTS.filter(content => content !== "complete").map(content => ({
    ...DEFAULT_EXTRAS,
    content,
  })),
  ...APPROVALS.filter(approval => approval !== "1h").map(approval => ({
    ...DEFAULT_EXTRAS,
    approval,
  })),
];

const transitions: unknown[] = [];
for (const status of STATUSES) {
  for (const trigger of TRIGGERS) {
    for (const role of ROLES) {
      for (const assignment of ASSIGNMENTS) {
        for (const extras of EXTRA_VARIANTS) {
          const input = buildCaseInput(status, role, assignment, extras);
          transitions.push([
            status,
            trigger,
            role,
            assignment,
            extras.mfa,
            extras.reason,
            extras.content,
            extras.approval,
            encode(
              canTransition({
                note: input.note,
                version: input.version,
                actor: input.actor,
                action: trigger as Trigger,
                now: WORKFLOW_CASE_NOW,
                ...(input.rejectionReason === undefined
                  ? {}
                  : { rejectionReason: input.rejectionReason }),
              }),
            ),
          ]);
        }
      }
    }
  }
}

const editing: unknown[] = [];
const assignment: unknown[] = [];
const regeneration: unknown[] = [];
for (const status of STATUSES) {
  for (const role of ROLES) {
    for (const reviewer of ASSIGNMENTS) {
      const input = buildCaseInput(status, role, reviewer, DEFAULT_EXTRAS);
      editing.push([
        status,
        role,
        reviewer,
        encode(canEditNoteContent(input.note as Note, input.actor as GuardActor)),
      ]);
    }
    assignment.push([
      status,
      role,
      encode(canAssignReviewer(status, role as UserRole)),
    ]);
    regeneration.push([
      status,
      role,
      encode(canRequestRegeneration(status, role as UserRole)),
    ]);
  }
}

const output = join(
  dirname(fileURLToPath(import.meta.url)),
  "note-workflow.cases.json",
);

const lines = (rows: unknown[]) =>
  rows.map(row => `    ${JSON.stringify(row)}`).join(",\n");

// One case per line keeps diffs readable when a rule changes.
writeFileSync(
  output,
  [
    "{",
    `  "now": ${JSON.stringify(WORKFLOW_CASE_NOW)},`,
    `  "messages": ${JSON.stringify(messages, null, 4).replace(/\n/g, "\n  ")},`,
    `  "transitionColumns": ["status", "trigger", "role", "assignment", "mfa", "reason", "content", "approval", "result"],`,
    `  "transitions": [\n${lines(transitions)}\n  ],`,
    `  "editing": [\n${lines(editing)}\n  ],`,
    `  "reviewerAssignment": [\n${lines(assignment)}\n  ],`,
    `  "regeneration": [\n${lines(regeneration)}\n  ]`,
    "}",
    "",
  ].join("\n"),
);

console.log(
  `Wrote ${transitions.length} transition, ${editing.length} editing, ` +
    `${assignment.length} assignment and ${regeneration.length} regeneration ` +
    `cases with ${messages.length} messages to ${output}`,
);

