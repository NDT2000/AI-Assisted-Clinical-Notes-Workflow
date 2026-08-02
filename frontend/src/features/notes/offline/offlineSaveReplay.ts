import { saveNoteVersion } from "../api/saveNoteVersion";

import {
  getOldestQueuedSave,
  recordSaveAttemptFailure,
  removeQueuedSave,
  type PersistedQueuedNoteVersionSave,
} from "./offlineRepository";

export type OfflineSaveReplayStatus =
  | "idle"
  | "offline"
  | "replaying"
  | "paused-error";

export interface OfflineSaveReplaySnapshot {
  status: OfflineSaveReplayStatus;
  currentSequence: number | null;
  replayedCount: number;
  lastError: string | null;
}

export type OfflineSaveReplayListener = (
  snapshot: OfflineSaveReplaySnapshot,
) => void;

interface OfflineReplayEventTarget {
  addEventListener(
    type: "online" | "offline",
    listener: EventListener,
  ): void;

  removeEventListener(
    type: "online" | "offline",
    listener: EventListener,
  ): void;
}

export interface OfflineSaveReplayDependencies {
  getOldestQueuedSave: () => Promise<
    PersistedQueuedNoteVersionSave | null
  >;

  removeQueuedSave: (
    sequence: number,
  ) => Promise<void>;

  recordSaveAttemptFailure: typeof recordSaveAttemptFailure;

  saveNoteVersion: typeof saveNoteVersion;

  isOnline: () => boolean;

  eventTarget: OfflineReplayEventTarget | null;
}

function createDefaultDependencies(): OfflineSaveReplayDependencies {
  return {
    getOldestQueuedSave,
    removeQueuedSave,
    recordSaveAttemptFailure,
    saveNoteVersion,

    isOnline: () =>
      typeof navigator === "undefined" ||
      navigator.onLine !== false,

    eventTarget:
      typeof window === "undefined"
        ? null
        : window,
  };
}

function isAbortError(
  error: unknown,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function getErrorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return "The queued save could not be replayed.";
}

export class OfflineSaveReplayCoordinator {
  private readonly dependencies:
    OfflineSaveReplayDependencies;

  private readonly listeners =
    new Set<OfflineSaveReplayListener>();

  private snapshot: OfflineSaveReplaySnapshot;

  private started = false;

  private currentReplay:
    | Promise<void>
    | null = null;

  private activeAbortController:
    | AbortController
    | null = null;

  private replayAfterCurrentRun = false;

  constructor(
    overrides: Partial<OfflineSaveReplayDependencies> = {},
  ) {
    this.dependencies = {
      ...createDefaultDependencies(),
      ...overrides,
    };

    this.snapshot = {
      status: this.dependencies.isOnline()
        ? "idle"
        : "offline",
      currentSequence: null,
      replayedCount: 0,
      lastError: null,
    };
  }

  getSnapshot =
    (): OfflineSaveReplaySnapshot =>
      this.snapshot;

  subscribe = (
    listener: OfflineSaveReplayListener,
  ): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    this.dependencies.eventTarget?.addEventListener(
      "online",
      this.handleOnline,
    );

    this.dependencies.eventTarget?.addEventListener(
      "offline",
      this.handleOffline,
    );

    if (!this.dependencies.isOnline()) {
      this.updateSnapshot({
        status: "offline",
        currentSequence: null,
      });

      return;
    }

    void this.replay();
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.replayAfterCurrentRun = false;

    this.dependencies.eventTarget?.removeEventListener(
      "online",
      this.handleOnline,
    );

    this.dependencies.eventTarget?.removeEventListener(
      "offline",
      this.handleOffline,
    );

    this.activeAbortController?.abort();
    this.activeAbortController = null;
  }

  replay(): Promise<void> {
    if (!this.dependencies.isOnline()) {
      this.updateSnapshot({
        status: "offline",
        currentSequence: null,
      });

      return Promise.resolve();
    }

    if (this.currentReplay !== null) {
      return this.currentReplay;
    }

    const abortController =
      new AbortController();

    this.activeAbortController =
      abortController;

    const replayOperation =
      this.runReplayLoop(
        abortController.signal,
      );

    this.currentReplay =
      replayOperation.finally(() => {
        if (
          this.activeAbortController ===
          abortController
        ) {
          this.activeAbortController = null;
        }

        this.currentReplay = null;

        const shouldReplayAgain =
          this.replayAfterCurrentRun;

        this.replayAfterCurrentRun = false;

        if (
          shouldReplayAgain &&
          this.started &&
          this.dependencies.isOnline()
        ) {
          void this.replay();
        }
      });

    return this.currentReplay;
  }

  private readonly handleOnline:
    EventListener = () => {
      if (this.currentReplay !== null) {
        this.replayAfterCurrentRun = true;
        return;
      }

      void this.replay();
    };

  private readonly handleOffline:
    EventListener = () => {
      this.replayAfterCurrentRun = false;

      this.activeAbortController?.abort();
      this.activeAbortController = null;

      this.updateSnapshot({
        status: "offline",
        currentSequence: null,
      });
    };

  private async runReplayLoop(
    signal: AbortSignal,
  ): Promise<void> {
    this.updateSnapshot({
      status: "replaying",
      currentSequence: null,
      lastError: null,
    });

    while (!signal.aborted) {
      if (!this.dependencies.isOnline()) {
        this.updateSnapshot({
          status: "offline",
          currentSequence: null,
        });

        return;
      }

      const entry =
        await this.dependencies
          .getOldestQueuedSave();

      if (signal.aborted) {
        return;
      }

      if (entry === null) {
        this.updateSnapshot({
          status: "idle",
          currentSequence: null,
          lastError: null,
        });

        return;
      }

      this.updateSnapshot({
        status: "replaying",
        currentSequence: entry.sequence,
        lastError: null,
      });

      try {
        await this.dependencies
          .saveNoteVersion(
            entry.noteId,
            entry.actor,
            entry.request,
            signal,
          );

        if (signal.aborted) {
          return;
        }

        await this.dependencies
          .removeQueuedSave(
            entry.sequence,
          );

        this.updateSnapshot({
          status: "replaying",
          currentSequence: null,
          replayedCount:
            this.snapshot.replayedCount + 1,
          lastError: null,
        });
      } catch (error) {
        if (
          signal.aborted ||
          isAbortError(error)
        ) {
          return;
        }

        const errorMessage =
          getErrorMessage(error);

        await this.dependencies
          .recordSaveAttemptFailure(
            entry.sequence,
            errorMessage,
          );

        this.updateSnapshot({
          status: "paused-error",
          currentSequence:
            entry.sequence,
          lastError: errorMessage,
        });

        return;
      }
    }
  }

  private updateSnapshot(
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

export const offlineSaveReplayCoordinator =
  new OfflineSaveReplayCoordinator();