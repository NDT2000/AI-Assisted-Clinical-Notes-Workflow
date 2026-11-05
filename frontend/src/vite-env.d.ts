/// <reference types="vite/client" />

interface ImportMetaEnv {
  /* API origin, e.g. http://127.0.0.1:8000; empty for the page's origin. */
  readonly VITE_API_BASE_URL?: string;
  /* "false" turns the in-browser mock server off in development. */
  readonly VITE_USE_MOCKS?: string;
  /* Password of the synthetic demo accounts. */
  readonly VITE_DEMO_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
