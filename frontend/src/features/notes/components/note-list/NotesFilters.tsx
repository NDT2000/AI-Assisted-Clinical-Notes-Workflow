import {
  type ChangeEvent,
} from "react";

import {
  NOTE_STATUS,
  type NoteStatus,
} from "../../../../domain/noteAttributes";
import {
  useReviewers,
} from "../../../users/reviewerDirectory";
import type {
  NoteListFilters,
  NoteSortField,
  SortDirection,
} from "../../utils/noteListSearchParams";
import "./NotesFilters.css";
import {
  NotesSearchBox,
} from "./NotesSearchBox";
import {
  PatientFilter,
} from "./PatientFilter";
import {
  formatNoteStatus,
} from "../../../../shared/formatters";

interface NotesFiltersProps {
  filters: NoteListFilters;
  onStatusesChange: (
    statuses: NoteStatus[],
  ) => void;
  onReviewerChange: (
    reviewerId: string,
  ) => void;
  onPatientChange: (
    patientId: string,
    patientDisplayName: string,
  ) => void;
  onCreatedFromChange: (
    createdFrom: string,
  ) => void;
  onCreatedToChange: (
    createdTo: string,
  ) => void;
  onSortFieldChange: (
    sortField: NoteSortField,
  ) => void;
  onSortDirectionChange: (
    sortDirection: SortDirection,
  ) => void;
  onQueryChange: (
    query: string,
  ) => void;
}

const SORT_FIELDS: {
  value: NoteSortField;
  label: string;
}[] = [
  {
    value: "updatedAt",
    label: "Updated time",
  },
  {
    value: "createdAt",
    label: "Created time",
  },
  {
    value: "patientName",
    label: "Patient name",
  },
  {
    value: "status",
    label: "Status",
  },
];

export function NotesFilters({
  filters,
  onStatusesChange,
  onReviewerChange,
  onPatientChange,
  onCreatedFromChange,
  onCreatedToChange,
  onSortFieldChange,
  onSortDirectionChange,
  onQueryChange,
}: NotesFiltersProps) {
  const reviewers = useReviewers();

  function handleStatusChange(
    event:
      ChangeEvent<HTMLSelectElement>,
  ) {
    const selectedStatuses =
      Array.from(
        event.target
          .selectedOptions,
        (option) =>
          option.value as
            NoteStatus,
      );

    onStatusesChange(
      selectedStatuses,
    );
  }

  const isPatientFilterEnabled =
    filters.statuses.length > 0 ||
    filters.reviewerId !== "" ||
    filters.createdFrom !== "" ||
    filters.createdTo !== "";

  return (
    <section
      className="notes-filters"
      aria-labelledby="notes-filters-heading"
    >
      <div className="notes-filters-heading">
        <div>
          <h2 id="notes-filters-heading">
            Filter notes
          </h2>

          <p>
            Filters are saved in the URL
            and can be shared or restored.
          </p>
        </div>
      </div>

      <div className="notes-filters-grid">
        <div className="notes-filter-field notes-filter-status">
          <label htmlFor="status-filter">
            Status
          </label>

          <select
            id="status-filter"
            multiple
            value={filters.statuses}
            onChange={
              handleStatusChange
            }
          >
            {NOTE_STATUS.map(
              (status) => (
                <option
                  key={status}
                  value={status}
                >
                  {formatNoteStatus(status)}
                </option>
              ),
            )}
          </select>

          <small>
            Hold Ctrl or Command to
            select multiple statuses.
          </small>
        </div>

        <div className="notes-filter-field">
          <label htmlFor="reviewer-filter">
            Reviewer
          </label>

          <select
            id="reviewer-filter"
            value={
              filters.reviewerId
            }
            onChange={(event) =>
              onReviewerChange(
                event.target.value,
              )
            }
          >
            <option value="">
              All reviewers
            </option>

            {reviewers.map(
              (reviewer) => (
                <option
                  key={reviewer.id}
                  value={reviewer.id}
                >
                  {
                    reviewer.displayName
                  }
                </option>
              ),
            )}
          </select>
        </div>

        <PatientFilter
          patientId={
            filters.patientId
          }
          filters={filters}
          isEnabled={
            isPatientFilterEnabled
          }
          onPatientChange={
            onPatientChange
          }
        />

        <div className="notes-filter-field">
          <label htmlFor="created-from-filter">
            Created from
          </label>

          <input
            id="created-from-filter"
            type="date"
            value={
              filters.createdFrom
            }
            onChange={(event) =>
              onCreatedFromChange(
                event.target.value,
              )
            }
          />
        </div>

        <div className="notes-filter-field">
          <label htmlFor="created-to-filter">
            Created to
          </label>

          <input
            id="created-to-filter"
            type="date"
            value={
              filters.createdTo
            }
            onChange={(event) =>
              onCreatedToChange(
                event.target.value,
              )
            }
          />
        </div>

        <NotesSearchBox
          query={filters.query}
          onQueryChange={
            onQueryChange
          }
        />

        <div className="notes-filter-field">
          <label htmlFor="sort-field">
            Sort by
          </label>

          <select
            id="sort-field"
            value={filters.sortField}
            onChange={(event) =>
              onSortFieldChange(
                event.target
                  .value as
                  NoteSortField,
              )
            }
          >
            {SORT_FIELDS.map(
              (field) => (
                <option
                  key={field.value}
                  value={field.value}
                >
                  {field.label}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="notes-filter-field">
          <label htmlFor="sort-direction">
            Direction
          </label>

          <select
            id="sort-direction"
            value={
              filters.sortDirection
            }
            onChange={(event) =>
              onSortDirectionChange(
                event.target
                  .value as
                  SortDirection,
              )
            }
          >
            <option value="asc">
              Ascending
            </option>

            <option value="desc">
              Descending
            </option>
          </select>
        </div>
      </div>
    </section>
  );
}
