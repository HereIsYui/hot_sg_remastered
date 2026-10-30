/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Shared GM token, sent as the `x-gm-token` request header (must match the server's GM_TOKEN). */
  readonly VITE_GM_TOKEN?: string;
  /** Base URL of the client asset directory, for item image previews. */
  readonly VITE_ASSET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
