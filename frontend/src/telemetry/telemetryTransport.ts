import type {
  TelemetryBatch,
  TelemetrySendOptions,
  TelemetryTransport,
} from "./telemetryTypes";

export interface FetchTelemetryTransportOptions {
  endpoint?: string;
  fetchImplementation?:
    typeof fetch;
  navigatorImplementation?:
    Navigator;
}

export class FetchTelemetryTransport
  implements TelemetryTransport {
  private readonly endpoint:
    string;

  private readonly fetchImplementation:
    typeof fetch;

  private readonly navigatorImplementation:
    Navigator | null;

  constructor(
    options:
      FetchTelemetryTransportOptions = {},
  ) {
    this.endpoint =
      options.endpoint ??
      "/api/telemetry";

    this.fetchImplementation =
      options.fetchImplementation ??
      globalThis.fetch.bind(
        globalThis,
      );

    this.navigatorImplementation =
      options.navigatorImplementation ??
      (typeof navigator ===
      "undefined"
        ? null
        : navigator);
  }

  async send(
    batch: TelemetryBatch,
    options:
      TelemetrySendOptions = {},
  ): Promise<void> {
    const body =
      JSON.stringify(batch);

    if (
      options.unload === true &&
      this.navigatorImplementation
        ?.sendBeacon !==
        undefined
    ) {
      const accepted =
        this.navigatorImplementation
          .sendBeacon(
            this.endpoint,
            new Blob(
              [body],
              {
                type:
                  "application/json",
              },
            ),
          );

      if (accepted) {
        return;
      }
    }

    const response =
      await this.fetchImplementation(
        this.endpoint,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body,
          keepalive:
            options.unload ===
            true,
        },
      );

    if (!response.ok) {
      throw new Error(
        `Telemetry delivery failed with status ${response.status}.`,
      );
    }
  }
}

export const telemetryTransport =
  new FetchTelemetryTransport();