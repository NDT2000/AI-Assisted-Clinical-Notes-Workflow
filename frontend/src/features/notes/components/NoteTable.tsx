import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router-dom";

import type { NoteSummary } from "../../../domain/noteSummary";

interface NotesTableProps {
  notes: NoteSummary[];
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  selectedIds: Set<string>;
  onToggleRow: (noteId: string) => void;
  onToggleAllVisible: () => void;
}

/*
 * Row height must be fixed for this to work. TanStack Virtual can
 * support dynamic/measured row heights, but that requires a
 * ResizeObserver per row and is materially more complex. Every field
 * rendered here (patient name, status, reviewer name, date string) is
 * single-line and truncatable with CSS, so a fixed height is a
 * deliberate simplicity choice, not an oversight — worth stating as
 * such in the README rather than leaving it implicit.
 */
const ROW_HEIGHT_PX = 44;
const CONTAINER_HEIGHT_PX = 600;

/*
 * How many rows from the end of the currently-loaded list to start
 * the next fetch. Non-zero so the next page is already loading by
 * the time the user actually scrolls to the bottom, rather than
 * them seeing a loading flicker at the exact edge.
 */
const LOAD_MORE_THRESHOLD = 10;

const COLUMNS = [
  "Patient",
  "Status",
  "Assigned reviewer",
  "Revision",
  "Updated time",
  "Action",
];

export function NotesTable({
  notes,
  hasMore,
  isLoadingMore,
  onLoadMore,
  selectedIds,
  onToggleRow,
  onToggleAllVisible,
}: NotesTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const allVisibleSelected =
    notes.length > 0 &&
    notes.every((note) => selectedIds.has(note.id));

  const rowVirtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    /*
     * Overscan renders a few rows beyond the visible viewport in
     * both directions. Without it, fast scrolling shows a brief
     * blank flash before rows render — overscan pre-renders a buffer
     * so that flash doesn't happen. This is a render-smoothness
     * concern, unrelated to the data-fetch threshold below.
     */
    overscan: 8,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  /*
   * Data-fetch trigger lives here, not as a separate sentinel <div>
   * below the table. Reason: once rows are absolutely positioned
   * inside a fixed-height scroll container, a sentinel placed after
   * the table in normal document flow would sit outside the
   * scrollable area entirely and could never intersect the
   * viewport via IntersectionObserver. The virtualizer already
   * knows exactly which row indices are rendered, so asking it
   * "is the last visible row near the end of the loaded array?" is
   * both simpler and more accurate than re-deriving scroll position
   * a second way.
   */
  useEffect(() => {
    const lastVirtualRow = virtualRows[virtualRows.length - 1];

    if (lastVirtualRow === undefined) {
      return;
    }

    const isNearEnd =
      lastVirtualRow.index >=
      notes.length - 1 - LOAD_MORE_THRESHOLD;

    if (isNearEnd && hasMore && !isLoadingMore) {
      onLoadMore();
    }
  }, [virtualRows, notes.length, hasMore, isLoadingMore, onLoadMore]);

  return (
    <div>
      <div
        role="table"
        aria-label="Notes"
        aria-rowcount={notes.length}
      >
        <div role="row" style={{ display: "flex" }}>
          <div
            role="columnheader"
            style={{ flex: "0 0 32px" }}
          >
            <input
              type="checkbox"
              aria-label="Select all loaded notes"
              checked={allVisibleSelected}
              onChange={onToggleAllVisible}
            />
          </div>

          {COLUMNS.map((column) => (
            <div
              key={column}
              role="columnheader"
              style={{ flex: 1, fontWeight: "bold" }}
            >
              {column}
            </div>
          ))}
        </div>

        <div
          ref={scrollContainerRef}
          style={{
            height: CONTAINER_HEIGHT_PX,
            overflowY: "auto",
            position: "relative",
          }}
        >
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualRows.map((virtualRow) => {
              const note = notes[virtualRow.index];

              return (
                <div
                  key={note.id}
                  role="row"
                  aria-rowindex={virtualRow.index + 1}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: "flex",
                  }}
                >
                  <div role="cell" style={{ flex: "0 0 32px" }}>
                    <input
                      type="checkbox"
                      aria-label={`Select note for ${note.patient.displayName}`}
                      checked={selectedIds.has(note.id)}
                      onChange={() => onToggleRow(note.id)}
                    />
                  </div>

                  <div role="cell" style={{ flex: 1 }}>
                    {note.patient.displayName}
                  </div>

                  <div role="cell" style={{ flex: 1 }}>
                    {note.status}
                  </div>

                  <div role="cell" style={{ flex: 1 }}>
                    {note.assignedReviewer?.displayName ??
                      "Unassigned"}
                  </div>

                  <div role="cell" style={{ flex: 1 }}>
                    {note.currentVersion.revision}
                  </div>

                  <div role="cell" style={{ flex: 1 }}>
                    {new Date(note.updatedAt).toLocaleString()}
                  </div>

                  <div role="cell" style={{ flex: 1 }}>
                    <Link to={`/notes/${note.id}`}>Open</Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isLoadingMore && <p>Loading more notes…</p>}
    </div>
  );
}