import { act, cleanup, fireEvent, render, screen, waitFor, } from "@testing-library/react";
import { MemoryRouter, Route, Routes, } from "react-router-dom";
import { afterEach, describe, expect, it, vi, } from "vitest";

import type { NoteSummary, } from "../../../../domain/noteSummary";
import type { NoteListResponse, } from "../../api/noteListResponse";
import { getNotes } from "../../api/getNotes";

vi.mock(
  "@tanstack/react-virtual",
  () => ({
    useVirtualizer: ({
      count,
    }: {
      count: number;
    }) => ({
      getVirtualItems: () =>
        Array.from(
          { length: count },
          (_, index) => ({
            key: index,
            index,
            start: index * 44,
            size: 44,
            end: (index + 1) * 44,
            lane: 0,
          }),
        ),

      getTotalSize: () =>
        count * 44,

      measureElement: () =>
        undefined,

      scrollToIndex: () =>
        undefined,
    }),
  }),
);

import { NotesPage } from "../NotesPage";

const getNotesMock =
  vi.mocked(getNotes);

vi.mock("../../api/getNotes", () => ({
  getNotes: vi.fn(),
}));

vi.mock(
  "../components/NotesFilters",
  () => ({
    NotesFilters: ({
      onQueryChange,
    }: {
      onQueryChange: (
        query: string,
      ) => void;
    }) => (
      <button
        type="button"
        onClick={() =>
          onQueryChange("new query")
        }
      >
        Change query
      </button>
    ),
  }),
);

vi.mock(
  "../components/NoteTable",
  () => ({
    NotesTable: ({
      notes,
    }: {
      notes: NoteSummary[];
    }) => (
      <div aria-label="Mock notes table">
        {notes.map((note) => (
          <p key={note.id}>
            {note.patient.displayName}
          </p>
        ))}
      </div>
    ),
  }),
);

vi.mock(
  "../components/NotesTableSkeleton",
  () => ({
    NotesTableSkeleton: () => (
      <p>Loading notes…</p>
    ),
  }),
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>(
    (
      promiseResolve,
      promiseReject,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return {
    promise,
    resolve,
    reject,
  };
}

function createNote(
  id: string,
  patientName: string,
): NoteSummary {
  return {
    id,

    patient: {
      id: `patient-${id}`,
      displayName: patientName,
    },

    status: "FAILED",

    assignedReviewer: null,

    currentVersion: {
      id: `version-${id}`,
      revision: 1,
    },

    contentPreview:
      `${patientName} note content`,

    createdAt:
      "2026-01-01T12:00:00.000Z",

    updatedAt:
      "2026-01-01T13:00:00.000Z",
  };
}

function createResponse(
  note: NoteSummary,
): NoteListResponse {
  return {
    items: [note],
    cursor: {
      next: null,
      hasMore: false,
    },
    meta: {
      total: 1,
      returned: 1,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe(
  "NotesPage request cancellation",
  () => {
    it(
      "aborts the previous request and ignores its stale response",
      async () => {
        const oldRequest =
          createDeferred<NoteListResponse>();

        const newRequest =
          createDeferred<NoteListResponse>();

        vi.mocked(getNotes)
          .mockReturnValueOnce(oldRequest.promise,)
          .mockReturnValueOnce(newRequest.promise,);

        render(
          <MemoryRouter
            initialEntries={[
              "/notes?q=old+query",
            ]}
          >
            <Routes>
              <Route
                path="/notes"
                element={<NotesPage />}
              />
            </Routes>
          </MemoryRouter>,
        );

        await waitFor(() => {
          expect(getNotes).toHaveBeenCalledTimes(
            1,
          );
        });

        const firstSignal =
          vi.mocked(getNotes).mock.calls[0][2];

        if (firstSignal === undefined) {
            throw new Error(
                "Expected the first getNotes call to contain an AbortSignal.",
            );
        }
        expect(
          firstSignal.aborted,
        ).toBe(false);

        fireEvent.change(
          screen.getByRole("searchbox", {
            name: /search patient or note content/i,
          }),
          {
            target: {
              value: "new query",
            },
          },
        );
        await waitFor(
          () => {
            expect(
              getNotesMock,
            ).toHaveBeenCalledTimes(2);
          },
          {
            timeout: 1500,
          },
        );

        await waitFor(() => {
          expect(getNotes).toHaveBeenCalledTimes(
            2,
          );
        });

        expect(
          firstSignal.aborted,
        ).toBe(true);

        const newNote = createNote(
          "new",
          "New Patient",
        );

        await act(async () => {
          newRequest.resolve(
            createResponse(newNote),
          );

          await newRequest.promise;
        });

        expect(
          await screen.findByText(
            "New Patient",
          ),
        ).toBeInTheDocument();

        const oldNote = createNote(
          "old",
          "Old Patient",
        );

        await act(async () => {
          oldRequest.resolve(
            createResponse(oldNote),
          );

          await oldRequest.promise;
        });

        expect(
          screen.getByText("New Patient"),
        ).toBeInTheDocument();

        expect(
          screen.queryByText("Old Patient"),
        ).not.toBeInTheDocument();
      },
    );
  },
);