import {
  useEffect,
  useState,
} from "react";
import {
  Route,
  Routes,
} from "react-router-dom";

import {
  AppHeader,
} from "./app/AppHeader";
import {
  RequireSignIn,
} from "./auth/RequireSignIn";
import {
  session,
} from "./auth/session";
import {
  SetPasswordPage,
} from "./auth/SetPasswordPage";
import {
  SignInPage,
} from "./auth/SignInPage";
import {
  useCurrentActor,
} from "./auth/useCurrentActor";
import {
  OfflineConnectivityStatus,
} from "./features/notes/components/offline/OfflineConnectivityStatus";
import {
  claimOfflineStorage,
} from "./features/notes/offline/offlineOwner";
import {
  offlineSaveReplayCoordinator,
} from "./features/notes/offline/offlineSaveReplay";
import {
  NoteDetailPage,
} from "./features/notes/pages/NoteDetailPage";
import {
  NotesPage,
} from "./features/notes/pages/NotesPage";
import {
  mockRealtimePresenceService,
} from "./features/notes/realtime/mockRealtimePresenceService";
import {
  TelemetryLifecycle,
} from "./telemetry/TelemetryLifecycle";

const HAS_OFFLINE_STORAGE =
  typeof indexedDB !== "undefined";

/*
 * The app for one signed-in user. Before anything reads the offline
 * storage, storage left by a different user on this browser is cleared;
 * only then are queued saves sent, always as this user.
 */
function SignedInApp({
  userId,
}: {
  userId: string;
}) {
  const [isReady, setIsReady] =
    useState(!HAS_OFFLINE_STORAGE);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (HAS_OFFLINE_STORAGE) {
        try {
          if (
            await claimOfflineStorage(
              userId,
            )
          ) {
            offlineSaveReplayCoordinator.reset();
          }
        } catch {
          // Unreadable storage: nothing of another user's can be shown.
        }
      }

      if (cancelled) {
        return;
      }

      if (HAS_OFFLINE_STORAGE) {
        offlineSaveReplayCoordinator.start();
      }

      mockRealtimePresenceService.start();
      setIsReady(true);
    }

    void start();

    return () => {
      cancelled = true;

      if (HAS_OFFLINE_STORAGE) {
        offlineSaveReplayCoordinator.stop();
      }

      mockRealtimePresenceService.stop();
    };
  }, [userId]);

  if (!isReady) {
    return (
      <main className="auth-page">
        <p role="status">Loading…</p>
      </main>
    );
  }

  return (
    <>
      <TelemetryLifecycle />

      <AppHeader />

      <OfflineConnectivityStatus />

      <Routes>
        <Route
          path="/"
          element={
            <NotesPage />
          }
        />

        <Route
          path="/notes"
          element={
            <NotesPage />
          }
        />

        <Route
          path="/notes/:noteId"
          element={
            <NoteDetailPage />
          }
        />
      </Routes>
    </>
  );
}

function SignedInRoutes() {
  const { actor } =
    useCurrentActor();

  // A different user (signed in from another tab) gets a fresh app.
  return (
    <SignedInApp
      key={actor.id}
      userId={actor.id}
    />
  );
}

function App() {
  useEffect(() => {
    // Resume the session from the renewal cookie, if there is one.
    void session.start();
  }, []);

  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          <SignInPage />
        }
      />

      <Route
        path="/set-password"
        element={
          <SetPasswordPage />
        }
      />

      <Route
        path="*"
        element={
          <RequireSignIn>
            <SignedInRoutes />
          </RequireSignIn>
        }
      />
    </Routes>
  );
}

export default App;
