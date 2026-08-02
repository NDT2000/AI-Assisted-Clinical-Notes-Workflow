export type TelemetryPrimitive =
  | string
  | number
  | boolean
  | null;

export type SanitizedTelemetryPropertyValue =
  | TelemetryPrimitive
  | readonly TelemetryPrimitive[];

export type SanitizedTelemetryProperties =
  Record<
    string,
    SanitizedTelemetryPropertyValue
  >;

export interface TelemetryTrackOptions {
  important?: boolean;
}

export interface TelemetryEvent {
  eventId: string;
  name: string;
  occurredAt: string;
  important: boolean;
  properties:
    SanitizedTelemetryProperties;
}

export type TelemetryFlushReason =
  | "size"
  | "time"
  | "important"
  | "route-change"
  | "visibility-hidden"
  | "page-unload"
  | "startup"
  | "manual"
  | "retry";

export interface TelemetryBatch {
  schemaVersion: 1;
  sentAt: string;
  reason: TelemetryFlushReason;
  events: readonly TelemetryEvent[];
}

export interface TelemetrySendOptions {
  unload?: boolean;
}

export interface TelemetryTransport {
  send(
    batch: TelemetryBatch,
    options?: TelemetrySendOptions,
  ): Promise<void>;
}

export interface PersistedTelemetryBatch {
  id?: number;
  createdAt: string;
  attemptCount: number;
  events: readonly TelemetryEvent[];
}

export interface TelemetryPersistence {
  add(
    batch: PersistedTelemetryBatch,
  ): Promise<number | null>;

  getOldest():
    Promise<
      PersistedTelemetryBatch | null
    >;

  remove(id: number): Promise<void>;

  count(): Promise<number>;
}

export interface TelemetryClientSnapshot {
  started: boolean;
  queuedEventCount: number;
  isFlushing: boolean;
  retryAttempt: number;
  nextRetryDelayMs:
    | number
    | null;
  lastError: string | null;
}

export type TelemetrySnapshotListener =
  () => void;