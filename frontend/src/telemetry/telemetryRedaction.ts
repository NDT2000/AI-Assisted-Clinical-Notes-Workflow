import type {
  SanitizedTelemetryProperties,
  SanitizedTelemetryPropertyValue,
  TelemetryEvent,
} from "./telemetryTypes";

const SAFE_PROPERTY_KEYS =
  new Set([
    "action",
    "batchSize",
    "component",
    "connectionStatus",
    "count",
    "durationMs",
    "errorCode",
    "feature",
    "filterCount",
    "hasConflict",
    "hasPendingChanges",
    "httpStatus",
    "isCached",
    "isOffline",
    "itemCount",
    "latencyMs",
    "method",
    "networkStatus",
    "nextStatus",
    "operation",
    "outcome",
    "previousRoute",
    "previousStatus",
    "queryLength",
    "queueSize",
    "result",
    "retryCount",
    "revision",
    "revisionCount",
    "role",
    "route",
    "screen",
    "sortDirection",
    "sortField",
    "source",
    "status",
    "trigger",
    "visibleRowCount",
  ]);

const ROUTE_PROPERTY_KEYS =
  new Set([
    "route",
    "previousRoute",
  ]);

const SAFE_TOKEN_PATTERN =
  /^[A-Za-z0-9_.:/-]{1,80}$/;

const SAFE_EVENT_NAME_PATTERN =
  /^[a-z][a-z0-9_.-]{0,79}$/;

const MAX_ARRAY_LENGTH = 20;

function sanitizeRoute(
  value: string,
): string | null {
  const path =
    value.split(/[?#]/, 1)[0] ??
    "";

  if (
    path === "/" ||
    path === "/notes"
  ) {
    return path;
  }

  if (
    /^\/notes\/[^/]+$/.test(path)
  ) {
    return "/notes/:noteId";
  }

  if (
    /^\/[A-Za-z0-9_./:-]{1,100}$/.test(
      path,
    )
  ) {
    return path;
  }

  return null;
}

function sanitizeString(
  key: string,
  value: string,
): string | null {
  if (
    ROUTE_PROPERTY_KEYS.has(key)
  ) {
    return sanitizeRoute(value);
  }

  const trimmed = value.trim();

  if (
    !SAFE_TOKEN_PATTERN.test(
      trimmed,
    )
  ) {
    return null;
  }

  return trimmed;
}

function sanitizePrimitive(
  key: string,
  value: unknown,
):
  | string
  | number
  | boolean
  | null
  | undefined {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    typeof value === "number"
  ) {
    return Number.isFinite(value)
      ? value
      : undefined;
  }

  if (
    typeof value === "string"
  ) {
    return (
      sanitizeString(
        key,
        value,
      ) ?? undefined
    );
  }

  return undefined;
}

function sanitizeValue(
  key: string,
  value: unknown,
):
  | SanitizedTelemetryPropertyValue
  | undefined {
  const primitive =
    sanitizePrimitive(
      key,
      value,
    );

  if (primitive !== undefined) {
    return primitive;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const sanitizedItems =
    value
      .slice(0, MAX_ARRAY_LENGTH)
      .map(item =>
        sanitizePrimitive(
          key,
          item,
        ),
      )
      .filter(
        (
          item,
        ): item is
          | string
          | number
          | boolean
          | null =>
          item !== undefined,
      );

  return sanitizedItems.length > 0
    ? sanitizedItems
    : undefined;
}

export function sanitizeTelemetryEventName(
  name: string,
): string {
  const normalized =
    name.trim().toLowerCase();

  return SAFE_EVENT_NAME_PATTERN.test(
    normalized,
  )
    ? normalized
    : "telemetry.invalid_event_name";
}

export function redactTelemetryProperties(
  properties:
    Record<string, unknown>,
): SanitizedTelemetryProperties {
  const sanitized:
    SanitizedTelemetryProperties = {};

  for (
    const [
      key,
      value,
    ] of Object.entries(properties)
  ) {
    if (
      !SAFE_PROPERTY_KEYS.has(key)
    ) {
      continue;
    }

    const sanitizedValue =
      sanitizeValue(key, value);

    if (
      sanitizedValue !==
      undefined
    ) {
      sanitized[key] =
        sanitizedValue;
    }
  }

  return sanitized;
}

export function redactTelemetryEvent(
  event: TelemetryEvent,
): TelemetryEvent {
  return {
    eventId:
      SAFE_TOKEN_PATTERN.test(
        event.eventId,
      )
        ? event.eventId
        : "redacted-event-id",
    name:
      sanitizeTelemetryEventName(
        event.name,
      ),
    occurredAt:
      Number.isNaN(
        Date.parse(
          event.occurredAt,
        ),
      )
        ? new Date(0).toISOString()
        : event.occurredAt,
    important:
      event.important === true,
    properties:
      redactTelemetryProperties(
        event.properties,
      ),
  };
}