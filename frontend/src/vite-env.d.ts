/// <reference types="vite/client" />

interface ImportMetaEnv {
  /*
   * API origin; leave empty for the page's own origin, which the sign-in
   * cookie needs.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
