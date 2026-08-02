import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  FetchTelemetryTransport,
} from "../telemetryTransport";
import type {
  TelemetryBatch,
} from "../telemetryTypes";

function createBatch():
  TelemetryBatch {
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
          "navigation.route_view",
        occurredAt:
          "2026-08-02T16:00:00.000Z",
        important: false,
        properties: {
          route: "/notes",
        },
      },
    ],
  };
}

describe(
  "FetchTelemetryTransport",
  () => {
    it(
      "uses sendBeacon during unload when the browser accepts the payload",
      async () => {
        const fetchMock =
          vi.fn();

        const sendBeacon =
          vi.fn(() => true);

        const transport =
          new FetchTelemetryTransport({
            fetchImplementation:
              fetchMock as unknown as
                typeof fetch,
            navigatorImplementation: {
              sendBeacon,
            } as unknown as Navigator,
          });

        await transport.send(
          createBatch(),
          {
            unload: true,
          },
        );

        expect(
          sendBeacon,
        ).toHaveBeenCalledWith(
          "/api/telemetry",
          expect.any(Blob),
        );

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "falls back to keepalive fetch when sendBeacon declines the payload",
      async () => {
        const fetchMock =
          vi.fn(
            async () =>
              new Response(null, {
                status: 202,
              }),
          );

        const sendBeacon =
          vi.fn(() => false);

        const transport =
          new FetchTelemetryTransport({
            fetchImplementation:
              fetchMock as unknown as
                typeof fetch,
            navigatorImplementation: {
              sendBeacon,
            } as unknown as Navigator,
          });

        await transport.send(
          createBatch(),
          {
            unload: true,
          },
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledWith(
          "/api/telemetry",
          expect.objectContaining({
            method: "POST",
            keepalive: true,
          }),
        );
      },
    );

    it(
      "uses ordinary fetch without keepalive for a normal flush",
      async () => {
        const fetchMock =
          vi.fn(
            async () =>
              new Response(null, {
                status: 202,
              }),
          );

        const transport =
          new FetchTelemetryTransport({
            fetchImplementation:
              fetchMock as unknown as
                typeof fetch,
            navigatorImplementation: {
              sendBeacon:
                vi.fn(),
            } as unknown as Navigator,
          });

        await transport.send(
          createBatch(),
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledWith(
          "/api/telemetry",
          expect.objectContaining({
            method: "POST",
            keepalive: false,
          }),
        );
      },
    );

    it(
      "throws when the telemetry endpoint rejects a batch",
      async () => {
        const fetchMock =
          vi.fn(
            async () =>
              new Response(null, {
                status: 503,
              }),
          );

        const transport =
          new FetchTelemetryTransport({
            fetchImplementation:
              fetchMock as unknown as
                typeof fetch,
            navigatorImplementation: {
              sendBeacon:
                vi.fn(),
            } as unknown as Navigator,
          });

        await expect(
          transport.send(
            createBatch(),
          ),
        ).rejects.toThrow(
          "Telemetry delivery failed with status 503.",
        );
      },
    );
  },
);
