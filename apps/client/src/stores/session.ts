import { defineStore } from 'pinia';

export type Screen = 'loading' | 'login' | 'createRole' | 'game';

/** Client-side flow state of BloodWar.as (which top-level view is shown, busy cursor). */
export const useSessionStore = defineStore('session', {
  state: () => ({
    screen: 'loading' as Screen,
    loadProgress: 0,
    /** Pending requests with `showBusyCursor`. */
    busy: 0,
    /** Login queue position (`LoginDialog.mQueuePeople`), 0 when not queued. */
    queuePeople: 0,
    loginAnnouncement: '',
    /** CreateRoleDialog mode: new role (true) or rebuild a city after losing all (false). */
    createRoleFirstTime: true,
    /** The province list may only be shown once loadProvinceInfo answered. */
    provinceLoaded: false,
  }),
});
