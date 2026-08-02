import type { SoapContent } from "../../../domain/noteAttributes";
import type {
  SaveNoteVersionRequestBody,
  SaveNoteVersionResponse,
} from "../../../domain/noteSave";

import {
  SaveNoteVersionRequestError,
  saveNoteVersion,
} from "../api/saveNoteVersion";

import {
  getOldestQueuedSave,
  getQueuedSaves,
  markSaveConflict,
  recordSaveAttemptFailure,
  removeQueuedSave,
  replaceBlockedSaveWithResolution,
  type PersistedQueuedNoteVersionSave,
} from "./offlineRepository";

export const DEFAULT_MAX_REPLAY_RETRIES = 3;

export type OfflineSaveReplayStatus =
  | "idle"
  | "offline"
  | "replaying"
  | "retrying"
  | "blocked-conflict"
  | "resolving-conflict"
  | "paused-error";

export interface OfflineSaveReplaySnapshot {
  status: OfflineSaveReplayStatus;
  isHydrated: boolean;
  pendingCount: number;
  currentSequence: number | null;
  replayedCount: number;
  retryCount: number;
  nextRetryDelayMs: number | null;
  lastError: string | null;
  blockedConflict: PersistedQueuedNoteVersionSave | null;
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
  getQueuedSaves: typeof getQueuedSaves;
  getOldestQueuedSave: typeof getOldestQueuedSave;
  removeQueuedSave: typeof removeQueuedSave;
  recordSaveAttemptFailure: typeof recordSaveAttemptFailure;
  markSaveConflict: typeof markSaveConflict;
  replaceBlockedSaveWithResolution:
    typeof replaceBlockedSaveWithResolution;
  saveNoteVersion: typeof saveNoteVersion;
  isOnline: () => boolean;
  eventTarget: OfflineReplayEventTarget | null;
  sleep: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
  getRetryDelayMs: (
    retryCount: number,
  ) => number;
  maxRetryCount: number;
  createClientMutationId: () => string;
}

let fallbackMutationCounter = 0;

function createClientMutationId(): string {
  if (
    typeof globalThis.crypto?.randomUUID ===
    "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  fallbackMutationCounter += 1;

  return [
    "offline-resolution",
    Date.now(),
    fallbackMutationCounter,
  ].join("-");
}

function cloneContent(
  content: SoapContent,
): SoapContent {
  return {
    subjective: content.subjective,
    objective: content.objective,
    assessment: content.assessment,
    plan: content.plan,
  };
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
    return Promise.reject(createAbortError());
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener(
        "abort",
        handleAbort,
      );
      resolve();
    }, delayMs);

    function handleAbort(): void {
      globalThis.clearTimeout(timeoutId);
      signal.removeEventListener(
        "abort",
        handleAbort,
      );
      reject(createAbortError());
    }

    signal.addEventListener(
      "abort",
      handleAbort,
      { once: true },
    );
  });
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
    getQueuedSaves,
    getOldestQueuedSave,
    removeQueuedSave,
    recordSaveAttemptFailure,
    markSaveConflict,
    replaceBlockedSaveWithResolution,
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
    createClientMutationId,
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

function isVersionConflictError(
  error: unknown,
): error is SaveNoteVersionRequestError {
  return (
    error instanceof
      SaveNoteVersionRequestError &&
    error.code === "version_conflict"
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

  private hydrated = false;

  private hydrationPromise:
    | Promise<void>
    | null = null;

  private currentReplay:
    | Promise<void>
    | null = null;

  private currentConflictResolution:
    | Promise<SaveNoteVersionResponse | null>
    | null = null;

  private activeAbortController:
    | AbortController
    | null = null;

  private replayAfterCurrentRun = false;

  private replayAfterConflictResolution = false;

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
      isHydrated: false,
      pendingCount: 0,
      currentSequence: null,
      replayedCount: 0,
      retryCount: 0,
      nextRetryDelayMs: null,
      lastError: null,
      blockedConflict: null,
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

    this.runReplayInBackground();
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.replayAfterCurrentRun = false;
    this.replayAfterConflictResolution =
      false;

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

  notifyQueueChanged(): void {
    this.hydrated = false;

    this.updateSnapshot({
      isHydrated: false,
      pendingCount:
        Math.max(
          1,
          this.snapshot.pendingCount,
        ),
    });

    if (!this.started) {
      return;
    }

    if (
      this.currentReplay !== null ||
      this.currentConflictResolution !==
        null
    ) {
      this.replayAfterCurrentRun = true;
      return;
    }

    this.runReplayInBackground();
  }

  replay(): Promise<void> {
    if (
      this.currentConflictResolution !==
      null
    ) {
      return this.currentConflictResolution.then(
        () => undefined,
      );
    }

    if (this.currentReplay !== null) {
      return this.currentReplay;
    }

    const abortController =
      new AbortController();

    this.activeAbortController =
      abortController;

    const operation =
      this.runReplay(
        abortController.signal,
      );

    this.currentReplay =
      operation.finally(() => {
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
          this.dependencies.isOnline() &&
          this.snapshot.blockedConflict ===
            null
        ) {
          this.runReplayInBackground();
        }
      });

    return this.currentReplay;
  }

  resolveBlockedConflict(
    resolvedContent: SoapContent,
  ): Promise<SaveNoteVersionResponse | null> {
    if (
      this.currentConflictResolution !==
      null
    ) {
      return this.currentConflictResolution;
    }

    const blockedEntry =
      this.snapshot.blockedConflict;

    if (
      blockedEntry === null ||
      blockedEntry.conflict === null
    ) {
      return Promise.resolve(null);
    }

    const operation =
      this.runConflictResolution(
        blockedEntry,
        cloneContent(resolvedContent),
      );

    this.currentConflictResolution =
      operation.finally(() => {
        this.currentConflictResolution =
          null;

        const shouldResume =
          this.replayAfterConflictResolution;

        this.replayAfterConflictResolution =
          false;

        if (
          shouldResume &&
          this.started &&
          this.dependencies.isOnline() &&
          this.snapshot.blockedConflict ===
            null
        ) {
          this.runReplayInBackground();
        }
      });

    return this.currentConflictResolution;
  }

  private runReplayInBackground(): void {
    void this.replay().catch(error => {
      this.updateSnapshot({
        status:
          this.dependencies.isOnline()
            ? "paused-error"
            : "offline",
        currentSequence:
          this.snapshot.blockedConflict
            ?.sequence ?? null,
        nextRetryDelayMs: null,
        lastError:
          getErrorMessage(error),
      });
    });
  }

  private readonly handleOnline:
    EventListener = () => {
      if (
        this.currentReplay !== null ||
        this.currentConflictResolution !==
          null
      ) {
        this.replayAfterCurrentRun = true;
        return;
      }

      this.runReplayInBackground();
    };

  private readonly handleOffline:
    EventListener = () => {
      this.replayAfterCurrentRun = false;
      this.replayAfterConflictResolution =
        false;

      this.activeAbortController?.abort();
      this.activeAbortController = null;

      this.updateSnapshot({
        status: "offline",
        currentSequence:
          this.snapshot.blockedConflict
            ?.sequence ?? null,
        nextRetryDelayMs: null,
      });
    };

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) {
      return;
    }

    if (this.hydrationPromise !== null) {
      return this.hydrationPromise;
    }

    const operation =
      this.dependencies
        .getQueuedSaves()
        .then(entries => {
          const blockedConflict =
            entries.find(
              entry =>
                entry.state ===
                "blocked-conflict",
            ) ?? null;

          this.hydrated = true;

          this.updateSnapshot({
            isHydrated: true,
            pendingCount:
              entries.length,
            blockedConflict,
            currentSequence:
              blockedConflict?.sequence ??
              null,
            lastError:
              blockedConflict?.conflict
                ?.message ??
              blockedConflict?.lastError ??
              null,
          });
        })
        .finally(() => {
          this.hydrationPromise = null;
        });

    this.hydrationPromise = operation;

    return operation;
  }

  private async runReplay(
    signal: AbortSignal,
  ): Promise<void> {
    await this.ensureHydrated();

    if (signal.aborted) {
      return;
    }

    if (
      this.snapshot.blockedConflict !==
      null
    ) {
      this.updateSnapshot({
        status:
          this.dependencies.isOnline()
            ? "blocked-conflict"
            : "offline",
        currentSequence:
          this.snapshot.blockedConflict
            .sequence,
        nextRetryDelayMs: null,
      });

      return;
    }

    if (!this.dependencies.isOnline()) {
      this.updateSnapshot({
        status: "offline",
        currentSequence: null,
        nextRetryDelayMs: null,
      });

      return;
    }

    await this.runReplayLoop(signal);
  }

  private async runConflictResolution(
    blockedEntry: PersistedQueuedNoteVersionSave,
    resolvedContent: SoapContent,
  ): Promise<SaveNoteVersionResponse | null> {
    if (this.currentReplay !== null) {
      await this.currentReplay;
    }

    const activeBlockedEntry =
      this.snapshot.blockedConflict;

    if (
      activeBlockedEntry === null ||
      activeBlockedEntry.sequence !==
        blockedEntry.sequence ||
      activeBlockedEntry.conflict === null
    ) {
      return null;
    }

    const request:
      SaveNoteVersionRequestBody = {
      baseVersionId:
        activeBlockedEntry.conflict
          .currentVersion.versionId,
      clientMutationId:
        this.dependencies
          .createClientMutationId(),
      content:
        cloneContent(resolvedContent),
    };

    const queuedResolution =
      await this.dependencies
        .replaceBlockedSaveWithResolution({
          sequence:
            activeBlockedEntry.sequence,
          request,
        });

    if (queuedResolution === null) {
      this.updateSnapshot({
        status: "paused-error",
        currentSequence:
          activeBlockedEntry.sequence,
        nextRetryDelayMs: null,
        lastError:
          "The resolved offline save could not be stored.",
      });

      return null;
    }

    this.hydrated = true;

    this.updateSnapshot({
      status: "resolving-conflict",
      currentSequence:
        queuedResolution.sequence,
      retryCount: 0,
      nextRetryDelayMs: null,
      lastError: null,
      blockedConflict: null,
    });

    if (!this.dependencies.isOnline()) {
      this.updateSnapshot({
        status: "offline",
        currentSequence:
          queuedResolution.sequence,
      });

      return null;
    }

    const abortController =
      new AbortController();

    this.activeAbortController =
      abortController;

    try {
      const response =
        await this.dependencies
          .saveNoteVersion(
            queuedResolution.noteId,
            queuedResolution.actor,
            queuedResolution.request,
            abortController.signal,
          );

      if (abortController.signal.aborted) {
        return null;
      }

      await this.dependencies
        .removeQueuedSave(
          queuedResolution.sequence,
        );

      this.replayAfterConflictResolution =
        true;

      this.updateSnapshot({
        status: "idle",
        pendingCount:
          Math.max(
            0,
            this.snapshot.pendingCount - 1,
          ),
        currentSequence: null,
        replayedCount:
          this.snapshot.replayedCount + 1,
        retryCount: 0,
        nextRetryDelayMs: null,
        lastError: null,
        blockedConflict: null,
      });

      return response;
    } catch (error) {
      if (
        abortController.signal.aborted ||
        isAbortError(error)
      ) {
        return null;
      }

      const errorMessage =
        getErrorMessage(error);

      if (
        isVersionConflictError(error) &&
        error.currentVersion !== undefined
      ) {
        const reblockedEntry =
          await this.dependencies
            .markSaveConflict(
              queuedResolution.sequence,
              {
                message: errorMessage,
                currentVersion:
                  error.currentVersion,
                commonAncestor:
                  error.commonAncestor ??
                  null,
              },
            );

        if (reblockedEntry === null) {
          this.updateSnapshot({
            status: "paused-error",
            currentSequence:
              queuedResolution.sequence,
            lastError:
              "The new replay conflict could not be stored.",
          });

          return null;
        }

        this.updateSnapshot({
          status: "blocked-conflict",
          currentSequence:
            reblockedEntry.sequence,
          retryCount:
            reblockedEntry.retryCount,
          nextRetryDelayMs: null,
          lastError: errorMessage,
          blockedConflict:
            reblockedEntry,
        });

        return null;
      }

      const updatedEntry =
        await this.dependencies
          .recordSaveAttemptFailure(
            queuedResolution.sequence,
            errorMessage,
          );

      this.updateSnapshot({
        status:
          this.dependencies.isOnline()
            ? "paused-error"
            : "offline",
        currentSequence:
          updatedEntry?.sequence ??
          queuedResolution.sequence,
        retryCount:
          updatedEntry?.retryCount ?? 0,
        nextRetryDelayMs: null,
        lastError: errorMessage,
        blockedConflict: null,
      });

      return null;
    } finally {
      if (
        this.activeAbortController ===
        abortController
      ) {
        this.activeAbortController = null;
      }
    }
  }

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
        this.hydrated = false;
        await this.ensureHydrated();

        if (
          this.snapshot.blockedConflict !==
          null
        ) {
          this.updateSnapshot({
            status: "blocked-conflict",
            currentSequence:
              this.snapshot
                .blockedConflict.sequence,
          });
          return;
        }

        this.updateSnapshot({
          status: "idle",
          pendingCount: 0,
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
          pendingCount:
            Math.max(
              0,
              this.snapshot.pendingCount - 1,
            ),
          currentSequence: null,
          replayedCount:
            this.snapshot.replayedCount + 1,
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

        if (
          isVersionConflictError(error) &&
          error.currentVersion !== undefined
        ) {
          const blockedEntry =
            await this.dependencies
              .markSaveConflict(
                entry.sequence,
                {
                  message: errorMessage,
                  currentVersion:
                    error.currentVersion,
                  commonAncestor:
                    error.commonAncestor ??
                    null,
                },
              );

          if (signal.aborted) {
            return;
          }

          if (blockedEntry === null) {
            this.updateSnapshot({
              status: "paused-error",
              currentSequence:
                entry.sequence,
              retryCount:
                entry.retryCount,
              nextRetryDelayMs: null,
              lastError:
                "The replay conflict could not be stored.",
            });

            return;
          }

          this.replayAfterCurrentRun =
            false;

          this.updateSnapshot({
            status: "blocked-conflict",
            currentSequence:
              blockedEntry.sequence,
            retryCount:
              blockedEntry.retryCount,
            nextRetryDelayMs: null,
            lastError: errorMessage,
            blockedConflict:
              blockedEntry,
          });

          return;
        }

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

        if (!this.dependencies.isOnline()) {
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
          isRetryableReplayError(error) &&
          updatedEntry.retryCount <=
            this.dependencies.maxRetryCount;

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