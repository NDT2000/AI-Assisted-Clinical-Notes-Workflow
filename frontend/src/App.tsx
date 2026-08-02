import {
  useEffect,
} from "react";
import {
  Route,
  Routes,
} from "react-router-dom";

import "./App.css";

import {
  CurrentActorProvider,
} from "./auth/CurrentActorContext";
import {
  CurrentActorSwitcher,
} from "./auth/CurrentActorSwitcher";
import {
  OfflineConnectivityStatus,
} from "./features/notes/components/offline/OfflineConnectivityStatus";
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

function AppContent() {
  useEffect(() => {
    if (
      typeof indexedDB !==
      "undefined"
    ) {
      offlineSaveReplayCoordinator.start();
    }

    mockRealtimePresenceService.start();

    return () => {
      if (
        typeof indexedDB !==
        "undefined"
      ) {
        offlineSaveReplayCoordinator.stop();
      }

      mockRealtimePresenceService.stop();
    };
  }, []);

  return (
    <>
      <TelemetryLifecycle />

      <CurrentActorSwitcher />

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

function App() {
  return (
    <CurrentActorProvider>
      <AppContent />
    </CurrentActorProvider>
  );
}

export default App;
