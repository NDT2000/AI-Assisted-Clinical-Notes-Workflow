import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  NOTE_STATUS,
  type NoteStatus,
} from "../../../../domain/noteAttributes";
import {
  getPatientById,
  getPatients,
  type PatientOption,
} from "../../api/getPatients";
import type {
  NoteListFilters,
  NoteSortField,
  SortDirection,
} from "../../utils/noteListSearchParams";

import {
  REVIEWERS,
} from "../../../../mock-data/generateNoteSummary";

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
    event:
      ChangeEvent<HTMLSelectElement>,
  ) {
    const selectedStatuses =
      Array.from(
        event.target
          .selectedOptions,
        option =>
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
      aria-label="Note filters"
    >
      <div>
        <label htmlFor="status-filter">
          Status
        </label>

        <p id="status-filter-help">
          Hold Control or Command to select
          more than one status.
        </p>

        <select
          id="status-filter"
          multiple
          value={filters.statuses}
          aria-describedby="status-filter-help"
          onChange={handleStatusChange}
        >
          {NOTE_STATUS.map(status => (
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
          onChange={event =>
            onReviewerChange(
              event.target.value,
            )
          }
        >
          <option value="">
            All reviewers
          </option>

          {REVIEWERS.map(
            reviewer => (
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
        patientId={filters.patientId}
        filters={filters}
        isEnabled={
          isPatientFilterEnabled
        }
        onPatientChange={
          onPatientChange
        }
      />

      <div>
        <label htmlFor="created-from-filter">
          Created from
        </label>

        <input
          id="created-from-filter"
          type="date"
          value={filters.createdFrom}
          onChange={event =>
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
          onChange={event =>
            onCreatedToChange(
              event.target.value,
            )
          }
        />
      </div>

      <SearchBox
        query={filters.query}
        onQueryChange={
          onQueryChange
        }
      />

      <div>
        <label htmlFor="sort-field">
          Sort by
        </label>

        <select
          id="sort-field"
          value={filters.sortField}
          onChange={event =>
            onSortFieldChange(
              event.target
                .value as
                NoteSortField,
            )
          }
        >
          {SORT_FIELDS.map(field => (
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
          value={
            filters.sortDirection
          }
          onChange={event =>
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
    </section>
  );
}

function SearchBox({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (
    query: string,
  ) => void;
}) {
  const [
    localValue,
    setLocalValue,
  ] = useState(query);

  const debounceTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  useEffect(() => {
    setLocalValue(query);
  }, [query]);

  function handleChange(
    event:
      ChangeEvent<HTMLInputElement>,
  ) {
    const nextValue =
      event.target.value;

    setLocalValue(nextValue);

    if (
      debounceTimerRef.current !==
      null
    ) {
      clearTimeout(
        debounceTimerRef.current,
      );
    }

    debounceTimerRef.current =
      setTimeout(() => {
        onQueryChange(nextValue);
      }, DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (
        debounceTimerRef.current !==
        null
      ) {
        clearTimeout(
          debounceTimerRef.current,
        );
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
        autoComplete="off"
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
  const componentId =
    useId();

  const inputId =
    `${componentId}-patient-filter`;

  const listboxId =
    `${componentId}-patient-results`;

  const helpId =
    `${componentId}-patient-help`;

  const statusId =
    `${componentId}-patient-status`;

  const [
    inputValue,
    setInputValue,
  ] = useState("");

  const [
    results,
    setResults,
  ] =
    useState<PatientOption[]>(
      [],
    );

  const [
    isOpen,
    setIsOpen,
  ] = useState(false);

  const [
    isLoading,
    setIsLoading,
  ] = useState(false);

  const [
    activeIndex,
    setActiveIndex,
  ] = useState(-1);

  const debounceTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const lookupAbortControllerRef =
    useRef<AbortController | null>(
      null,
    );

  const onPatientChangeRef =
    useRef(onPatientChange);

  useEffect(() => {
    onPatientChangeRef.current =
      onPatientChange;
  }, [onPatientChange]);

  useEffect(() => {
    if (patientId === "") {
      setInputValue("");
      return;
    }

    const controller =
      new AbortController();

    async function restorePatientName():
      Promise<void> {
      try {
        const patient =
          await getPatientById(
            patientId,
            controller.signal,
          );

        if (patient === null) {
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
          error instanceof
            DOMException &&
          error.name ===
            "AbortError"
        ) {
          return;
        }
      }
    }

    void restorePatientName();

    return () => {
      controller.abort();
    };
  }, [patientId]);

  useEffect(() => {
    if (isEnabled) {
      return;
    }

    cancelPendingLookup();

    setInputValue("");
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setActiveIndex(-1);

    if (patientId !== "") {
      onPatientChangeRef.current(
        "",
        "",
      );
    }
  }, [
    isEnabled,
    patientId,
  ]);

  useEffect(() => {
    cancelPendingLookup();

    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setActiveIndex(-1);
  }, [
    filters.statuses,
    filters.reviewerId,
    filters.createdFrom,
    filters.createdTo,
  ]);

  function cancelPendingLookup():
    void {
    if (
      debounceTimerRef.current !==
      null
    ) {
      clearTimeout(
        debounceTimerRef.current,
      );

      debounceTimerRef.current =
        null;
    }

    if (
      lookupAbortControllerRef.current !==
      null
    ) {
      lookupAbortControllerRef.current.abort();

      lookupAbortControllerRef.current =
        null;
    }
  }

  async function runLookup(
    query: string,
  ): Promise<void> {
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

      if (
        controller.signal.aborted
      ) {
        return;
      }

      setResults(patients);
      setIsOpen(true);
      setActiveIndex(
        patients.length > 0
          ? 0
          : -1,
      );
    } catch (error) {
      if (
        error instanceof
          DOMException &&
        error.name ===
          "AbortError"
      ) {
        return;
      }

      setResults([]);
      setIsOpen(true);
      setActiveIndex(-1);
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
    event:
      ChangeEvent<HTMLInputElement>,
  ): void {
    if (!isEnabled) {
      return;
    }

    const nextValue =
      event.target.value;

    setInputValue(nextValue);
    cancelPendingLookup();
    setActiveIndex(-1);

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

        void runLookup(
          trimmedValue,
        );
      }, DEBOUNCE_MS);
  }

  function handleSelect(
    patient: PatientOption,
  ): void {
    cancelPendingLookup();

    setInputValue(
      patient.displayName,
    );

    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setActiveIndex(-1);

    onPatientChange(
      patient.id,
      patient.displayName,
    );
  }

  function handleClear(): void {
    cancelPendingLookup();

    setInputValue("");
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setActiveIndex(-1);

    onPatientChange("", "");
  }

  function handleKeyDown(
    event:
      KeyboardEvent<HTMLInputElement>,
  ): void {
    if (!isEnabled) {
      return;
    }

    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
      }

      return;
    }

    if (
      event.key === "ArrowDown"
    ) {
      event.preventDefault();

      if (!isOpen) {
        setIsOpen(true);
      }

      if (results.length > 0) {
        setActiveIndex(
          currentIndex =>
            currentIndex < 0
              ? 0
              : (
                  currentIndex + 1
                ) %
                results.length,
        );
      }

      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      if (!isOpen) {
        setIsOpen(true);
      }

      if (results.length > 0) {
        setActiveIndex(
          currentIndex =>
            currentIndex <= 0
              ? results.length - 1
              : currentIndex - 1,
        );
      }

      return;
    }

    if (
      event.key === "Enter" &&
      isOpen &&
      activeIndex >= 0
    ) {
      const activePatient =
        results[activeIndex];

      if (activePatient) {
        event.preventDefault();
        handleSelect(
          activePatient,
        );
      }
    }
  }

  useEffect(() => {
    return () => {
      cancelPendingLookup();
    };
  }, []);

  const activeOptionId =
    activeIndex >= 0 &&
    results[activeIndex]
      ? `${componentId}-patient-option-${activeIndex}`
      : undefined;

  let statusMessage =
    "";

  if (
    isEnabled &&
    isOpen &&
    isLoading
  ) {
    statusMessage =
      "Searching patients.";
  } else if (
    isEnabled &&
    isOpen &&
    !isLoading &&
    inputValue.trim() !== ""
  ) {
    statusMessage =
      results.length === 0
        ? "No matching patients."
        : `${results.length} ${
            results.length === 1
              ? "patient"
              : "patients"
          } available. Use the Up and Down arrow keys to review the results.`;
  }

  return (
    <div>
      <label htmlFor={inputId}>
        Patient
      </label>

      <p id={helpId}>
        {isEnabled
          ? "Type a patient name. Use the Up and Down arrow keys to move through suggestions and Enter to select."
          : "Select a status, reviewer or date filter before searching for a patient."}
      </p>

      <input
        id={inputId}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
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
        aria-controls={listboxId}
        aria-activedescendant={
          activeOptionId
        }
        aria-describedby={`${helpId} ${statusId}`}
        aria-busy={isLoading}
        autoComplete="off"
      />

      {patientId !== "" && (
        <button
          type="button"
          onClick={handleClear}
          disabled={!isEnabled}
          aria-label="Clear patient filter"
        >
          Clear
        </button>
      )}

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>

      {isEnabled &&
        isOpen &&
        !isLoading &&
        results.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Patient suggestions"
          >
            {results.map(
              (
                patient,
                index,
              ) => (
                <li
                  key={patient.id}
                  role="none"
                >
                  <button
                    id={`${componentId}-patient-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={
                      index ===
                      activeIndex
                    }
                    onMouseDown={event => {
                      event.preventDefault();
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(
                        index,
                      );
                    }}
                    onClick={() =>
                      handleSelect(
                        patient,
                      )
                    }
                  >
                    {
                      patient.displayName
                    }
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
    </div>
  );
}
