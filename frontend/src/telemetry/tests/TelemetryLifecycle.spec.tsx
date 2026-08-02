import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  useNavigate,
} from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  telemetryClient,
} from "../telemetry";
import {
  TelemetryLifecycle,
} from "../TelemetryLifecycle";

interface TelemetrySpies {
  start: MockInstance;
  stop: MockInstance;
  flush: MockInstance;
  flushOnUnload: MockInstance;
  track: MockInstance;
}

let telemetrySpies:
  TelemetrySpies;

function LifecycleHarness() {
  const navigate =
    useNavigate();

  return (
    <>
      <TelemetryLifecycle />

      <button
        type="button"
        onClick={() => {
          navigate(
            "/notes/note-2?patient=Alice",
          );
        }}
      >
        Open another note
      </button>
    </>
  );
}

function setVisibilityState(
  value:
    DocumentVisibilityState,
): void {
  Object.defineProperty(
    document,
    "visibilityState",
    {
      configurable: true,
      value,
    },
  );
}

describe(
  "TelemetryLifecycle",
  () => {
    beforeEach(() => {
      setVisibilityState(
        "visible",
      );

      telemetrySpies = {
        start:
          vi.spyOn(
            telemetryClient,
            "start",
          ).mockImplementation(
            () => undefined,
          ),

        stop:
          vi.spyOn(
            telemetryClient,
            "stop",
          ).mockImplementation(
            () => undefined,
          ),

        flush:
          vi.spyOn(
            telemetryClient,
            "flush",
          ).mockResolvedValue(
            undefined,
          ),

        flushOnUnload:
          vi.spyOn(
            telemetryClient,
            "flushOnUnload",
          ).mockResolvedValue(
            undefined,
          ),

        track:
          vi.spyOn(
            telemetryClient,
            "track",
          ).mockImplementation(
            () => undefined,
          ),
      };
    });

    afterEach(() => {
      cleanup();

      vi.restoreAllMocks();

      setVisibilityState(
        "visible",
      );
    });

    it(
      "starts telemetry and tracks the initial route",
      async () => {
        render(
          <MemoryRouter
            initialEntries={[
              "/notes/note-1?patient=Alice",
            ]}
          >
            <LifecycleHarness />
          </MemoryRouter>,
        );

        await waitFor(() => {
          expect(
            telemetrySpies.start,
          ).toHaveBeenCalledTimes(
            1,
          );
        });

        expect(
          telemetrySpies.track,
        ).toHaveBeenCalledWith(
          "application.started",
          {
            feature:
              "clinical_notes",
            source: "browser",
          },
          {
            important: true,
          },
        );

        expect(
          telemetrySpies.track,
        ).toHaveBeenCalledWith(
          "navigation.route_view",
          {
            route:
              "/notes/note-1?patient=Alice",
            screen:
              "note_detail",
          },
          {},
        );
      },
    );

    it(
      "flushes after a route change",
      async () => {
        render(
          <MemoryRouter
            initialEntries={[
              "/notes",
            ]}
          >
            <LifecycleHarness />
          </MemoryRouter>,
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Open another note",
            },
          ),
        );

        await waitFor(() => {
          expect(
            telemetrySpies.track,
          ).toHaveBeenCalledWith(
            "navigation.route_change",
            {
              previousRoute:
                "/notes",
              route:
                "/notes/note-2?patient=Alice",
              screen:
                "note_detail",
            },
            {},
          );
        });

        expect(
          telemetrySpies.flush,
        ).toHaveBeenCalledWith(
          "route-change",
        );
      },
    );

    it(
      "flushes when the document becomes hidden",
      async () => {
        render(
          <MemoryRouter
            initialEntries={[
              "/notes",
            ]}
          >
            <LifecycleHarness />
          </MemoryRouter>,
        );

        setVisibilityState(
          "hidden",
        );

        act(() => {
          document.dispatchEvent(
            new Event(
              "visibilitychange",
            ),
          );
        });

        await waitFor(() => {
          expect(
            telemetrySpies.flush,
          ).toHaveBeenCalledWith(
            "visibility-hidden",
          );
        });
      },
    );

    it(
      "uses unload delivery for pagehide and beforeunload",
      async () => {
        render(
          <MemoryRouter
            initialEntries={[
              "/notes",
            ]}
          >
            <LifecycleHarness />
          </MemoryRouter>,
        );

        act(() => {
          window.dispatchEvent(
            new Event(
              "pagehide",
            ),
          );

          window.dispatchEvent(
            new Event(
              "beforeunload",
            ),
          );
        });

        await waitFor(() => {
          expect(
            telemetrySpies
              .flushOnUnload,
          ).toHaveBeenCalledTimes(
            2,
          );
        });
      },
    );

    it(
      "removes listeners and stops telemetry on unmount",
      async () => {
        const result = render(
          <MemoryRouter
            initialEntries={[
              "/notes",
            ]}
          >
            <LifecycleHarness />
          </MemoryRouter>,
        );

        await waitFor(() => {
          expect(
            telemetrySpies.start,
          ).toHaveBeenCalledTimes(
            1,
          );
        });

        result.unmount();

        expect(
          telemetrySpies.stop,
        ).toHaveBeenCalledTimes(
          1,
        );

        telemetrySpies.flush
          .mockClear();

        telemetrySpies
          .flushOnUnload
          .mockClear();

        setVisibilityState(
          "hidden",
        );

        act(() => {
          document.dispatchEvent(
            new Event(
              "visibilitychange",
            ),
          );

          window.dispatchEvent(
            new Event(
              "pagehide",
            ),
          );
        });

        expect(
          telemetrySpies.flush,
        ).not.toHaveBeenCalled();

        expect(
          telemetrySpies
            .flushOnUnload,
        ).not.toHaveBeenCalled();
      },
    );
  },
);