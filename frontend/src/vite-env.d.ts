/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL. Defaults to `/api/v1` (proxied to the backend in dev). */
  readonly VITE_API_BASE_URL?: string;
  /** Dev-only: where Vite proxies `/api` requests. Defaults to http://localhost:5050. */
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
