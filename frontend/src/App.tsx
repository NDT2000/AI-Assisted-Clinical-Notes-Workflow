import {
  useEffect,
} from "react";
import {
  Route,
  Routes,
} from "react-router-dom";

import "./App.css";

import {
  OfflineConnectivityStatus,
} from "./features/notes/components/offline/OfflineConnectivityStatus";
import {
  offlineSaveReplayCoordinator,
} from "./features/notes/offline/offlineSaveReplay";
import {
  mockRealtimePresenceService,
} from "./features/notes/realtime/mockRealtimePresenceService";
import {
  NoteDetailPage,
} from "./features/notes/pages/NoteDetailPage";
import {
  NotesPage,
} from "./features/notes/pages/NotesPage";

function App() {
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

export default App;
