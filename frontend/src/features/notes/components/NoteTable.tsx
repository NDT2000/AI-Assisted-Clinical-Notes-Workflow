import {
  useEffect,
  useRef,
  type CSSProperties,
} from "react";
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
 * Fixed row height keeps virtualization straightforward.
 *
 * Every cell is forced onto one line and truncated when
 * necessary so that the visual row height always matches
 * the height expected by TanStack Virtual.
 */
const ROW_HEIGHT_PX = 44;
const CONTAINER_HEIGHT_PX = 600;

/*
 * Start loading another cursor page before the user reaches
 * the final loaded row.
 */
const LOAD_MORE_THRESHOLD = 10;

/*
 * The header and every virtualized row use this same grid.
 * This keeps all columns aligned.
 */
const TABLE_GRID_TEMPLATE = `
  32px
  minmax(150px, 1.2fr)
  minmax(160px, 1.2fr)
  minmax(190px, 1.35fr)
  minmax(80px, 0.55fr)
  minmax(210px, 1.45fr)
  minmax(80px, 0.55fr)
`;

const TABLE_MIN_WIDTH_PX = 980;

const CELL_STYLE: CSSProperties = {
  minWidth: 0,
  padding: "0 8px",
  boxSizing: "border-box",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const HEADER_CELL_STYLE: CSSProperties = {
  ...CELL_STYLE,
  fontWeight: "bold",
};

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
  const scrollContainerRef =
    useRef<HTMLDivElement | null>(null);

  const allVisibleSelected =
    notes.length > 0 &&
    notes.every((note) =>
      selectedIds.has(note.id),
    );

  const rowVirtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () =>
      scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_PX,

    /*
     * Overscan renders extra rows outside the currently
     * visible area. This reduces blank flashes during fast
     * scrolling.
     */
    overscan: 8,
  });

  const virtualRows =
    rowVirtualizer.getVirtualItems();

  /*
   * When the last rendered virtual row approaches the end of
   * the loaded notes, request the next cursor page.
   *
   * Pagination still controls how much data is fetched.
   * Virtualization only controls how many loaded rows are
   * rendered in the DOM.
   */
  useEffect(() => {
    const lastVirtualRow =
      virtualRows[virtualRows.length - 1];

    if (lastVirtualRow === undefined) {
      return;
    }

    const isNearEnd =
      lastVirtualRow.index >=
      notes.length - 1 - LOAD_MORE_THRESHOLD;

    if (
      isNearEnd &&
      hasMore &&
      !isLoadingMore
    ) {
      onLoadMore();
    }
  }, [
    virtualRows,
    notes.length,
    hasMore,
    isLoadingMore,
    onLoadMore,
  ]);

  return (
    <div>
      {/*
       * The outer wrapper provides horizontal scrolling on
       * narrow screens instead of compressing and wrapping
       * table cells.
       */}
      <div style={{ overflowX: "auto" }}>
        <div
          role="table"
          aria-label="Notes"
          aria-rowcount={notes.length}
          style={{
            minWidth: TABLE_MIN_WIDTH_PX,
          }}
        >
          <div
            role="row"
            style={{
              display: "grid",
              gridTemplateColumns:
                TABLE_GRID_TEMPLATE,
              columnGap: 12,
              alignItems: "center",
              minHeight: ROW_HEIGHT_PX,
            }}
          >
            <div
              role="columnheader"
              style={CELL_STYLE}
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
                style={HEADER_CELL_STYLE}
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
                height:
                  rowVirtualizer.getTotalSize(),
                position: "relative",
                width: "100%",
              }}
            >
              {virtualRows.map(
                (virtualRow) => {
                  const note =
                    notes[virtualRow.index];

                  const reviewerName =
                    note.assignedReviewer
                      ?.displayName ??
                    "Unassigned";

                  const updatedAtLabel =
                    new Date(
                      note.updatedAt,
                    ).toLocaleString();

                  return (
                    <div
                      key={note.id}
                      role="row"
                      aria-rowindex={
                        virtualRow.index + 1
                      }
                      data-index={
                        virtualRow.index
                      }
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height:
                          virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`,
                        display: "grid",
                        gridTemplateColumns:
                          TABLE_GRID_TEMPLATE,
                        columnGap: 12,
                        alignItems: "center",
                      }}
                    >
                      <div
                        role="cell"
                        style={CELL_STYLE}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select note for ${note.patient.displayName}`}
                          checked={selectedIds.has(
                            note.id,
                          )}
                          onChange={() =>
                            onToggleRow(note.id)
                          }
                        />
                      </div>

                      <div
                        role="cell"
                        style={CELL_STYLE}
                        title={
                          note.patient
                            .displayName
                        }
                      >
                        {
                          note.patient
                            .displayName
                        }
                      </div>

                      <div
                        role="cell"
                        style={CELL_STYLE}
                        title={note.status}
                      >
                        {note.status}
                      </div>

                      <div
                        role="cell"
                        style={CELL_STYLE}
                        title={reviewerName}
                      >
                        {reviewerName}
                      </div>

                      <div
                        role="cell"
                        style={CELL_STYLE}
                        title={String(
                          note.currentVersion
                            .revision,
                        )}
                      >
                        {
                          note.currentVersion
                            .revision
                        }
                      </div>

                      <div
                        role="cell"
                        style={CELL_STYLE}
                        title={updatedAtLabel}
                      >
                        {updatedAtLabel}
                      </div>

                      <div
                        role="cell"
                        style={CELL_STYLE}
                      >
                        <Link
                          to={`/notes/${note.id}`}
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        </div>
      </div>

      {isLoadingMore && (
        <p>Loading more notes…</p>
      )}
    </div>
  );
}