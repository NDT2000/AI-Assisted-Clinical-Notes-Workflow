import {
  TelemetryClient,
} from "./TelemetryClient";
import type {
  TelemetryFlushReason,
  TelemetryTrackOptions,
} from "./telemetryTypes";

export const telemetryClient =
  new TelemetryClient();

export function track(
  name: string,
  properties:
    Record<
      string,
      unknown
    > = {},
  options:
    TelemetryTrackOptions = {},
): void {
  telemetryClient.track(
    name,
    properties,
    options,
  );
}

export function flushTelemetry(
  reason:
    TelemetryFlushReason =
      "manual",
): Promise<void> {
  return telemetryClient.flush(
    reason,
  );
}