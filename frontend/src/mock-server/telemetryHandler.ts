import {
  http,
  HttpResponse,
} from "msw";

import type {
  TelemetryBatch,
} from "../telemetry/telemetryTypes";

const FORBIDDEN_TELEMETRY_KEYS =
  new Set([
    "address",
    "assessment",
    "content",
    "contentPreview",
    "dateOfBirth",
    "displayName",
    "email",
    "medicalRecordNumber",
    "mrn",
    "noteId",
    "objective",
    "patient",
    "patientId",
    "patientName",
    "phone",
    "plan",
    "soap",
    "soapContent",
    "subjective",
  ]);

const receivedTelemetryBatches:
  TelemetryBatch[] = [];

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasForbiddenTelemetryKey(
  value: unknown,
): boolean {
  if (Array.isArray(value)) {
    return value.some(
      hasForbiddenTelemetryKey,
    );
  }

  if (!isRecord(value)) {
    return false;
  }

  for (
    const [
      key,
      nestedValue,
    ] of Object.entries(value)
  ) {
    if (
      FORBIDDEN_TELEMETRY_KEYS.has(
        key,
      )
    ) {
      return true;
    }

    if (
      hasForbiddenTelemetryKey(
        nestedValue,
      )
    ) {
      return true;
    }
  }

  return false;
}

function isTelemetryBatch(
  value: unknown,
): value is TelemetryBatch {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.schemaVersion !== 1 ||
    typeof value.sentAt !==
      "string" ||
    typeof value.reason !==
      "string" ||
    !Array.isArray(value.events)
  ) {
    return false;
  }

  return value.events.every(
    event =>
      isRecord(event) &&
      typeof event.eventId ===
        "string" &&
      typeof event.name ===
        "string" &&
      typeof event.occurredAt ===
        "string" &&
      typeof event.important ===
        "boolean" &&
      isRecord(event.properties),
  );
}

function cloneBatch(
  batch: TelemetryBatch,
): TelemetryBatch {
  return JSON.parse(
    JSON.stringify(batch),
  ) as TelemetryBatch;
}

export function getReceivedTelemetryBatches():
  readonly TelemetryBatch[] {
  return receivedTelemetryBatches.map(
    cloneBatch,
  );
}

export function clearReceivedTelemetryBatches():
  void {
  receivedTelemetryBatches.length = 0;
}

export const telemetryHandler =
  http.post(
    "*/api/telemetry",
    async ({ request }) => {
      let body: unknown;

      try {
        body =
          await request.json();
      } catch {
        return HttpResponse.json(
          {
            error:
              "invalid_request",
            message:
              "Telemetry must be valid JSON.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        !isTelemetryBatch(body)
      ) {
        return HttpResponse.json(
          {
            error:
              "invalid_request",
            message:
              "The telemetry batch is invalid.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        hasForbiddenTelemetryKey(
          body,
        )
      ) {
        return HttpResponse.json(
          {
            error:
              "clinical_content_rejected",
            message:
              "Clinical or patient information is not permitted in telemetry.",
          },
          {
            status: 400,
          },
        );
      }

      receivedTelemetryBatches.push(
        cloneBatch(body),
      );

      return HttpResponse.json(
        {
          accepted:
            body.events.length,
        },
        {
          status: 202,
        },
      );
    },
  );
