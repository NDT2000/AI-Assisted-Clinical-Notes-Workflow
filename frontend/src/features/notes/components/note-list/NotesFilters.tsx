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
  REVIEWERS,
} from "../../../../mock-data/generateNoteSummary";
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
import "./NotesFilters.css";

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
                  {formatStatus(status)}
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

            {REVIEWERS.map(
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

        <SearchBox
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
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

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
    <div className="notes-filter-field notes-filter-search">
      <label htmlFor="search-filter">
        Search patient or note content
      </label>

      <input
        id="search-filter"
        type="search"
        value={localValue}
        onChange={handleChange}
        placeholder="Search notes…"
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
  const generatedId = useId();

  const listboxId =
    `patient-filter-results-${generatedId}`;

  const helpId =
    `patient-filter-help-${generatedId}`;

  const statusId =
    `patient-filter-status-${generatedId}`;

  const containerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const [
    inputValue,
    setInputValue,
  ] = useState("");

  const [results, setResults] =
    useState<PatientOption[]>([]);

  const [isOpen, setIsOpen] =
    useState(false);

  const [
    isLoading,
    setIsLoading,
  ] = useState(false);

  const [
    hasLookupError,
    setHasLookupError,
  ] = useState(false);

  const [
    activeIndex,
    setActiveIndex,
  ] = useState(-1);

  const debounceTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

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

    async function restorePatientName() {
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
    setHasLookupError(false);
    setActiveIndex(-1);

    if (patientId !== "") {
      onPatientChangeRef.current(
        "",
        "",
      );
    }
  }, [isEnabled, patientId]);

  useEffect(() => {
    cancelPendingLookup();

    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setHasLookupError(false);
    setActiveIndex(-1);
  }, [
    filters.statuses,
    filters.reviewerId,
    filters.createdFrom,
    filters.createdTo,
  ]);

  function cancelPendingLookup() {
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
    setHasLookupError(false);

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
      setActiveIndex(-1);
      setIsOpen(true);
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
      setActiveIndex(-1);
      setHasLookupError(true);
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
    event:
      ChangeEvent<HTMLInputElement>,
  ) {
    if (!isEnabled) {
      return;
    }

    const nextValue =
      event.target.value;

    setInputValue(nextValue);
    setHasLookupError(false);
    setActiveIndex(-1);

    if (patientId !== "") {
      onPatientChange("", "");
    }

    cancelPendingLookup();

    const trimmedValue =
      nextValue.trim();

    if (trimmedValue === "") {
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    setIsOpen(true);
    setIsLoading(true);

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
  ) {
    cancelPendingLookup();

    setInputValue(
      patient.displayName,
    );

    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setHasLookupError(false);
    setActiveIndex(-1);

    onPatientChange(
      patient.id,
      patient.displayName,
    );
  }

  function handleClear() {
    cancelPendingLookup();

    setInputValue("");
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setHasLookupError(false);
    setActiveIndex(-1);

    onPatientChange("", "");
  }

  function handleKeyDown(
    event:
      KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.key === "Escape"
    ) {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (
      results.length === 0
    ) {
      return;
    }

    if (
      event.key === "ArrowDown"
    ) {
      event.preventDefault();

      setIsOpen(true);

      setActiveIndex(
        (currentIndex) =>
          currentIndex >=
          results.length - 1
            ? 0
            : currentIndex + 1,
      );

      return;
    }

    if (
      event.key === "ArrowUp"
    ) {
      event.preventDefault();

      setIsOpen(true);

      setActiveIndex(
        (currentIndex) =>
          currentIndex <= 0
            ? results.length - 1
            : currentIndex - 1,
      );

      return;
    }

    if (
      event.key === "Enter" &&
      activeIndex >= 0
    ) {
      event.preventDefault();

      const patient =
        results[activeIndex];

      if (
        patient !== undefined
      ) {
        handleSelect(patient);
      }
    }
  }

  useEffect(() => {
    return () => {
      cancelPendingLookup();
    };
  }, []);

  const activeOption =
    activeIndex >= 0
      ? results[activeIndex]
      : undefined;

  const activeOptionId =
    activeOption === undefined
      ? undefined
      : `${listboxId}-option-${activeOption.id}`;

  let statusMessage =
    "Type a patient name to search.";

  if (!isEnabled) {
    statusMessage =
      "Select a status, reviewer, or created date first.";
  } else if (isLoading) {
    statusMessage =
      "Searching patients.";
  } else if (
    hasLookupError
  ) {
    statusMessage =
      "Unable to load patient suggestions.";
  } else if (
    isOpen &&
    inputValue.trim() !== "" &&
    results.length === 0
  ) {
    statusMessage =
      "No matching patients.";
  } else if (
    isOpen &&
    results.length > 0
  ) {
    statusMessage =
      `${results.length} matching ` +
      `${results.length === 1
        ? "patient"
        : "patients"} available.`;
  }

  return (
    <div
      ref={containerRef}
      className="notes-filter-field patient-combobox"
      onBlur={() => {
        window.setTimeout(() => {
          const activeElement =
            document.activeElement;

          if (
            containerRef.current !==
              null &&
            activeElement !== null &&
            !containerRef.current.contains(
              activeElement,
            )
          ) {
            setIsOpen(false);
            setActiveIndex(-1);
          }
        }, 0);
      }}
    >
      <label htmlFor="patient-filter">
        Patient
      </label>

      <div className="patient-combobox-input-row">
        <input
          id="patient-filter"
          type="text"
          value={inputValue}
          onChange={
            handleInputChange
          }
          onKeyDown={
            handleKeyDown
          }
          onFocus={() => {
            if (
              isEnabled &&
              inputValue.trim() !==
                "" &&
              (results.length > 0 ||
                isLoading ||
                hasLookupError)
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
          aria-controls={
            listboxId
          }
          aria-activedescendant={
            activeOptionId
          }
          aria-describedby={`${helpId} ${statusId}`}
          autoComplete="off"
        />

        {patientId !== "" && (
          <button
            className="patient-combobox-clear"
            type="button"
            onClick={
              handleClear
            }
            disabled={!isEnabled}
          >
            Clear
          </button>
        )}
      </div>

      <small id={helpId}>
        Use Arrow Up and Arrow Down
        to review suggestions, Enter
        to select, and Escape to close.
      </small>

      <p
        id={statusId}
        className="patient-combobox-status"
        role="status"
        aria-live="polite"
      >
        {statusMessage}
      </p>

      {isEnabled &&
        isOpen && (
          <div
            className="patient-combobox-panel"
            data-state={
              isLoading
                ? "loading"
                : hasLookupError
                  ? "error"
                  : results.length > 0
                    ? "results"
                    : "empty"
            }
          >
            {isLoading && (
              <p>
                Searching patients…
              </p>
            )}

            {!isLoading &&
              hasLookupError && (
              <p>
                Unable to load patient
                suggestions.
              </p>
            )}

            {!isLoading &&
              !hasLookupError &&
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
                  ) => {
                    const isActive =
                      index ===
                      activeIndex;

                    return (
                      <li
                        key={
                          patient.id
                        }
                        role="none"
                      >
                        <button
                          id={`${listboxId}-option-${patient.id}`}
                          type="button"
                          role="option"
                          aria-selected={
                            isActive ||
                            patient.id ===
                              patientId
                          }
                          tabIndex={-1}
                          onMouseDown={(
                            event,
                          ) =>
                            event.preventDefault()
                          }
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
                    );
                  },
                )}
              </ul>
            )}

            {!isLoading &&
              !hasLookupError &&
              inputValue.trim() !==
                "" &&
              results.length ===
                0 && (
              <p>
                No matching patients.
              </p>
            )}
          </div>
        )}
    </div>
  );
}
