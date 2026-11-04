import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  useState,
} from "react";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const bulkApi = vi.hoisted(() => ({
  postAssignReviewer: vi.fn(),
  postRequestRegeneration: vi.fn(),
}));

vi.mock("../../api/bulkActions", () => bulkApi);

import type { Actor } from "../../../../domain/actor";
import type { NoteStatus } from "../../../../domain/noteAttributes";
import type { NoteSummary } from "../../../../domain/noteSummary";
import { useBulkActions } from "../useBulkActions";
import { useNoteSelection } from "../useNoteSelection";

const admin: Actor = {
  id: "admin-1",
  displayName: "Jordan Lee",
  role: "ADMIN",
};

function createNote(
  id: string,
  status: NoteStatus = "READY_FOR_REVIEW",
): NoteSummary {
  return {
    id,
    patient: {
      id: `patient-${id}`,
      displayName: `Patient ${id}`,
    },
    status,
    currentVersion: {
      id: `${id}-version-1`,
      revision: 1,
    },
    assignedReviewer: null,
    contentPreview: "",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };
}

describe("useNoteSelection", () => {
  const notes = [
    createNote("a"),
    createNote("b"),
  ];

  it("toggles rows and all loaded rows", () => {
    const { result } = renderHook(() =>
      useNoteSelection(notes, "key-1"),
    );

    act(() => result.current.toggle("a"));
    expect([
      ...result.current.selectedIds,
    ]).toEqual(["a"]);

    act(() =>
      result.current.toggleAllLoaded(),
    );
    expect(
      result.current.selectedIds.size,
    ).toBe(2);

    act(() =>
      result.current.toggleAllLoaded(),
    );
    expect(
      result.current.selectedIds.size,
    ).toBe(0);
  });

  it("reads as empty after the reset key changes", () => {
    const { result, rerender } =
      renderHook(
        ({ resetKey }) =>
          useNoteSelection(
            notes,
            resetKey,
          ),
        {
          initialProps: {
            resetKey: "user-1:filters",
          },
        },
      );

    act(() => result.current.toggle("a"));
    expect(
      result.current.selectedIds.size,
    ).toBe(1);

    rerender({
      resetKey: "user-2:filters",
    });

    expect(
      result.current.selectedIds.size,
    ).toBe(0);
    expect(
      result.current.selectedNotes,
    ).toEqual([]);
  });
});

describe("useBulkActions", () => {
  beforeEach(() => {
    bulkApi.postAssignReviewer.mockReset();
    bulkApi.postRequestRegeneration.mockReset();
  });

  function renderBulk(
    initialItems: NoteSummary[],
    selectedIds: string[],
  ) {
    return renderHook(() => {
      const [items, setItems] =
        useState(initialItems);

      const bulk = useBulkActions({
        actor: admin,
        items,
        setItems,
        selectedNotes: items.filter(
          item =>
            selectedIds.includes(item.id),
        ),
        resetKey: "key",
      });

      return { items, bulk };
    });
  }

  it("keeps the change only for notes the server updated", async () => {
    bulkApi.postAssignReviewer.mockResolvedValue({
      updated: ["a"],
    });

    const { result } = renderBulk(
      [createNote("a"), createNote("b")],
      ["a", "b"],
    );

    await act(() =>
      result.current.bulk.assignReviewer({
        id: "reviewer-1",
        displayName: "Alex Kim",
      }),
    );

    expect(
      result.current.items.map(
        item =>
          item.assignedReviewer?.id ?? null,
      ),
    ).toEqual(["reviewer-1", null]);
    expect(result.current.bulk.error).toBeNull();
  });

  it("rolls everything back and reports an error when the request fails", async () => {
    bulkApi.postAssignReviewer.mockRejectedValue(
      new Error("network"),
    );

    const { result } = renderBulk(
      [createNote("a")],
      ["a"],
    );

    await act(() =>
      result.current.bulk.assignReviewer({
        id: "reviewer-1",
        displayName: "Alex Kim",
      }),
    );

    await waitFor(() =>
      expect(
        result.current.bulk.error,
      ).toMatch(/rolled back/),
    );
    expect(
      result.current.items[0]
        ?.assignedReviewer,
    ).toBeNull();
  });

  it("only regenerates FAILED notes", async () => {
    bulkApi.postRequestRegeneration.mockResolvedValue({
      updated: ["failed-1"],
    });

    const { result } = renderBulk(
      [
        createNote("failed-1", "FAILED"),
        createNote("ready-1"),
      ],
      ["failed-1", "ready-1"],
    );

    expect(
      result.current.bulk.eligibleForRegeneration.map(
        note => note.id,
      ),
    ).toEqual(["failed-1"]);

    await act(() =>
      result.current.bulk.requestRegeneration(),
    );

    expect(
      bulkApi.postRequestRegeneration,
    ).toHaveBeenCalledWith(
      ["failed-1"],
      admin,
    );
    expect(
      result.current.items.map(
        item => item.status,
      ),
    ).toEqual([
      "GENERATING",
      "READY_FOR_REVIEW",
    ]);
  });
});
