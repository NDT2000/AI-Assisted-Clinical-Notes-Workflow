import {
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";

const DEBOUNCE_MS = 400;

interface NotesSearchBoxProps {
  query: string;
  onQueryChange: (
    query: string,
  ) => void;
}

/*
 * A debounced search input. The URL stores the trimmed query, so an
 * incoming query only replaces what the user typed when it differs
 * after trimming; otherwise "john " would lose its trailing space
 * mid-typing.
 */
export function NotesSearchBox({
  query,
  onQueryChange,
}: NotesSearchBoxProps) {
  const [
    localValue,
    setLocalValue,
  ] = useState(query);

  const [
    syncedQuery,
    setSyncedQuery,
  ] = useState(query);

  if (query !== syncedQuery) {
    setSyncedQuery(query);

    if (query !== localValue.trim()) {
      setLocalValue(query);
    }
  }

  const debounceTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

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
