import { act, cleanup, fireEvent, render, screen, } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, } from "vitest";

import { DEFAULT_NOTE_LIST_FILTERS, type NoteListFilters, } from "../utils/noteListSearchParams";
import { NotesFilters } from "./NotesFilters";

function renderNotesFilters(
  filterOverrides: Partial<NoteListFilters> = {},
) {
  const filters: NoteListFilters = {
    ...DEFAULT_NOTE_LIST_FILTERS,
    ...filterOverrides,
  };

  const onStatusesChange = vi.fn();
  const onReviewerChange = vi.fn();
  const onPatientChange = vi.fn();
  const onCreatedFromChange = vi.fn();
  const onCreatedToChange = vi.fn();
  const onSortFieldChange = vi.fn();
  const onSortDirectionChange = vi.fn();
  const onQueryChange = vi.fn();

  const renderResult = render(
    <NotesFilters 
      filters={filters}
      onStatusesChange={onStatusesChange}
      onReviewerChange={onReviewerChange}
      onPatientChange={onPatientChange}
      onCreatedFromChange={
        onCreatedFromChange
      }
      onCreatedToChange={onCreatedToChange}
      onSortFieldChange={
        onSortFieldChange
      }
      onSortDirectionChange={
        onSortDirectionChange
      }
      onQueryChange={onQueryChange}
    />,
  );

  return {
    ...renderResult,
    filters,
    onQueryChange,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("NotesFilters search", () => {
  it(
    "waits for the debounce period before updating the query",
    () => {
      vi.useFakeTimers();

      const { onQueryChange } =
        renderNotesFilters();

      const searchInput =
        screen.getByRole("searchbox");

      fireEvent.change(searchInput, {
        target: {
          value: "R",
        },
      });

      fireEvent.change(searchInput, {
        target: {
          value: "Ri",
        },
      });

      fireEvent.change(searchInput, {
        target: {
          value: "Ril",
        },
      });

      /*
       * Typing remains visible immediately.
       */
      expect(searchInput).toHaveValue(
        "Ril",
      );

      /*
       * No parent update or request-triggering URL change
       * should happen while the user is still typing.
       */
      expect(
        onQueryChange,
      ).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(399);
      });

      expect(
        onQueryChange,
      ).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(
        onQueryChange,
      ).toHaveBeenCalledTimes(1);

      expect(
        onQueryChange,
      ).toHaveBeenCalledWith("Ril");
    },
  );

  it(
    "restarts the debounce timer after every keystroke",
    () => {
      vi.useFakeTimers();

      const { onQueryChange } =
        renderNotesFilters();

      const searchInput =
        screen.getByRole("searchbox");

      fireEvent.change(searchInput, {
        target: {
          value: "clinical",
        },
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      fireEvent.change(searchInput, {
        target: {
          value: "clinical note",
        },
      });

      /*
       * The first timer should have been cancelled.
       */
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(
        onQueryChange,
      ).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(
        onQueryChange,
      ).toHaveBeenCalledTimes(1);

      expect(
        onQueryChange,
      ).toHaveBeenCalledWith(
        "clinical note",
      );
    },
  );

  it(
    "restores the visible input when the URL query changes externally",
    () => {
      const { rerender } =
        renderNotesFilters({
          query: "first query",
        });

      expect(
        screen.getByRole("searchbox"),
      ).toHaveValue("first query");

      rerender(
        <NotesFilters
          filters={{
            ...DEFAULT_NOTE_LIST_FILTERS,
            query: "restored query",
          }}
          onStatusesChange={vi.fn()}
          onReviewerChange={vi.fn()}
          onPatientChange={vi.fn()}
          onCreatedFromChange={vi.fn()}
          onCreatedToChange={vi.fn()}
          onSortFieldChange={vi.fn()}
          onSortDirectionChange={vi.fn()}
          onQueryChange={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("searchbox"),
      ).toHaveValue(
        "restored query",
      );
    },
  );

  it(
    "commits an empty query after the search is cleared",
    () => {
      vi.useFakeTimers();

      const { onQueryChange } =
        renderNotesFilters({
          query: "existing query",
        });

      const searchInput =
        screen.getByRole("searchbox");

      fireEvent.change(searchInput, {
        target: {
          value: "",
        },
      });

      expect(searchInput).toHaveValue(
        "",
      );

      expect(
        onQueryChange,
      ).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(
        onQueryChange,
      ).toHaveBeenCalledOnce();

      expect(
        onQueryChange,
      ).toHaveBeenCalledWith("");
    },
  );
});