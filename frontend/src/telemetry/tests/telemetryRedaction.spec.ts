import {
  describe,
  expect,
  it,
} from "vitest";

import {
  redactTelemetryEvent,
  redactTelemetryProperties,
  sanitizeTelemetryEventName,
} from "../telemetryRedaction";
import type {
  TelemetryEvent,
} from "../telemetryTypes";

describe(
  "telemetry redaction",
  () => {
    it(
      "keeps only allowlisted operational properties",
      () => {
        const result =
          redactTelemetryProperties({
            status:
              "IN_REVIEW",
            role: "REVIEWER",
            retryCount: 2,
            isOffline: true,
            route:
              "/notes/note-secret?patient=Alice",
            previousRoute:
              "/notes",
            screen:
              "note_detail",
            subjective:
              "Patient reports chest pain.",
            objective:
              "Blood pressure is elevated.",
            assessment:
              "Possible hypertension.",
            plan:
              "Continue treatment.",
            patientId:
              "patient-123",
            patientName:
              "Alice Example",
            medicalRecordNumber:
              "MRN-123",
            contentPreview:
              "Clinical preview",
            patient: {
              displayName:
                "Alice Example",
              dateOfBirth:
                "1990-01-01",
            },
            soapContent: {
              subjective:
                "Clinical content",
            },
          });

        expect(result).toEqual({
          status:
            "IN_REVIEW",
          role: "REVIEWER",
          retryCount: 2,
          isOffline: true,
          route:
            "/notes/:noteId",
          previousRoute:
            "/notes",
          screen:
            "note_detail",
        });

        const serialized =
          JSON.stringify(result);

        expect(serialized).not.toContain(
          "Patient reports",
        );

        expect(serialized).not.toContain(
          "Alice Example",
        );

        expect(serialized).not.toContain(
          "MRN-123",
        );
      },
    );

    it(
      "rejects free text even when the property key is allowlisted",
      () => {
        const result =
          redactTelemetryProperties({
            outcome: "success",
            result:
              "Patient reports worsening symptoms",
            errorCode:
              "version_conflict",
          });

        expect(result).toEqual({
          outcome: "success",
          errorCode:
            "version_conflict",
        });
      },
    );

    it(
      "removes query parameters and note identifiers from routes",
      () => {
        const result =
          redactTelemetryProperties({
            route:
              "/notes/note-123?patientId=patient-1#history",
            previousRoute:
              "/notes?status=IN_REVIEW",
          });

        expect(result).toEqual({
          route:
            "/notes/:noteId",
          previousRoute:
            "/notes",
        });
      },
    );

    it(
      "normalizes valid event names and replaces invalid names",
      () => {
        expect(
          sanitizeTelemetryEventName(
            "NOTE.VERSION_SAVE",
          ),
        ).toBe(
          "note.version_save",
        );

        expect(
          sanitizeTelemetryEventName(
            "Patient Alice saved a note",
          ),
        ).toBe(
          "telemetry.invalid_event_name",
        );
      },
    );

    it(
      "redacts again immediately before an event is transmitted",
      () => {
        const unsafeEvent = {
          eventId:
            "unsafe event identifier",
          name:
            "NOTE.VERSION_SAVE",
          occurredAt:
            "not-a-date",
          important: true,
          properties: {
            status:
              "IN_REVIEW",
            noteId:
              "note-secret",
            subjective:
              "Patient reports pain.",
            result:
              "free text with spaces",
          },
        } as unknown as
          TelemetryEvent;

        const result =
          redactTelemetryEvent(
            unsafeEvent,
          );

        expect(result).toEqual({
          eventId:
            "redacted-event-id",
          name:
            "note.version_save",
          occurredAt:
            new Date(
              0,
            ).toISOString(),
          important: true,
          properties: {
            status:
              "IN_REVIEW",
          },
        });
      },
    );
  },
);
