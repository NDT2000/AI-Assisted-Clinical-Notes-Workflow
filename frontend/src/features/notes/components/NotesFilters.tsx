import {
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  NOTE_STATUS,
  type NoteStatus,
} from "../../../domain/noteAttributes";
import type {
  NoteListFilters,
  NoteSortField,
  SortDirection,
} from "../utils/noteListSearchParams";
import {
  getPatients,
  type PatientOption,
} from "../api/getPatients";

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

/*
 * Reviewers remain a small, fixed roster (5 entries, matching the
 * mock backend's REVIEWERS list). Unlike patients — which number in
 * the hundreds and must be looked up dynamically — a hardcoded
 * reviewer list is a defensible, documented simplification for a
 * take-home: real deployments would fetch this from a users/roles
 * endpoint, but the roster size here doesn't demonstrate anything
 * that dynamic patient lookup doesn't already cover.
 */
export const REVIEWERS = [
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

const DEBOUNCE_MS = 400;

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
    <section 
      className="notes-filters"
      aria-label="Note filters">
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

      <PatientFilter
        patientId={filters.patientId}
        onPatientChange={onPatientChange}
      />

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

      <SearchBox
        query={filters.query}
        onQueryChange={onQueryChange}
      />

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

/*
 * Debounced free-text search. Deliberately kept LOCAL to this
 * component rather than lifted into NotesPage's render-triggering
 * state: every keystroke needs to update the visible input
 * immediately (so typing feels responsive), but the parent's
 * onQueryChange — which triggers a network request and a URL update
 * — should only fire after the user pauses. Mixing those two update
 * rates in the parent's state would either lag the input or fire a
 * request per keystroke; keeping local state here cleanly separates
 * "what's on screen" from "when do we act on it."
 */
function SearchBox({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [localValue, setLocalValue] = useState(query);

  const debounceTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  /*
   * Keep local input text in sync if the query changes from OUTSIDE
   * this component — e.g. browser Back/Forward restoring an older
   * URL with a different ?q=. Without this, pressing Back would
   * change the actual filter but leave stale text sitting in the
   * input box.
   */
  useEffect(() => {
    setLocalValue(query);
  }, [query]);

  function handleChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const nextValue = event.target.value;

    setLocalValue(nextValue);

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onQueryChange(nextValue);
    }, DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div>
      <label htmlFor="search-filter">
        Search patient or note content
      </label>

      <input
        id="search-filter"
        type="search"
        value={localValue}
        onChange={handleChange}
        placeholder="Search…"
      />
    </div>
  );
}

/*
 * Async patient typeahead. Replaces the old hardcoded 3-entry
 * dropdown, which could never represent the real ~500-patient
 * dataset. Same debounce pattern as SearchBox, but the debounced
 * action is a lookup fetch rather than a filter change — the actual
 * filter only commits once the user picks a specific patient from
 * results, not on every keystroke.
 */
function PatientFilter({
  patientId,
  onPatientChange,
}: {
  patientId: string;
  onPatientChange: (
    patientId: string,
    patientDisplayName: string,
  ) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [results, setResults] = useState<PatientOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const debounceTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  /*
   * AbortController per lookup, not just a stale-response check.
   * Rationale: if the user types quickly, several patient-lookup
   * requests could be in flight at once. Cancelling the previous one
   * outright (rather than only discarding its result on arrival)
   * avoids wasting server work on a query the user has already
   * moved past — a real cost at scale even though this is a mock
   * backend.
   */
  const abortControllerRef = useRef<AbortController | null>(null);

  function handleInputChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const nextValue = event.target.value;

    setInputValue(nextValue);
    setIsOpen(true);

    if (nextValue === "") {
      onPatientChange("", "");
    }

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void runLookup(nextValue);
    }, DEBOUNCE_MS);
  }

  async function runLookup(query: string) {
    if (abortControllerRef.current !== null) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const patients = await getPatients(
        query,
        controller.signal,
      );

      setResults(patients);
    } catch (error) {
      // AbortError is expected whenever a newer keystroke cancels
      // this request — not a real failure, so it's intentionally
      // swallowed rather than surfaced as an error state.
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      setResults([]);
    }
  }

  function handleSelect(patient: PatientOption) {
    setInputValue(patient.displayName);
    setIsOpen(false);
    onPatientChange(patient.id, patient.displayName);
  }

  function handleClear() {
    setInputValue("");
    setResults([]);
    setIsOpen(false);
    onPatientChange("", "");
  }

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }

      if (abortControllerRef.current !== null) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div>
      <label htmlFor="patient-filter">
        Patient
      </label>

      <input
        id="patient-filter"
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        placeholder="Search patients…"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls="patient-filter-results"
        autoComplete="off"
      />

      {patientId !== "" && (
        <button type="button" onClick={handleClear}>
          Clear
        </button>
      )}

      {isOpen && results.length > 0 && (
        <ul id="patient-filter-results" role="listbox">
          {results.map((patient) => (
            <li key={patient.id} role="option">
              <button
                type="button"
                onClick={() => handleSelect(patient)}
              >
                {patient.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}