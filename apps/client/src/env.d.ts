/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Login screen "register" button target (`Global.registerUrl`); hidden when empty. */
  readonly VITE_REGISTER_URL?: string;
  /** Login screen home button (`Global.homeButton` / `Global.homeUrl`); hidden when empty. */
  readonly VITE_HOME_LABEL?: string;
  readonly VITE_HOME_URL?: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
