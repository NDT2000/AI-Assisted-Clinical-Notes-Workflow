import type { ChangeEvent } from "react";

import {
  NOTE_STATUS,
  type NoteStatus,
} from "../../../domain/noteAttributes";
import type {
  NoteListFilters,
  NoteSortField,
  SortDirection,
} from "../utils/noteListSearchParams";

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
}

const REVIEWERS = [
  {
    id: "reviewer-1",
    displayName: "Alex Kim",
  },
  {
    id: "reviewer-2",
    displayName: "Robin Chen",
  },
  {
    id: "reviewer-3",
    displayName: "Sam Rivera",
  },
  {
    id: "reviewer-4",
    displayName: "Drew Patel",
  },
  {
    id: "reviewer-5",
    displayName: "Jules Martin",
  },
];

const PATIENTS = [
  {
    id: "patient-1",
    displayName: "Patient 1",
  },
  {
    id: "patient-2",
    displayName: "Patient 2",
  },
  {
    id: "patient-3",
    displayName: "Patient 3",
  },
];

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
}: NotesFiltersProps) {
  function handleStatusChange(
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    const selectedStatuses = Array.from(
      event.target.selectedOptions,
      (option) => option.value as NoteStatus,
    );

    onStatusesChange(selectedStatuses);
  }

  return (
    <section aria-label="Note filters">
      <div>
        <label htmlFor="status-filter">
          Status
        </label>

        <select
          id="status-filter"
          multiple
          value={filters.statuses}
          onChange={handleStatusChange}
        >
          {NOTE_STATUS.map((status) => (
            <option
              key={status}
              value={status}
            >
              {status}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="reviewer-filter">
          Reviewer
        </label>

        <select
          id="reviewer-filter"
          value={filters.reviewerId}
          onChange={(event) =>
            onReviewerChange(
              event.target.value,
            )
          }
        >
          <option value="">
            All reviewers
          </option>

          {REVIEWERS.map((reviewer) => (
            <option
              key={reviewer.id}
              value={reviewer.id}
            >
              {reviewer.displayName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="patient-filter">
          Patient
        </label>

        <select
          id="patient-filter"
          value={filters.patientId}
          onChange={(event) =>
            onPatientChange(
              event.target.value,
            )
          }
        >
          <option value="">
            All patients
          </option>

          {PATIENTS.map((patient) => (
            <option
              key={patient.id}
              value={patient.id}
            >
              {patient.displayName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="created-from-filter">
          Created from
        </label>

        <input
          id="created-from-filter"
          type="date"
          value={filters.createdFrom}
          onChange={(event) =>
            onCreatedFromChange(
              event.target.value,
            )
          }
        />
      </div>

      <div>
        <label htmlFor="created-to-filter">
          Created to
        </label>

        <input
          id="created-to-filter"
          type="date"
          value={filters.createdTo}
          onChange={(event) =>
            onCreatedToChange(
              event.target.value,
            )
          }
        />
      </div>

      <div>
        <label htmlFor="sort-field">
          Sort by
        </label>

        <select
          id="sort-field"
          value={filters.sortField}
          onChange={(event) =>
            onSortFieldChange(
              event.target
                .value as NoteSortField,
            )
          }
        >
          {SORT_FIELDS.map((field) => (
            <option
              key={field.value}
              value={field.value}
            >
              {field.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="sort-direction">
          Direction
        </label>

        <select
          id="sort-direction"
          value={filters.sortDirection}
          onChange={(event) =>
            onSortDirectionChange(
              event.target
                .value as SortDirection,
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
    </section>
  );
}