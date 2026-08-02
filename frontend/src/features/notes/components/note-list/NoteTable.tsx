import {
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  useVirtualizer,
} from "@tanstack/react-virtual";
import {
  Link,
} from "react-router-dom";

import type {
  NoteStatus,
} from "../../../../domain/noteAttributes";
import type {
  NoteSummary,
} from "../../../../domain/noteSummary";
import {
  useVisibleNotesRealtime,
} from "../../realtime/useVisibleNotesRealtime";
import "./NoteTable.css";

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

const ROW_HEIGHT_PX = 56;
const CONTAINER_HEIGHT_PX = 600;
const LOAD_MORE_THRESHOLD = 10;

const TABLE_GRID_TEMPLATE = `
  42px
  minmax(150px, 1.1fr)
  minmax(150px, 1fr)
  minmax(170px, 1.15fr)
  minmax(72px, 0.45fr)
  minmax(180px, 1.15fr)
  minmax(180px, 1.15fr)
  minmax(88px, 0.55fr)
`;

const TABLE_MIN_WIDTH_PX = 1240;

const COLUMNS = [
  "Patient",
  "Status",
  "Assigned reviewer",
  "Revision",
  "Created time",
  "Updated time",
  "Action",
];

function formatStatus(
  status: NoteStatus,
): string {
  return status
    .toLowerCase()
    .split("_")
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(" ");
}

function formatDateTime(
  value: string,
): string {
  return new Date(
    value,
  ).toLocaleString();
}

function getStatusClassName(
  status: NoteStatus,
): string {
  return status
    .toLowerCase()
    .replaceAll("_", "-");
}

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
            (virtualRow) =>
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

  const selectedVisibleCount =
    notes.reduce(
      (count, note) =>
        selectedIds.has(note.id)
          ? count + 1
          : count,
      0,
    );

  const allVisibleSelected =
    notes.length > 0 &&
    selectedVisibleCount ===
      notes.length;

  const someVisibleSelected =
    selectedVisibleCount > 0 &&
    !allVisibleSelected;

  useEffect(() => {
    if (
      selectAllRef.current !== null
    ) {
      selectAllRef.current.indeterminate =
        someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    const lastVirtualRow =
      virtualRows[
        virtualRows.length - 1
      ];

    if (
      lastVirtualRow === undefined
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
      className="notes-table-section"
      aria-labelledby="notes-table-heading"
    >
      <div className="notes-table-heading">
        <div>
          <h2 id="notes-table-heading">
            Notes list
          </h2>

          <p>
            Creation and update times
            are shown separately so date
            filters can be verified.
          </p>
        </div>

        {selectedVisibleCount >
          0 && (
          <span className="notes-table-selection-count">
            {selectedVisibleCount} selected
          </span>
        )}
      </div>

      <div className="notes-table-horizontal-scroll">
        <div
          className="notes-table"
          role="table"
          aria-label="Notes"
          aria-rowcount={
            displayedNotes.length + 1
          }
          aria-colcount={8}
          style={{
            minWidth:
              TABLE_MIN_WIDTH_PX,
          }}
        >
          <div
            className="notes-table-header"
            role="row"
            aria-rowindex={1}
            style={{
              gridTemplateColumns:
                TABLE_GRID_TEMPLATE,
            }}
          >
            <div
              className="notes-table-cell notes-table-select-cell"
              role="columnheader"
              aria-colindex={1}
            >
              <input
                ref={selectAllRef}
                type="checkbox"
                aria-label="Select all loaded notes"
                checked={
                  allVisibleSelected
                }
                onChange={
                  onToggleAllVisible
                }
              />
            </div>

            {COLUMNS.map(
              (column, index) => (
                <div
                  key={column}
                  className="notes-table-cell notes-table-header-cell"
                  role="columnheader"
                  aria-colindex={
                    index + 2
                  }
                >
                  {column}
                </div>
              ),
            )}
          </div>

          <div
            ref={scrollContainerRef}
            className="notes-table-scroll-region"
            role="region"
            aria-label="Scrollable notes rows"
            tabIndex={0}
          >
            <div
              className="notes-table-virtual-space"
              style={{
                height:
                  rowVirtualizer
                    .getTotalSize(),
              }}
            >
              {virtualRows.map(
                (virtualRow) => {
                  const note =
                    displayedNotes[
                      virtualRow.index
                    ];

                  if (
                    note === undefined
                  ) {
                    return null;
                  }

                  const reviewerName =
                    note.assignedReviewer
                      ?.displayName ??
                    "Unassigned";

                  const createdAtLabel =
                    formatDateTime(
                      note.createdAt,
                    );

                  const updatedAtLabel =
                    formatDateTime(
                      note.updatedAt,
                    );

                  const isSelected =
                    selectedIds.has(
                      note.id,
                    );

                  return (
                    <div
                      key={note.id}
                      className="notes-table-row"
                      role="row"
                      aria-rowindex={
                        virtualRow.index +
                        2
                      }
                      data-selected={
                        isSelected
                          ? "true"
                          : "false"
                      }
                      data-index={
                        virtualRow.index
                      }
                      style={{
                        height:
                          virtualRow.size,
                        transform:
                          `translateY(${virtualRow.start}px)`,
                        gridTemplateColumns:
                          TABLE_GRID_TEMPLATE,
                      }}
                    >
                      <div
                        className="notes-table-cell notes-table-select-cell"
                        role="cell"
                        aria-colindex={1}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select note for ${note.patient.displayName}`}
                          checked={isSelected}
                          onChange={() =>
                            onToggleRow(
                              note.id,
                            )
                          }
                        />
                      </div>

                      <div
                        className="notes-table-cell notes-table-patient"
                        role="cell"
                        aria-colindex={2}
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
                        className="notes-table-cell"
                        role="cell"
                        aria-colindex={3}
                      >
                        <span
                          className={`notes-status-badge notes-status-${getStatusClassName(
                            note.status,
                          )}`}
                          title={note.status}
                        >
                          {
                            formatStatus(
                              note.status,
                            )
                          }
                        </span>
                      </div>

                      <div
                        className="notes-table-cell"
                        role="cell"
                        aria-colindex={4}
                        title={
                          reviewerName
                        }
                      >
                        {reviewerName}
                      </div>

                      <div
                        className="notes-table-cell notes-table-revision"
                        role="cell"
                        aria-colindex={5}
                        title={String(
                          note.currentVersion
                            .revision,
                        )}
                      >
                        Rev.{" "}
                        {
                          note.currentVersion
                            .revision
                        }
                      </div>

                      <div
                        className="notes-table-cell notes-table-date"
                        role="cell"
                        aria-colindex={6}
                        title={
                          createdAtLabel
                        }
                      >
                        <time
                          dateTime={
                            note.createdAt
                          }
                        >
                          {createdAtLabel}
                        </time>
                      </div>

                      <div
                        className="notes-table-cell notes-table-date"
                        role="cell"
                        aria-colindex={7}
                        title={
                          updatedAtLabel
                        }
                      >
                        <time
                          dateTime={
                            note.updatedAt
                          }
                        >
                          {updatedAtLabel}
                        </time>
                      </div>

                      <div
                        className="notes-table-cell notes-table-action"
                        role="cell"
                        aria-colindex={8}
                      >
                        <Link
                          className="notes-table-open-link"
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
          className="notes-table-loading"
          role="status"
          aria-live="polite"
        >
          Loading more notes…
        </p>
      )}
    </section>
  );
}
