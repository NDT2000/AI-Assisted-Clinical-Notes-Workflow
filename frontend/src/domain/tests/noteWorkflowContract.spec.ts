import {
  describe,
  expect,
  it,
} from "vitest";

import cases from "../../../../contract/note-workflow.cases.json";
import {
  buildCaseInput,
  type ApprovalCode,
  type Assignment,
  type CaseExtras,
  type ContentCode,
  type ReasonCode,
} from "../../../../contract/workflowCaseInputs";
import type {
  NoteStatus,
  Trigger,
  UserRole,
} from "../noteAttributes";
import {
  canAssignReviewer,
  canEditNoteContent,
  canRequestRegeneration,
  canTransition,
  type PermissionResult,
} from "../noteGuards";

/*
 * The frontend's rules must reproduce every decision recorded in
 * contract/note-workflow.cases.json; the backend runs the same cases.
 */

type Expected = string | number | true;

const DEFAULT_EXTRAS: CaseExtras = {
  mfa: true,
  reason: "given",
  content: "complete",
  approval: "1h",
};

function describeResult(
  result:
    | PermissionResult
    | { allowed: true; nextStatus: NoteStatus },
): Expected | string {
  if (!result.allowed) {
    const index = cases.messages.indexOf(result.reason);
    return index === -1 ? `unknown message: ${result.reason}` : index;
  }

  return "nextStatus" in result ? result.nextStatus : true;
}

function mismatches<Row extends unknown[]>(
  rows: Row[],
  evaluate: (row: Row) => Expected | string,
): string[] {
  return rows.flatMap(row => {
    const expected = row.at(-1) as Expected;
    const actual = evaluate(row);
    return actual === expected
      ? []
      : [`${JSON.stringify(row.slice(0, -1))}: expected ${expected}, got ${actual}`];
  });
}

describe("note workflow contract", () => {
  it(`matches all ${cases.transitions.length} transition decisions`, () => {
    const failures = mismatches(
      cases.transitions as [
        NoteStatus,
        Trigger,
        UserRole,
        Assignment,
        boolean,
        ReasonCode,
        ContentCode,
        ApprovalCode,
        Expected,
      ][],
      ([status, trigger, role, assignment, mfa, reason, content, approval]) => {
        const input = buildCaseInput(status, role, assignment, {
          mfa,
          reason,
          content,
          approval,
        });

        return describeResult(
          canTransition({
            note: input.note,
            version: input.version,
            actor: input.actor,
            action: trigger,
            now: cases.now,
            ...(input.rejectionReason === undefined
              ? {}
              : { rejectionReason: input.rejectionReason }),
          }),
        );
      },
    );

    expect(failures.slice(0, 20)).toEqual([]);
  });

  it("matches every content-editing decision", () => {
    const failures = mismatches(
      cases.editing as [NoteStatus, UserRole, Assignment, Expected][],
      ([status, role, assignment]) => {
        const input = buildCaseInput(status, role, assignment, DEFAULT_EXTRAS);
        return describeResult(canEditNoteContent(input.note, input.actor));
      },
    );

    expect(failures).toEqual([]);
  });

  it("matches every reviewer-assignment decision", () => {
    const failures = mismatches(
      cases.reviewerAssignment as [NoteStatus, UserRole, Expected][],
      ([status, role]) => describeResult(canAssignReviewer(status, role)),
    );

    expect(failures).toEqual([]);
  });

  it("matches every bulk-regeneration decision", () => {
    const failures = mismatches(
      cases.regeneration as [NoteStatus, UserRole, Expected][],
      ([status, role]) => describeResult(canRequestRegeneration(status, role)),
    );

    expect(failures).toEqual([]);
  });
});
