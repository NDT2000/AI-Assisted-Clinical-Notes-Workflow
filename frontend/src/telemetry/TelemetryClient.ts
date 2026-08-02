import {
  redactTelemetryEvent,
  redactTelemetryProperties,
  sanitizeTelemetryEventName,
} from "./telemetryRedaction";
import {
  telemetryPersistence,
} from "./telemetryDatabase";
import {
  telemetryTransport,
} from "./telemetryTransport";
import type {
  PersistedTelemetryBatch,
  TelemetryBatch,
  TelemetryClientSnapshot,
  TelemetryEvent,
  TelemetryFlushReason,
  TelemetryPersistence,
  TelemetrySnapshotListener,
  TelemetryTrackOptions,
  TelemetryTransport,
} from "./telemetryTypes";

interface TelemetryTimerDependencies {
  setInterval(
    callback: () => void,
    delayMs: number,
  ): ReturnType<
    typeof setInterval
  >;

  clearInterval(
    timer:
      ReturnType<
        typeof setInterval
      >,
  ): void;

  setTimeout(
    callback: () => void,
    delayMs: number,
  ): ReturnType<
    typeof setTimeout
  >;

  clearTimeout(
    timer:
      ReturnType<
        typeof setTimeout
      >,
  ): void;
}

export interface TelemetryClientOptions {
  transport?:
    TelemetryTransport;
  persistence?:
    TelemetryPersistence;
  batchSize?: number;
  flushIntervalMs?: number;
  maxSendAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  now?: () => string;
  createEventId?: () => string;
  random?: () => number;
  sleep?: (
    delayMs: number,
  ) => Promise<void>;
  timers?:
    Partial<
      TelemetryTimerDependencies
    >;
}

const DEFAULT_BATCH_SIZE = 20;

const DEFAULT_FLUSH_INTERVAL_MS =
  5_000;

const DEFAULT_MAX_SEND_ATTEMPTS =
  3;

const DEFAULT_BASE_RETRY_DELAY_MS =
  500;

const DEFAULT_MAX_RETRY_DELAY_MS =
  8_000;

function createDefaultEventId():
  string {
  if (
    typeof crypto !==
      "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return [
    "telemetry",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2),
  ].join("-");
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

  return "Telemetry delivery failed.";
}

export class TelemetryClient {
  private readonly transport:
    TelemetryTransport;

  private readonly persistence:
    TelemetryPersistence;

  private readonly batchSize:
    number;

  private readonly flushIntervalMs:
    number;

  private readonly maxSendAttempts:
    number;

  private readonly baseRetryDelayMs:
    number;

  private readonly maxRetryDelayMs:
    number;

  private readonly now:
    () => string;

  private readonly createEventId:
    () => string;

  private readonly random:
    () => number;

  private readonly sleep:
    (
      delayMs: number,
    ) => Promise<void>;

  private readonly timers:
    TelemetryTimerDependencies;

  private readonly listeners =
    new Set<
      TelemetrySnapshotListener
    >();

  private queue:
    TelemetryEvent[] = [];

  private flushPromise:
    Promise<void> | null = null;

  private intervalTimer:
    | ReturnType<
        typeof setInterval
      >
    | null = null;

  private retryTimer:
    | ReturnType<
        typeof setTimeout
      >
    | null = null;

  private retryAttempt = 0;

  private snapshot:
    TelemetryClientSnapshot = {
      started: false,
      queuedEventCount: 0,
      isFlushing: false,
      retryAttempt: 0,
      nextRetryDelayMs: null,
      lastError: null,
    };

  constructor(
    options:
      TelemetryClientOptions = {},
  ) {
    this.transport =
      options.transport ??
      telemetryTransport;

    this.persistence =
      options.persistence ??
      telemetryPersistence;

    this.batchSize =
      Math.max(
        1,
        Math.floor(
          options.batchSize ??
            DEFAULT_BATCH_SIZE,
        ),
      );

    this.flushIntervalMs =
      Math.max(
        250,
        Math.floor(
          options.flushIntervalMs ??
            DEFAULT_FLUSH_INTERVAL_MS,
        ),
      );

    this.maxSendAttempts =
      Math.max(
        1,
        Math.floor(
          options.maxSendAttempts ??
            DEFAULT_MAX_SEND_ATTEMPTS,
        ),
      );

    this.baseRetryDelayMs =
      Math.max(
        1,
        Math.floor(
          options.baseRetryDelayMs ??
            DEFAULT_BASE_RETRY_DELAY_MS,
        ),
      );

    this.maxRetryDelayMs =
      Math.max(
        this.baseRetryDelayMs,
        Math.floor(
          options.maxRetryDelayMs ??
            DEFAULT_MAX_RETRY_DELAY_MS,
        ),
      );

    this.now =
      options.now ??
      (() =>
        new Date().toISOString());

    this.createEventId =
      options.createEventId ??
      createDefaultEventId;

    this.random =
      options.random ??
      Math.random;

    this.sleep =
      options.sleep ??
      (delayMs =>
        new Promise(resolve => {
          globalThis.setTimeout(
            resolve,
            delayMs,
          );
        }));

    this.timers = {
      setInterval:
        options.timers
          ?.setInterval ??
        ((callback, delayMs) =>
          globalThis.setInterval(
            callback,
            delayMs,
          )),

      clearInterval:
        options.timers
          ?.clearInterval ??
        (timer =>
          globalThis.clearInterval(
            timer,
          )),

      setTimeout:
        options.timers
          ?.setTimeout ??
        ((callback, delayMs) =>
          globalThis.setTimeout(
            callback,
            delayMs,
          )),

      clearTimeout:
        options.timers
          ?.clearTimeout ??
        (timer =>
          globalThis.clearTimeout(
            timer,
          )),
    };
  }

  getSnapshot =
    (): TelemetryClientSnapshot =>
      this.snapshot;

  subscribe = (
    listener:
      TelemetrySnapshotListener,
  ): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(
        listener,
      );
    };
  };

  start(): void {
    if (
      this.snapshot.started
    ) {
      return;
    }

    this.updateSnapshot({
      started: true,
    });

    this.intervalTimer =
      this.timers.setInterval(
        () => {
          void this.flush("time");
        },
        this.flushIntervalMs,
      );

    void this.flush("startup");
  }

  stop(): void {
    if (
      this.intervalTimer !==
      null
    ) {
      this.timers.clearInterval(
        this.intervalTimer,
      );

      this.intervalTimer = null;
    }

    this.clearRetryTimer();

    this.updateSnapshot({
      started: false,
      nextRetryDelayMs: null,
    });
  }

  track(
    name: string,
    properties:
      Record<
        string,
        unknown
      > = {},
    options:
      TelemetryTrackOptions = {},
  ): void {
    const event:
      TelemetryEvent = {
      eventId:
        this.createEventId(),
      name:
        sanitizeTelemetryEventName(
          name,
        ),
      occurredAt:
        this.now(),
      important:
        options.important ===
        true,
      properties:
        redactTelemetryProperties(
          properties,
        ),
    };

    this.queue.push(event);

    this.updateSnapshot({
      queuedEventCount:
        this.queue.length,
    });

    if (event.important) {
      void this.flush(
        "important",
      );

      return;
    }

    if (
      this.queue.length >=
      this.batchSize
    ) {
      void this.flush("size");
    }
  }

  flush(
    reason:
      TelemetryFlushReason =
        "manual",
  ): Promise<void> {
    if (
      this.flushPromise !==
      null
    ) {
      return this.flushPromise;
    }

    this.flushPromise =
      this.performFlush(reason)
        .catch(error => {
          this.updateSnapshot({
            lastError:
              getErrorMessage(error),
          });
        })
        .finally(() => {
          this.flushPromise = null;

          this.updateSnapshot({
            isFlushing: false,
            queuedEventCount:
              this.queue.length,
          });
        });

    this.updateSnapshot({
      isFlushing: true,
    });

    return this.flushPromise;
  }

  async flushOnUnload():
    Promise<void> {
    if (
      this.queue.length === 0
    ) {
      return;
    }

    const events =
      this.queue.splice(
        0,
        this.queue.length,
      );

    this.updateSnapshot({
      queuedEventCount: 0,
    });

    const batch =
      this.createBatch(
        events,
        "page-unload",
      );

    try {
      await this.transport.send(
        batch,
        {
          unload: true,
        },
      );
    } catch (error) {
      const persisted =
        await this.persistBatch(
          events,
          1,
        );

      if (!persisted) {
        this.queue.unshift(
          ...events,
        );
      }

      this.updateSnapshot({
        queuedEventCount:
          this.queue.length,
        lastError:
          getErrorMessage(error),
      });
    }
  }

  private async performFlush(
    reason:
      TelemetryFlushReason,
  ): Promise<void> {
    const persistedSent =
      await this.flushPersistedBatches(
        reason,
      );

    if (!persistedSent) {
      return;
    }

    while (
      this.queue.length > 0
    ) {
      const events =
        this.queue.splice(
          0,
          this.batchSize,
        );

      this.updateSnapshot({
        queuedEventCount:
          this.queue.length,
      });

      const sent =
        await this.sendWithRetry(
          events,
          reason,
        );

      if (sent) {
        continue;
      }

      const persisted =
        await this.persistBatch(
          events,
          this.maxSendAttempts,
        );

      if (!persisted) {
        this.queue.unshift(
          ...events,
        );
      }

      this.updateSnapshot({
        queuedEventCount:
          this.queue.length,
      });

      this.scheduleRetry();
      return;
    }

    this.retryAttempt = 0;

    this.updateSnapshot({
      retryAttempt: 0,
      nextRetryDelayMs: null,
      lastError: null,
    });
  }

  private async flushPersistedBatches(
    reason:
      TelemetryFlushReason,
  ): Promise<boolean> {
    while (true) {
      let persisted:
        PersistedTelemetryBatch | null;

      try {
        persisted =
          await this.persistence
            .getOldest();
      } catch (error) {
        this.updateSnapshot({
          lastError:
            getErrorMessage(error),
        });

        return true;
      }

      if (
        persisted === null
      ) {
        return true;
      }

      const sent =
        await this.sendWithRetry(
          [...persisted.events],
          reason,
        );

      if (!sent) {
        this.scheduleRetry();
        return false;
      }

      if (
        persisted.id !==
        undefined
      ) {
        await this.persistence.remove(
          persisted.id,
        );
      }
    }
  }

  private async sendWithRetry(
    events:
      readonly TelemetryEvent[],
    reason:
      TelemetryFlushReason,
  ): Promise<boolean> {
    for (
      let attempt = 1;
      attempt <=
      this.maxSendAttempts;
      attempt += 1
    ) {
      try {
        await this.transport.send(
          this.createBatch(
            events,
            reason,
          ),
        );

        return true;
      } catch (error) {
        this.updateSnapshot({
          lastError:
            getErrorMessage(error),
        });

        if (
          attempt >=
          this.maxSendAttempts
        ) {
          return false;
        }

        await this.sleep(
          this.getRetryDelayMs(
            attempt,
          ),
        );
      }
    }

    return false;
  }

  private createBatch(
    events:
      readonly TelemetryEvent[],
    reason:
      TelemetryFlushReason,
  ): TelemetryBatch {
    return {
      schemaVersion: 1,
      sentAt: this.now(),
      reason,
      events:
        events.map(
          redactTelemetryEvent,
        ),
    };
  }

  private async persistBatch(
    events:
      readonly TelemetryEvent[],
    attemptCount: number,
  ): Promise<boolean> {
    try {
      const id =
        await this.persistence.add({
          createdAt:
            this.now(),
          attemptCount,
          events:
            events.map(
              redactTelemetryEvent,
            ),
        });

      return id !== null;
    } catch (error) {
      this.updateSnapshot({
        lastError:
          getErrorMessage(error),
      });

      return false;
    }
  }

  private getRetryDelayMs(
    attempt: number,
  ): number {
    const exponentialDelay =
      Math.min(
        this.maxRetryDelayMs,
        this.baseRetryDelayMs *
          2 **
            Math.max(
              0,
              attempt - 1,
            ),
      );

    const jitter =
      Math.floor(
        exponentialDelay *
          0.25 *
          this.random(),
      );

    return (
      exponentialDelay +
      jitter
    );
  }

  private scheduleRetry(): void {
    if (
      this.retryTimer !==
      null
    ) {
      return;
    }

    this.retryAttempt += 1;

    const delayMs =
      this.getRetryDelayMs(
        this.retryAttempt,
      );

    this.updateSnapshot({
      retryAttempt:
        this.retryAttempt,
      nextRetryDelayMs:
        delayMs,
    });

    this.retryTimer =
      this.timers.setTimeout(
        () => {
          this.retryTimer = null;

          void this.flush("retry");
        },
        delayMs,
      );
  }

  private clearRetryTimer():
    void {
    if (
      this.retryTimer ===
      null
    ) {
      return;
    }

    this.timers.clearTimeout(
      this.retryTimer,
    );

    this.retryTimer = null;
  }

  private updateSnapshot(
    update:
      Partial<
        TelemetryClientSnapshot
      >,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      ...update,
    };

    for (
      const listener of
      this.listeners
    ) {
      listener();
    }
  }
}