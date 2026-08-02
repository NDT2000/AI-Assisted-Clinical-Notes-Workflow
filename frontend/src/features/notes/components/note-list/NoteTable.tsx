import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import {
  useVirtualizer,
} from "@tanstack/react-virtual";
import {
  Link,
} from "react-router-dom";

import type {
  NoteSummary,
} from "../../../../domain/noteSummary";
import {
  useVisibleNotesRealtime,
} from "../../realtime/useVisibleNotesRealtime";

interface NotesTableProps {
  notes: NoteSummary[];
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  selectedIds: Set<string>;
  onToggleRow: (
    noteId: string,
  ) => void;
  onToggleAllVisible: () => void;
}

const ROW_HEIGHT_PX = 44;
const CONTAINER_HEIGHT_PX = 600;
const LOAD_MORE_THRESHOLD = 10;

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

const CELL_STYLE:
  CSSProperties = {
    minWidth: 0,
    padding: "0 8px",
    boxSizing:
      "border-box",
    overflow: "hidden",
    textOverflow:
      "ellipsis",
    whiteSpace: "nowrap",
  };

const HEADER_CELL_STYLE:
  CSSProperties = {
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
    useRef<HTMLDivElement | null>(
      null,
    );

  const selectAllRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const rowVirtualizer =
    useVirtualizer({
      count: notes.length,
      getScrollElement: () =>
        scrollContainerRef.current,
      estimateSize: () =>
        ROW_HEIGHT_PX,
      overscan: 8,
    });

  const virtualRows =
    rowVirtualizer.getVirtualItems();

  const visibleNoteIds =
    useMemo(
      () =>
        virtualRows
          .map(
            virtualRow =>
              notes[
                virtualRow.index
              ]?.id,
          )
          .filter(
            (
              noteId,
            ): noteId is string =>
              noteId !== undefined,
          ),
      [
        notes,
        virtualRows,
      ],
    );

  const displayedNotes =
    useVisibleNotesRealtime(
      notes,
      visibleNoteIds,
    );

  const allLoadedSelected =
    notes.length > 0 &&
    notes.every(note =>
      selectedIds.has(
        note.id,
      ),
    );

  const someLoadedSelected =
    notes.some(note =>
      selectedIds.has(
        note.id,
      ),
    );

  useEffect(() => {
    if (
      selectAllRef.current
    ) {
      selectAllRef.current.indeterminate =
        someLoadedSelected &&
        !allLoadedSelected;
    }
  }, [
    allLoadedSelected,
    someLoadedSelected,
  ]);

  useEffect(() => {
    const lastVirtualRow =
      virtualRows[
        virtualRows.length - 1
      ];

    if (
      lastVirtualRow ===
      undefined
    ) {
      return;
    }

    const isNearEnd =
      lastVirtualRow.index >=
      notes.length -
        1 -
        LOAD_MORE_THRESHOLD;

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
    <section
      aria-labelledby="notes-table-heading"
      aria-describedby="notes-table-instructions"
    >
      <h2 id="notes-table-heading">
        Notes results
      </h2>

      <p id="notes-table-instructions">
        The results are virtualized. Use
        Tab to move between selection
        controls and note links. Scroll
        the results region to load and
        display additional rows.
      </p>

      <div
        style={{
          overflowX: "auto",
        }}
      >
        <div
          role="table"
          aria-label="Notes"
          aria-rowcount={
            displayedNotes.length +
            1
          }
          aria-colcount={7}
          style={{
            minWidth:
              TABLE_MIN_WIDTH_PX,
          }}
        >
          <div
            role="row"
            aria-rowindex={1}
            style={{
              display: "grid",
              gridTemplateColumns:
                TABLE_GRID_TEMPLATE,
              columnGap: 12,
              alignItems:
                "center",
              minHeight:
                ROW_HEIGHT_PX,
            }}
          >
            <div
              role="columnheader"
              aria-colindex={1}
              aria-label="Selection"
              style={
                CELL_STYLE
              }
            >
              <input
                ref={selectAllRef}
                type="checkbox"
                aria-label="Select all loaded notes"
                checked={
                  allLoadedSelected
                }
                onChange={
                  onToggleAllVisible
                }
              />
            </div>

            {COLUMNS.map(
              (
                column,
                index,
              ) => (
                <div
                  key={column}
                  role="columnheader"
                  aria-colindex={
                    index + 2
                  }
                  style={
                    HEADER_CELL_STYLE
                  }
                >
                  {column}
                </div>
              ),
            )}
          </div>

          <div
            ref={
              scrollContainerRef
            }
            role="region"
            aria-label="Scrollable notes results"
            tabIndex={0}
            style={{
              height:
                CONTAINER_HEIGHT_PX,
              overflowY:
                "auto",
              position:
                "relative",
            }}
          >
            <div
              role="rowgroup"
              style={{
                height:
                  rowVirtualizer
                    .getTotalSize(),
                position:
                  "relative",
                width: "100%",
              }}
            >
              {virtualRows.map(
                virtualRow => {
                  const note =
                    displayedNotes[
                      virtualRow
                        .index
                    ];

                  if (
                    note ===
                    undefined
                  ) {
                    return null;
                  }

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
                        virtualRow
                          .index +
                        2
                      }
                      data-index={
                        virtualRow
                          .index
                      }
                      style={{
                        position:
                          "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height:
                          virtualRow
                            .size,
                        transform:
                          `translateY(${virtualRow.start}px)`,
                        display:
                          "grid",
                        gridTemplateColumns:
                          TABLE_GRID_TEMPLATE,
                        columnGap: 12,
                        alignItems:
                          "center",
                      }}
                    >
                      <div
                        role="cell"
                        aria-colindex={1}
                        style={
                          CELL_STYLE
                        }
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select note for ${note.patient.displayName}`}
                          checked={selectedIds.has(
                            note.id,
                          )}
                          onChange={() =>
                            onToggleRow(
                              note.id,
                            )
                          }
                        />
                      </div>

                      <div
                        role="cell"
                        aria-colindex={2}
                        style={
                          CELL_STYLE
                        }
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
                        aria-colindex={3}
                        style={
                          CELL_STYLE
                        }
                        title={
                          note.status
                        }
                      >
                        {note.status}
                      </div>

                      <div
                        role="cell"
                        aria-colindex={4}
                        style={
                          CELL_STYLE
                        }
                        title={
                          reviewerName
                        }
                      >
                        {reviewerName}
                      </div>

                      <div
                        role="cell"
                        aria-colindex={5}
                        style={
                          CELL_STYLE
                        }
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
                        aria-colindex={6}
                        style={
                          CELL_STYLE
                        }
                        title={
                          updatedAtLabel
                        }
                      >
                        {
                          updatedAtLabel
                        }
                      </div>

                      <div
                        role="cell"
                        aria-colindex={7}
                        style={
                          CELL_STYLE
                        }
                      >
                        <Link
                          to={`/notes/${note.id}`}
                          aria-label={`Open note for ${note.patient.displayName}`}
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
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          Loading more notes…
        </p>
      )}
    </section>
  );
}
