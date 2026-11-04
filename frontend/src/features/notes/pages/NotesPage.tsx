import type {
  ReactNode,
} from "react";

import {
  useCurrentActor,
} from "../../../auth/useCurrentActor";
import {
  BulkActionBar,
} from "../components/note-list/BulkActionBar";
import {
  NotesFilters,
} from "../components/note-list/NotesFilters";
import {
  NotesTable,
} from "../components/note-list/NotesTable";
import {
  NotesTableSkeleton,
} from "../components/note-list/NotesTableSkeleton";
import {
  RoleWorkspaceShortcuts,
} from "../components/note-list/RoleWorkspaceShortcuts";
import {
  useBulkActions,
} from "../hooks/useBulkActions";
import {
  useNoteListFilters,
} from "../hooks/useNoteListFilters";
import {
  useNoteSelection,
} from "../hooks/useNoteSelection";
import {
  useNotesList,
} from "../hooks/useNotesList";

export function NotesPage() {
  const { actor } =
    useCurrentActor();

  const {
    filters,
    filtersKey,
    actions: filterActions,
  } = useNoteListFilters();

  const list =
    useNotesList(filters);

  const resetKey =
    `${actor.id}:${filtersKey}`;

  const selection = useNoteSelection(
    list.items,
    resetKey,
  );

  const bulk = useBulkActions({
    actor,
    items: list.items,
    setItems: list.setItems,
    selectedNotes:
      selection.selectedNotes,
    resetKey,
  });

  const header: ReactNode = (
    <>
      <h1>Notes</h1>

      <RoleWorkspaceShortcuts
        actor={actor}
        activeStatuses={
          filters.statuses
        }
        activeReviewerId={
          filters.reviewerId
        }
        onApplyView={
          filterActions.applyWorkspaceView
        }
      />

      <NotesFilters
        filters={filters}
        onStatusesChange={
          filterActions.setStatuses
        }
        onReviewerChange={
          filterActions.setReviewer
        }
        onPatientChange={
          filterActions.setPatient
        }
        onCreatedFromChange={
          filterActions.setCreatedFrom
        }
        onCreatedToChange={
          filterActions.setCreatedTo
        }
        onSortFieldChange={
          filterActions.setSortField
        }
        onSortDirectionChange={
          filterActions.setSortDirection
        }
        onQueryChange={
          filterActions.setQuery
        }
      />
    </>
  );

  if (list.isLoading) {
    return (
      <main>
        {header}
        <NotesTableSkeleton />
      </main>
    );
  }

  if (
    list.error !== null &&
    list.items.length === 0
  ) {
    return (
      <main>
        {header}

        <p role="alert">
          {list.error}
        </p>

        <button
          type="button"
          onClick={list.reload}
        >
          Try again
        </button>
      </main>
    );
  }

  if (list.items.length === 0) {
    return (
      <main>
        {header}

        <p>
          {filters.query !== ""
            ? `No notes match the search "${filters.query}".`
            : "No notes match the current filters."}
        </p>
      </main>
    );
  }

  const selectedCount =
    selection.selectedIds.size;

  return (
    <main>
      {header}

      <p>
        Showing {list.items.length} of{" "}
        {list.total} notes
      </p>

      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          eligibleForRegenerationCount={
            bulk.eligibleForRegeneration
              .length
          }
          ineligibleForRegenerationCount={
            selection.selectedNotes
              .length -
            bulk.eligibleForRegeneration
              .length
          }
          isBusy={bulk.isBusy}
          error={bulk.error}
          onAssignReviewer={reviewer =>
            void bulk.assignReviewer(
              reviewer,
            )
          }
          onRegenerate={() =>
            void bulk.requestRegeneration()
          }
          onClearSelection={
            selection.clear
          }
        />
      )}

      <NotesTable
        key={resetKey}
        notes={list.items}
        hasMore={list.hasMore}
        isLoadingMore={
          list.isLoadingMore
        }
        onLoadMore={list.loadMore}
        selectedIds={
          selection.selectedIds
        }
        onToggleRow={selection.toggle}
        onToggleAllVisible={
          selection.toggleAllLoaded
        }
      />

      {list.loadMoreError !== null && (
        <div role="alert">
          <p>{list.loadMoreError}</p>

          <button
            type="button"
            onClick={() =>
              list.loadMore(true)
            }
            disabled={
              list.isLoadingMore
            }
          >
            Retry loading more
          </button>
        </div>
      )}
    </main>
  );
}
