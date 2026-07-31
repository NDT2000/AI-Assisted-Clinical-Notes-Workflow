import { type ChangeEvent, useEffect, useRef, useState, } from "react";

import { NOTE_STATUS, type NoteStatus, } from "../../../../domain/noteAttributes";
import type { NoteListFilters, NoteSortField, SortDirection, } from "../../utils/noteListSearchParams";
import { getPatientById, getPatients, type PatientOption, } from "../../api/getPatients";

import { REVIEWERS } from "../../../../mock-data/generateNoteSummary";

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

  const isPatientFilterEnabled =
    filters.statuses.length > 0 ||
    filters.reviewerId !== "" ||
    filters.createdFrom !== "" ||
    filters.createdTo !== "";

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
        filters={filters}
        isEnabled={isPatientFilterEnabled}
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

function PatientFilter({
  patientId,
  filters,
  isEnabled,
  onPatientChange,
}: {
  patientId: string;
  filters: NoteListFilters;
  isEnabled: boolean;
  onPatientChange: (
    patientId: string,
    patientDisplayName: string,
  ) => void;
}) {
  const [inputValue, setInputValue] =
    useState("");

  const [results, setResults] =
    useState<PatientOption[]>([]);

  const [isOpen, setIsOpen] =
    useState(false);

  const [isLoading, setIsLoading] =
    useState(false);

  const debounceTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  const lookupAbortControllerRef =
    useRef<AbortController | null>(null);

  /*
   * Keep the latest callback available to effects without
   * forcing those effects to rerun whenever the parent
   * component creates a new callback reference.
   */
  const onPatientChangeRef =
    useRef(onPatientChange);

  useEffect(() => {
    onPatientChangeRef.current =
      onPatientChange;
  }, [onPatientChange]);

  /*
   * The URL stores the stable patient ID rather than the
   * patient's display name.
   *
   * Resolve the display name when:
   * - the page is refreshed;
   * - a copied URL is opened;
   * - browser Back or Forward restores an older patient ID.
   */
  useEffect(() => {
    if (patientId === "") {
      setInputValue("");
      return;
    }

    const controller =
      new AbortController();

    async function restorePatientName() {
      try {
        const patient =
          await getPatientById(
            patientId,
            controller.signal,
          );

        if (patient === null) {
          /*
           * The URL contains a patient ID that does not
           * exist in the current mock dataset.
           */
          onPatientChangeRef.current(
            "",
            "",
          );

          return;
        }

        setInputValue(
          patient.displayName,
        );
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        /*
         * Do not remove a potentially valid patient ID
         * because of a temporary network failure.
         */
      }
    }

    void restorePatientName();

    return () => {
      controller.abort();
    };
  }, [patientId]);

  /*
   * Patient is a dependent filter.
   *
   * When the final contextual filter is removed:
   * - cancel pending searches;
   * - clear typeahead state;
   * - remove the patient filter from the URL.
   */
  useEffect(() => {
    if (isEnabled) {
      return;
    }

    if (
      debounceTimerRef.current !== null
    ) {
      clearTimeout(
        debounceTimerRef.current,
      );

      debounceTimerRef.current = null;
    }

    if (
      lookupAbortControllerRef.current !==
      null
    ) {
      lookupAbortControllerRef.current.abort();

      lookupAbortControllerRef.current =
        null;
    }

    setInputValue("");
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);

    if (patientId !== "") {
      onPatientChangeRef.current("", "");
    }
  }, [isEnabled, patientId]);

  /*
   * Existing patient suggestions may no longer be valid
   * after status, reviewer or date filters change.
   */
  useEffect(() => {
    if (
      debounceTimerRef.current !== null
    ) {
      clearTimeout(
        debounceTimerRef.current,
      );

      debounceTimerRef.current = null;
    }

    if (
      lookupAbortControllerRef.current !==
      null
    ) {
      lookupAbortControllerRef.current.abort();

      lookupAbortControllerRef.current =
        null;
    }

    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
  }, [
    filters.statuses,
    filters.reviewerId,
    filters.createdFrom,
    filters.createdTo,
  ]);

  async function runLookup(
    query: string,
  ) {
    if (!isEnabled) {
      return;
    }

    if (
      lookupAbortControllerRef.current !==
      null
    ) {
      lookupAbortControllerRef.current.abort();
    }

    const controller =
      new AbortController();

    lookupAbortControllerRef.current =
      controller;

    setIsLoading(true);

    try {
      const patients =
        await getPatients(
          query,
          filters,
          controller.signal,
        );

      if (controller.signal.aborted) {
        return;
      }

      setResults(patients);
      setIsOpen(true);
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      setResults([]);
      setIsOpen(true);
    } finally {
      if (
        lookupAbortControllerRef.current ===
        controller
      ) {
        lookupAbortControllerRef.current =
          null;

        setIsLoading(false);
      }
    }
  }

  function handleInputChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    if (!isEnabled) {
      return;
    }

    const nextValue =
      event.target.value;

    setInputValue(nextValue);

    if (
      debounceTimerRef.current !== null
    ) {
      clearTimeout(
        debounceTimerRef.current,
      );

      debounceTimerRef.current = null;
    }

    /*
     * Cancel the previous request immediately rather than
     * waiting for the next debounced request to begin.
     */
    if (
      lookupAbortControllerRef.current !==
      null
    ) {
      lookupAbortControllerRef.current.abort();

      lookupAbortControllerRef.current =
        null;
    }

    const trimmedValue =
      nextValue.trim();

    if (trimmedValue === "") {
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);

      if (patientId !== "") {
        onPatientChange("", "");
      }

      return;
    }

    setIsOpen(true);

    debounceTimerRef.current =
      setTimeout(() => {
        debounceTimerRef.current =
          null;

        void runLookup(trimmedValue);
      }, DEBOUNCE_MS);
  }

  function handleSelect(
    patient: PatientOption,
  ) {
    if (
      debounceTimerRef.current !== null
    ) {
      clearTimeout(
        debounceTimerRef.current,
      );

      debounceTimerRef.current = null;
    }

    if (
      lookupAbortControllerRef.current !==
      null
    ) {
      lookupAbortControllerRef.current.abort();

      lookupAbortControllerRef.current =
        null;
    }

    setInputValue(
      patient.displayName,
    );

    setResults([]);
    setIsOpen(false);
    setIsLoading(false);

    onPatientChange(
      patient.id,
      patient.displayName,
    );
  }

  function handleClear() {
    if (
      debounceTimerRef.current !== null
    ) {
      clearTimeout(
        debounceTimerRef.current,
      );

      debounceTimerRef.current = null;
    }

    if (
      lookupAbortControllerRef.current !==
      null
    ) {
      lookupAbortControllerRef.current.abort();

      lookupAbortControllerRef.current =
        null;
    }

    setInputValue("");
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);

    onPatientChange("", "");
  }

  /*
   * Cancel timers and requests when the component unmounts.
   */
  useEffect(() => {
    return () => {
      if (
        debounceTimerRef.current !== null
      ) {
        clearTimeout(
          debounceTimerRef.current,
        );
      }

      if (
        lookupAbortControllerRef.current !==
        null
      ) {
        lookupAbortControllerRef.current.abort();
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
        onFocus={() => {
          if (
            isEnabled &&
            inputValue.trim() !== ""
          ) {
            setIsOpen(true);
          }
        }}
        disabled={!isEnabled}
        placeholder={
          isEnabled
            ? "Search patients…"
            : "Select another filter first"
        }
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={
          isEnabled && isOpen
        }
        aria-controls="patient-filter-results"
        autoComplete="off"
      />

      {patientId !== "" && (
        <button
          type="button"
          onClick={handleClear}
          disabled={!isEnabled}
        >
          Clear
        </button>
      )}

      {isEnabled &&
        isOpen &&
        isLoading && (
          <p role="status">
            Searching patients…
          </p>
        )}

      {isEnabled &&
        isOpen &&
        !isLoading &&
        results.length > 0 && (
          <ul
            id="patient-filter-results"
            role="listbox"
          >
            {results.map((patient) => (
              <li
                key={patient.id}
                role="option"
                aria-selected={
                  patient.id === patientId
                }
              >
                <button
                  type="button"
                  onClick={() =>
                    handleSelect(patient)
                  }
                >
                  {patient.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}

      {isEnabled &&
        isOpen &&
        !isLoading &&
        inputValue.trim() !== "" &&
        results.length === 0 && (
          <p>No matching patients.</p>
        )}
    </div>
  );
}