import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SoapContent } from "../../../../domain/noteAttributes";
import type { NoteDetail } from "../../../../domain/noteDetail";
import {
  describeMissedChange,
  overlappingSections,
  type MissedChange,
} from "../../realtime/missedChanges";
import type { NoteRealtimeEvent } from "../../realtime/realtimeTypes";
import { useNoteDetailRealtime } from "../../realtime/useNoteDetailRealtime";
import {
  useRealtimeSubscription,
  type UseRealtimeSubscriptionOptions,
} from "../../realtime/useRealtimeSubscription";
import { WhileAwayPanel } from "../note-detail/WhileAwayPanel";

vi.mock("../../realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));

const CHANGES: MissedChange[] = [
  {
    eventId: "event-1",
    kind: "version",
    actorName: "Alex Kim",
    occurredAt: "2026-11-09T14:02:00.000Z",
    description: "saved a new version",
  },
  {
    eventId: "event-2",
    kind: "status",
    actorName: "Alex Kim",
    occurredAt: "2026-11-09T14:05:00.000Z",
    description: "approved the note",
  },
];

function renderPanel(
  props: Partial<Parameters<typeof WhileAwayPanel>[0]> = {},
) {
  const handlers = { onResolve: vi.fn(), onDismiss: vi.fn() };
  render(
    <WhileAwayPanel
      changes={CHANGES}
      conflict={null}
      refusedReason={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("WhileAwayPanel", () => {
  it("lists who changed what while the page was away", () => {
    renderPanel();

    expect(
      screen.getByRole("heading", { name: "2 changes while you were away" }),
    ).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Alex Kim saved a new version");
    expect(items[1]).toHaveTextContent("Alex Kim approved the note");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resolve" }),
    ).not.toBeInTheDocument();
  });

  it("shows nothing when nothing was missed", () => {
    const { container } = render(
      <WhileAwayPanel
        changes={[]}
        conflict={null}
        refusedReason={null}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("flags a saved version that overlaps offline edits", async () => {
    const user = userEvent.setup({ delay: null });
    const { onResolve, onDismiss } = renderPanel({
      conflict: { overlappingSections: ["Assessment", "Plan"] },
    });

    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      "overlaps your offline edit to Assessment, Plan — choose what to keep",
    );

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("says when offline edits do not overlap", () => {
    renderPanel({ conflict: { overlappingSections: [] } });

    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      "doesn't overlap your offline edits — confirm the merge",
    );
  });

  it("explains why offline edits cannot be saved", () => {
    renderPanel({ refusedReason: "Approved notes can only be amended." });

    expect(
      screen.getByText(
        "Your offline edits can't be saved: Approved notes can only be amended.",
      ),
    ).toBeInTheDocument();
  });
});

describe("describing missed changes", () => {
  const base = {
    cursor: 1,
    noteId: "note-1",
    occurredAt: "2026-11-09T14:02:00.000Z",
  };

  it.each([
    ["APPROVE", "approved the note"],
    ["START_REVIEW", "started reviewing the note"],
    ["REGENERATE", "sent the note back for regeneration"],
    ["GRACE_EXPIRED", "changed the status to"],
  ] as const)("%s", (trigger, words) => {
    const change = describeMissedChange({
      ...base,
      type: "note.status_changed",
      eventId: "status",
      trigger,
      response: {
        timelineEvent: { actorDisplayName: "Sam Rivera", toStatus: "LOCKED" },
      },
    } as unknown as NoteRealtimeEvent);

    expect(change?.actorName).toBe("Sam Rivera");
    expect(change?.description).toContain(words);
  });

  it("names the author of a saved version", () => {
    const change = describeMissedChange({
      ...base,
      type: "note.version_added",
      eventId: "version",
      response: { savedVersion: { authorDisplayName: "Alex Kim" } },
    } as unknown as NoteRealtimeEvent);

    expect(change).toMatchObject({
      kind: "version",
      actorName: "Alex Kim",
      description: "saved a new version",
    });
  });

  it("ignores presence", () => {
    expect(
      describeMissedChange({
        ...base,
        type: "note.presence_changed",
        eventId: "presence",
        presence: [],
      }),
    ).toBeNull();
  });
});

describe("overlappingSections", () => {
  const ancestor: SoapContent = {
    subjective: "S",
    objective: "O",
    assessment: "A",
    plan: "P",
  };

  it("lists sections both sides changed differently", () => {
    expect(
      overlappingSections(
        ancestor,
        { ...ancestor, plan: "Mine", subjective: "Only mine" },
        { ...ancestor, plan: "Theirs", objective: "Only theirs" },
      ),
    ).toEqual(["Plan"]);
  });

  it("is empty when the edits do not meet", () => {
    expect(
      overlappingSections(
        ancestor,
        { ...ancestor, subjective: "Mine" },
        { ...ancestor, plan: "Theirs" },
      ),
    ).toEqual([]);
  });
});

describe("useNoteDetailRealtime and missed changes", () => {
  function setup() {
    const onMissed = vi.fn();
    const onReloadRequired = vi.fn();
    const applyEvent = vi.fn();
    renderHook(() =>
      useNoteDetailRealtime({
        noteId: "note-1",
        getDetail: () => ({ timeline: [] }) as unknown as NoteDetail,
        applyEvent,
        autosaveStatus: "idle",
        hasDirtySections: false,
        adoptServerVersion: () => false,
        onServerContentAdopted: vi.fn(),
        onNotice: vi.fn(),
        onMissed,
        onReloadRequired,
      }),
    );
    const options = vi.mocked(useRealtimeSubscription).mock.calls.at(-1)?.[0] as
      UseRealtimeSubscriptionOptions;
    return { options, onMissed, onReloadRequired, applyEvent };
  }

  const presence: NoteRealtimeEvent = {
    type: "note.presence_changed",
    eventId: "presence",
    cursor: 0,
    noteId: "note-1",
    occurredAt: "2026-11-09T14:02:00.000Z",
    presence: [],
  };

  it("reports events that arrived while catching up", () => {
    const { options, onMissed, applyEvent } = setup();
    const missed = {
      ...presence,
      type: "note.status_changed",
      trigger: "APPROVE",
      response: {
        timelineEvent: { fromStatus: "IN_REVIEW", toStatus: "APPROVED" },
      },
    } as unknown as NoteRealtimeEvent;

    options.onEvent(presence, { missed: true });
    options.onEvent(presence, { missed: false });

    expect(onMissed).not.toHaveBeenCalled(); // presence is never "missed"

    options.onEvent(missed, { missed: true });
    options.onEvent(missed, { missed: false });

    expect(onMissed.mock.calls).toEqual([[missed]]);
    // Missed or live, every event is still applied.
    expect(applyEvent).toHaveBeenCalledTimes(4);
  });

  it("asks for a reload when the server says too much changed", () => {
    const { options, onReloadRequired } = setup();

    options.onReset?.(["note-1"]);

    expect(onReloadRequired).toHaveBeenCalledTimes(1);
  });
});
