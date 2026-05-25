/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL; when unset in dev the MSW mock serves the API. */
  readonly VITE_API_BASE_URL?: string;
  /** Force the MSW mock on even when a backend URL is set. */
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
