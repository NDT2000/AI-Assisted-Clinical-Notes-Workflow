import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  setupServer,
} from "msw/node";

import type {
  TelemetryBatch,
} from "../../telemetry/telemetryTypes";
import {
  clearReceivedTelemetryBatches,
  getReceivedTelemetryBatches,
  telemetryHandler,
} from "../telemetryHandler";

const server =
  setupServer(
    telemetryHandler,
  );

function createBatch(
  properties:
    Record<string, unknown>,
): TelemetryBatch {
  return {
    schemaVersion: 1,
    sentAt:
      "2026-08-02T16:00:00.000Z",
    reason: "manual",
    events: [
      {
        eventId:
          "telemetry-event-1",
        name:
          "note.version_save",
        occurredAt:
          "2026-08-02T16:00:00.000Z",
        important: false,
        properties:
          properties as TelemetryBatch[
            "events"
          ][number][
            "properties"
          ],
      },
    ],
  };
}

describe(
  "telemetryHandler",
  () => {
    beforeAll(() => {
      server.listen({
        onUnhandledRequest:
          "error",
      });
    });

    afterEach(() => {
      clearReceivedTelemetryBatches();

      server.resetHandlers();
    });

    afterAll(() => {
      server.close();
    });

    it(
      "accepts a valid operational telemetry batch",
      async () => {
        const batch =
          createBatch({
            outcome:
              "success",
            status:
              "IN_REVIEW",
            revision: 2,
          });

        const response =
          await fetch(
            "http://localhost/api/telemetry",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body:
                JSON.stringify(
                  batch,
                ),
            },
          );

        expect(
          response.status,
        ).toBe(202);

        expect(
          await response.json(),
        ).toEqual({
          accepted: 1,
        });

        expect(
          getReceivedTelemetryBatches(),
        ).toEqual([
          batch,
        ]);
      },
    );

    it(
      "rejects SOAP free text",
      async () => {
        const response =
          await fetch(
            "http://localhost/api/telemetry",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body:
                JSON.stringify(
                  createBatch({
                    outcome:
                      "success",
                    subjective:
                      "Patient reports chest pain.",
                    objective:
                      "Blood pressure is elevated.",
                    assessment:
                      "Possible hypertension.",
                    plan:
                      "Continue medication.",
                  }),
                ),
            },
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          await response.json(),
        ).toMatchObject({
          error:
            "clinical_content_rejected",
        });

        expect(
          getReceivedTelemetryBatches(),
        ).toHaveLength(0);
      },
    );

    it(
      "rejects patient information nested anywhere in the payload",
      async () => {
        const response =
          await fetch(
            "http://localhost/api/telemetry",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body:
                JSON.stringify(
                  createBatch({
                    outcome:
                      "success",
                    patient: {
                      patientId:
                        "patient-1",
                      displayName:
                        "Alice Example",
                      medicalRecordNumber:
                        "MRN-123",
                    },
                  }),
                ),
            },
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          await response.json(),
        ).toMatchObject({
          error:
            "clinical_content_rejected",
        });

        expect(
          getReceivedTelemetryBatches(),
        ).toHaveLength(0);
      },
    );

    it(
      "rejects malformed telemetry batches",
      async () => {
        const response =
          await fetch(
            "http://localhost/api/telemetry",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  events: [],
                }),
            },
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          await response.json(),
        ).toMatchObject({
          error:
            "invalid_request",
        });
      },
    );
  },
);
