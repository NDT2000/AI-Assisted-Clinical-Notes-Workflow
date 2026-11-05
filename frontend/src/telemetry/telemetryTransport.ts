import { apiFetch } from "../api/apiClient";
import { USE_MOCK_API } from "../api/apiConfig";
import type {
  TelemetryBatch,
  TelemetrySendOptions,
  TelemetryTransport,
} from "./telemetryTypes";

type TelemetryFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface FetchTelemetryTransportOptions {
  endpoint?: string;
  fetchImplementation?:
    TelemetryFetch;
  navigatorImplementation?:
    Navigator;
  /*
   * sendBeacon cannot carry an access token, so it is used only with the
   * mock server; the API gets a keepalive fetch instead.
   */
  useBeacon?: boolean;
}

export class FetchTelemetryTransport
  implements TelemetryTransport {
  private readonly endpoint:
    string;

  private readonly fetchImplementation:
    TelemetryFetch;

  private readonly useBeacon:
    boolean;

  private readonly navigatorImplementation:
    Navigator | null;

  constructor(
    options:
      FetchTelemetryTransportOptions = {},
  ) {
    this.endpoint =
      options.endpoint ??
      "/api/telemetry";

    // apiFetch adds the API's base URL and the access token.
    this.fetchImplementation =
      options.fetchImplementation ??
      ((input, init) =>
        apiFetch(input, init));

    this.useBeacon =
      options.useBeacon ??
      USE_MOCK_API;

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
      this.useBeacon &&
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