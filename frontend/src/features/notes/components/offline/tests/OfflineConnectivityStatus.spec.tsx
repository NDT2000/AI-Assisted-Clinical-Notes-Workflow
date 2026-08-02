import {
  act,
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  OfflineSaveReplayListener,
  OfflineSaveReplaySnapshot,
} from "../../../offline/offlineSaveReplay";
import type {
  OfflineSaveReplayStore,
} from "../../../offline/useOfflineSaveReplaySnapshot";

import {
  OfflineConnectivityStatus,
} from "../OfflineConnectivityStatus";

afterEach(() => {
  cleanup();
});

class TestOfflineSaveReplayStore
  implements OfflineSaveReplayStore {
  private snapshot:
    OfflineSaveReplaySnapshot;

  private readonly listeners =
    new Set<OfflineSaveReplayListener>();

  constructor(
    snapshot:
      OfflineSaveReplaySnapshot,
  ) {
    this.snapshot = snapshot;
  }

  getSnapshot = () =>
    this.snapshot;

  subscribe = (
    listener:
      OfflineSaveReplayListener,
  ) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  update(
    update:
      Partial<OfflineSaveReplaySnapshot>,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      ...update,
    };

    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

function createSnapshot(
  update:
    Partial<OfflineSaveReplaySnapshot> = {},
): OfflineSaveReplaySnapshot {
  return {
    status: "idle",
    isHydrated: true,
    pendingCount: 0,
    currentSequence: null,
    replayedCount: 0,
    retryCount: 0,
    nextRetryDelayMs: null,
    lastError: null,
    blockedConflict: null,
    ...update,
  };
}

function renderStatus(
  store: OfflineSaveReplayStore,
) {
  return render(
    <MemoryRouter>
      <OfflineConnectivityStatus
        store={store}
      />
    </MemoryRouter>,
  );
}

describe(
  "OfflineConnectivityStatus",
  () => {
    it(
      "does not claim all changes are saved before hydration",
      () => {
        const store =
          new TestOfflineSaveReplayStore(
            createSnapshot({
              isHydrated: false,
            }),
          );

        renderStatus(store);

        expect(
          screen.getByRole("status", {
            name: "Connectivity status",
          }),
        ).toHaveTextContent(
          "Checking saved changes",
        );

        expect(
          screen.queryByText(
            "All changes saved",
          ),
        ).not.toBeInTheDocument();
      },
    );

    it(
      "announces queued changes while offline",
      () => {
        const store =
          new TestOfflineSaveReplayStore(
            createSnapshot({
              status: "offline",
              pendingCount: 2,
            }),
          );

        renderStatus(store);

        const status =
          screen.getByRole("status", {
            name: "Connectivity status",
          });

        expect(status).toHaveTextContent(
          "Offline — 2 changes queued",
        );

        expect(status).toHaveAttribute(
          "aria-live",
          "polite",
        );

        expect(status).toHaveAttribute(
          "aria-atomic",
          "true",
        );
      },
    );

    it(
      "announces reconnection replay",
      () => {
        const store =
          new TestOfflineSaveReplayStore(
            createSnapshot({
              status: "replaying",
              pendingCount: 1,
              currentSequence: 4,
            }),
          );

        renderStatus(store);

        expect(
          screen.getByRole("status", {
            name: "Connectivity status",
          }),
        ).toHaveTextContent(
          "Reconnecting — saving 1 change",
        );
      },
    );

    it(
      "links to the note that has a blocked conflict",
      () => {
        const store =
          new TestOfflineSaveReplayStore(
            createSnapshot({
              status:
                "blocked-conflict",
              pendingCount: 1,
              currentSequence: 7,
              blockedConflict: {
                sequence: 7,
                kind:
                  "save-note-version",
                noteId:
                  "note with spaces",
                actor: {
                  id: "reviewer-1",
                  displayName:
                    "Reviewer One",
                  role: "REVIEWER",
                },
                request: {
                  baseVersionId:
                    "version-1",
                  clientMutationId:
                    "mutation-1",
                  content: {
                    subjective:
                      "Subjective",
                    objective:
                      "Objective",
                    assessment:
                      "Assessment",
                    plan: "Plan",
                  },
                },
                queuedAt: 1,
                state:
                  "blocked-conflict",
                retryCount: 0,
                lastAttemptAt: 2,
                lastError:
                  "Version conflict",
                conflict: null,
              },
            }),
          );

        renderStatus(store);

        expect(
          screen.getByRole("status", {
            name: "Connectivity status",
          }),
        ).toHaveTextContent(
          "Conflict requires attention",
        );

        expect(
          screen.getByRole("link", {
            name: "Open note to resolve",
          }),
        ).toHaveAttribute(
          "href",
          "/notes/note%20with%20spaces",
        );
      },
    );

    it(
      "shows all changes saved only after hydration with an empty queue",
      () => {
        const store =
          new TestOfflineSaveReplayStore(
            createSnapshot(),
          );

        renderStatus(store);

        expect(
          screen.getByRole("status", {
            name: "Connectivity status",
          }),
        ).toHaveTextContent(
          "All changes saved",
        );
      },
    );

    it(
      "updates when the replay store changes",
      () => {
        const store =
          new TestOfflineSaveReplayStore(
            createSnapshot({
              status: "offline",
              pendingCount: 1,
            }),
          );

        renderStatus(store);

        expect(
          screen.getByRole("status", {
            name: "Connectivity status",
          }),
        ).toHaveTextContent(
          "Offline — 1 change queued",
        );

        act(() => {
          store.update({
            status: "idle",
            pendingCount: 0,
          });
        });

        expect(
          screen.getByRole("status", {
            name: "Connectivity status",
          }),
        ).toHaveTextContent(
          "All changes saved",
        );
      },
    );

    it(
      "preserves queued status after a component remount",
      () => {
        const store =
          new TestOfflineSaveReplayStore(
            createSnapshot({
              status: "offline",
              pendingCount: 3,
            }),
          );

        const firstRender =
          renderStatus(store);

        expect(
          screen.getByRole("status", {
            name: "Connectivity status",
          }),
        ).toHaveTextContent(
          "Offline — 3 changes queued",
        );

        firstRender.unmount();

        renderStatus(store);

        expect(
          screen.getByRole("status", {
            name: "Connectivity status",
          }),
        ).toHaveTextContent(
          "Offline — 3 changes queued",
        );
      },
    );
  },
);