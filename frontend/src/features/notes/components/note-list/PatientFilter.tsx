import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  getPatientById,
  getPatients,
  type PatientOption,
} from "../../api/getPatients";
import type {
  NoteListFilters,
} from "../../utils/noteListSearchParams";

const DEBOUNCE_MS = 400;

export function PatientFilter({
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

  /*
   * The name shown for the selected patient. When the selection is
   * cleared from outside (another filter changed, browser back), the
   * input is cleared only if it still shows that name, so text the
   * user is typing is never wiped.
   */
  const [
    selectedName,
    setSelectedName,
  ] = useState<string | null>(null);

  const [
    previousPatientId,
    setPreviousPatientId,
  ] = useState(patientId);

  if (patientId !== previousPatientId) {
    setPreviousPatientId(patientId);

    if (patientId === "") {
      if (
        selectedName !== null &&
        inputValue === selectedName
      ) {
        setInputValue("");
      }

      setSelectedName(null);
    }
  }

  const [
    previousEnabled,
    setPreviousEnabled,
  ] = useState(isEnabled);

  if (isEnabled !== previousEnabled) {
    setPreviousEnabled(isEnabled);

    if (!isEnabled) {
      setInputValue("");
      setSelectedName(null);
      resetLookupState();
    }
  }

  // Suggestions are scoped by the other filters, so they go stale
  // when those change.
  const lookupContextKey = [
    filters.statuses.join(","),
    filters.reviewerId,
    filters.createdFrom,
    filters.createdTo,
  ].join("|");

  const [
    previousLookupContextKey,
    setPreviousLookupContextKey,
  ] = useState(lookupContextKey);

  if (
    lookupContextKey !==
    previousLookupContextKey
  ) {
    setPreviousLookupContextKey(
      lookupContextKey,
    );
    resetLookupState();
  }

  function resetLookupState() {
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setHasLookupError(false);
    setActiveIndex(-1);
  }

  useEffect(() => {
    if (patientId === "") {
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
        setSelectedName(
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

    if (patientId !== "") {
      onPatientChangeRef.current(
        "",
        "",
      );
    }
  }, [isEnabled, patientId]);

  useEffect(() => {
    cancelPendingLookup();
  }, [lookupContextKey]);

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
    setSelectedName(
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
    setSelectedName(null);
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
