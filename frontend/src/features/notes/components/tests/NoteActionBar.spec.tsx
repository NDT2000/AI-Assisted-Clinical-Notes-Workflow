import { cleanup, fireEvent, render, screen, } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AvailableNoteAction } from "../note-detail/noteActionBarModel";
import { NoteActionBar } from "../note-detail/NoteActionBar";

const actions: AvailableNoteAction[] = [
  {
    trigger: "RETURN_TO_QUEUE",
    label: "Return to Queue",
    enabled: true,
    requiresReason: false,
    executionState: "IDLE",
  },
  {
    trigger: "APPROVE",
    label: "Approve",
    enabled: false,
    requiresReason: false,
    executionState: "IDLE",
    disabledReason:
      "MFA re-authentication is required to approve this Note.",
  },
  {
    trigger: "REJECT",
    label: "Reject",
    enabled: false,
    requiresReason: true,
    executionState: "IDLE",
    disabledReason:
      "A rejection reason is required.",
  },
];

afterEach(() => {
  cleanup();
});

describe("NoteActionBar", () => {
  it("renders actions and explains why disabled actions are unavailable", () => {
    render(
      <NoteActionBar
        actions={actions}
        rejectionReason=""
        onRejectionReasonChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Return to Queue",
      }),
    ).toBeEnabled();

    expect(
      screen.getByRole("button", {
        name: "Approve",
      }),
    ).toBeDisabled();

    expect(
      screen.getByText(
        "MFA re-authentication is required to approve this Note.",
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", {
        name: "Reject",
      }),
    ).toBeDisabled();

    expect(
      screen.getByText(
        "A rejection reason is required.",
      ),
    ).toBeInTheDocument();
  });

  it("reports rejection-reason changes and selected actions", () => {
    const onRejectionReasonChange =
      vi.fn();

    const onAction = vi.fn();

    render(
      <NoteActionBar
        actions={actions}
        rejectionReason=""
        onRejectionReasonChange={
          onRejectionReasonChange
        }
        onAction={onAction}
      />,
    );

    fireEvent.change(
      screen.getByLabelText(
        "Rejection reason",
      ),
      {
        target: {
          value:
            "The assessment requires correction.",
        },
      },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Return to Queue",
      }),
    );

    expect(
      onRejectionReasonChange,
    ).toHaveBeenCalledWith(
      "The assessment requires correction.",
    );

    expect(onAction).toHaveBeenCalledWith(
      "RETURN_TO_QUEUE",
    );
  });
});