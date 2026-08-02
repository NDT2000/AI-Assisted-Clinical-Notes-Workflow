import {
  useEffect,
  useRef,
} from "react";
import {
  useLocation,
} from "react-router-dom";

import {
  telemetryClient,
  track,
} from "./telemtry";

function getCurrentRoute(
  pathname: string,
  search: string,
): string {
  return `${pathname}${search}`;
}

export function TelemetryLifecycle() {
  const location = useLocation();

  const previousRouteRef =
    useRef<string | null>(
      null,
    );

  useEffect(() => {
    telemetryClient.start();

    track(
      "application.started",
      {
        feature: "clinical_notes",
        source: "browser",
      },
      {
        important: true,
      },
    );

    const handleVisibilityChange =
      (): void => {
        if (
          document.visibilityState ===
          "hidden"
        ) {
          void telemetryClient.flush(
            "visibility-hidden",
          );
        }
      };

    const handlePageUnload =
      (): void => {
        void telemetryClient
          .flushOnUnload();
      };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    window.addEventListener(
      "pagehide",
      handlePageUnload,
    );

    window.addEventListener(
      "beforeunload",
      handlePageUnload,
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );

      window.removeEventListener(
        "pagehide",
        handlePageUnload,
      );

      window.removeEventListener(
        "beforeunload",
        handlePageUnload,
      );

      telemetryClient.stop();
    };
  }, []);

  useEffect(() => {
    const route =
      getCurrentRoute(
        location.pathname,
        location.search,
      );

    const previousRoute =
      previousRouteRef.current;

    if (previousRoute === null) {
      track(
        "navigation.route_view",
        {
          route,
          screen:
            location.pathname.startsWith(
              "/notes/",
            )
              ? "note_detail"
              : "notes_list",
        },
      );

      previousRouteRef.current =
        route;

      return;
    }

    if (previousRoute === route) {
      return;
    }

    track(
      "navigation.route_change",
      {
        previousRoute,
        route,
        screen:
          location.pathname.startsWith(
            "/notes/",
          )
            ? "note_detail"
            : "notes_list",
      },
    );

    previousRouteRef.current =
      route;

    void telemetryClient.flush(
      "route-change",
    );
  }, [
    location.pathname,
    location.search,
  ]);

  return null;
}
