/*
 * Where the API is, and whether the in-browser mock server answers instead.
 * Set through Vite environment variables (see frontend/.env.api).
 */

const env = import.meta.env;

/*
 * The mock server answers in tests, and in development unless
 * VITE_USE_MOCKS is "false". A production build always uses the API.
 */
export const USE_MOCK_API: boolean =
  env.MODE === "test" ||
  (env.DEV && env.VITE_USE_MOCKS !== "false");

/* Prefix for API paths; empty means the page's own origin. */
export const API_BASE_URL: string = (
  env.VITE_API_BASE_URL ?? ""
).replace(/\/+$/, "");

/*
 * The shared password of the synthetic demo accounts (the backend's
 * DEMO_USER_PASSWORD). It ships in the page: these accounts are a demo,
 * not real users.
 */
export const DEMO_PASSWORD: string =
  env.VITE_DEMO_PASSWORD ?? "demo-password";

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
