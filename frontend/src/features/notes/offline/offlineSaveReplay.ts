import {
  SaveNoteVersionRequestError,
  saveNoteVersion,
} from "../api/saveNoteVersion";

import {
  getOldestQueuedSave,
  recordSaveAttemptFailure,
  removeQueuedSave,
  type PersistedQueuedNoteVersionSave,
} from "./offlineRepository";

export const DEFAULT_MAX_REPLAY_RETRIES = 3;

export type OfflineSaveReplayStatus =
  | "idle"
  | "offline"
  | "replaying"
  | "retrying"
  | "paused-error";

export interface OfflineSaveReplaySnapshot {
  status: OfflineSaveReplayStatus;
  currentSequence: number | null;
  replayedCount: number;
  retryCount: number;
  nextRetryDelayMs: number | null;
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

  recordSaveAttemptFailure:
    typeof recordSaveAttemptFailure;

  saveNoteVersion: typeof saveNoteVersion;

  isOnline: () => boolean;

  eventTarget:
    | OfflineReplayEventTarget
    | null;

  sleep: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;

  getRetryDelayMs: (
    retryCount: number,
  ) => number;

  maxRetryCount: number;
}

function createAbortError(): DOMException {
  return new DOMException(
    "The operation was aborted.",
    "AbortError",
  );
}

function sleepWithAbort(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      createAbortError(),
    );
  }

  return new Promise<void>(
    (resolve, reject) => {
      const timeoutId = window.setTimeout(
        () => {
          signal.removeEventListener(
            "abort",
            handleAbort,
          );

          resolve();
        },
        delayMs,
      );

      function handleAbort(): void {
        window.clearTimeout(timeoutId);

        signal.removeEventListener(
          "abort",
          handleAbort,
        );

        reject(createAbortError());
      }

      signal.addEventListener(
        "abort",
        handleAbort,
        {
          once: true,
        },
      );
    },
  );
}

export function getOfflineReplayBackoffDelayMs(
  retryCount: number,
): number {
  const normalizedRetryCount =
    Math.max(1, retryCount);

  return Math.min(
    250 *
      2 **
        (normalizedRetryCount - 1),
    1_000,
  );
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

    sleep: sleepWithAbort,

    getRetryDelayMs:
      getOfflineReplayBackoffDelayMs,

    maxRetryCount:
      DEFAULT_MAX_REPLAY_RETRIES,
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

function isRetryableReplayError(
  error: unknown,
): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (
    error instanceof
    SaveNoteVersionRequestError
  ) {
    return (
      error.status >= 500 ||
      error.code === "internal_error"
    );
  }

  return false;
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

  private snapshot:
    OfflineSaveReplaySnapshot;

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
      status:
        this.dependencies.isOnline()
          ? "idle"
          : "offline",

      currentSequence: null,
      replayedCount: 0,
      retryCount: 0,
      nextRetryDelayMs: null,
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
        nextRetryDelayMs: null,
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
        nextRetryDelayMs: null,
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
        nextRetryDelayMs: null,
      });
    };

  private async runReplayLoop(
    signal: AbortSignal,
  ): Promise<void> {
    this.updateSnapshot({
      status: "replaying",
      currentSequence: null,
      retryCount: 0,
      nextRetryDelayMs: null,
      lastError: null,
    });

    while (!signal.aborted) {
      if (!this.dependencies.isOnline()) {
        this.updateSnapshot({
          status: "offline",
          currentSequence: null,
          nextRetryDelayMs: null,
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
          retryCount: 0,
          nextRetryDelayMs: null,
          lastError: null,
        });

        return;
      }

      this.updateSnapshot({
        status: "replaying",
        currentSequence:
          entry.sequence,
        retryCount:
          entry.retryCount,
        nextRetryDelayMs: null,
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
            this.snapshot.replayedCount +
            1,
          retryCount: 0,
          nextRetryDelayMs: null,
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

        const updatedEntry =
          await this.dependencies
            .recordSaveAttemptFailure(
              entry.sequence,
              errorMessage,
            );

        if (signal.aborted) {
          return;
        }

        if (updatedEntry === null) {
          continue;
        }

        if (
          !this.dependencies.isOnline()
        ) {
          this.updateSnapshot({
            status: "offline",
            currentSequence: null,
            retryCount:
              updatedEntry.retryCount,
            nextRetryDelayMs: null,
            lastError: errorMessage,
          });

          return;
        }

        const shouldRetry =
          isRetryableReplayError(
            error,
          ) &&
          updatedEntry.retryCount <=
            this.dependencies
              .maxRetryCount;

        if (!shouldRetry) {
          this.updateSnapshot({
            status: "paused-error",
            currentSequence:
              updatedEntry.sequence,
            retryCount:
              updatedEntry.retryCount,
            nextRetryDelayMs: null,
            lastError: errorMessage,
          });

          return;
        }

        const retryDelayMs =
          this.dependencies
            .getRetryDelayMs(
              updatedEntry.retryCount,
            );

        this.updateSnapshot({
          status: "retrying",
          currentSequence:
            updatedEntry.sequence,
          retryCount:
            updatedEntry.retryCount,
          nextRetryDelayMs:
            retryDelayMs,
          lastError: errorMessage,
        });

        try {
          await this.dependencies.sleep(
            retryDelayMs,
            signal,
          );
        } catch (sleepError) {
          if (
            signal.aborted ||
            isAbortError(sleepError)
          ) {
            return;
          }

          this.updateSnapshot({
            status: "paused-error",
            currentSequence:
              updatedEntry.sequence,
            retryCount:
              updatedEntry.retryCount,
            nextRetryDelayMs: null,
            lastError:
              getErrorMessage(
                sleepError,
              ),
          });

          return;
        }

        if (signal.aborted) {
          return;
        }

        if (
          !this.dependencies.isOnline()
        ) {
          this.updateSnapshot({
            status: "offline",
            currentSequence: null,
            nextRetryDelayMs: null,
          });

          return;
        }

        this.updateSnapshot({
          status: "replaying",
          currentSequence:
            updatedEntry.sequence,
          retryCount:
            updatedEntry.retryCount,
          nextRetryDelayMs: null,
        });
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