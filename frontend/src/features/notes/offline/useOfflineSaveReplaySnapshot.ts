import { useSyncExternalStore } from "react";

import {
  offlineSaveReplayCoordinator,
  type OfflineSaveReplayListener,
  type OfflineSaveReplaySnapshot,
} from "./offlineSaveReplay";

export interface OfflineSaveReplayStore {
  getSnapshot: () => OfflineSaveReplaySnapshot;

  subscribe: (
    listener: OfflineSaveReplayListener,
  ) => () => void;
}

export function useOfflineSaveReplaySnapshot(
  store: OfflineSaveReplayStore =
    offlineSaveReplayCoordinator,
): OfflineSaveReplaySnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}