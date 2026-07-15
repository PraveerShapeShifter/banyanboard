/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base path for API calls (12-factor). Defaults to same-origin `/api`. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
