/*
 * Where the API is, and whether the mock server answers instead.
 * Set through Vite environment variables.
 */

const env = import.meta.env;

/*
 * The mock server (MSW) answers only in tests. In development and in a
 * production build the app talks to the API; the Vite dev server forwards
 * /api to it (see vite.config.ts).
 */
export const USE_MOCK_API: boolean = env.MODE === "test";

/* Prefix for API paths; empty means the page's own origin. */
export const API_BASE_URL: string = (
  env.VITE_API_BASE_URL ?? ""
).replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
