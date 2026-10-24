import { defineStore } from 'pinia';

/** One chat line (ChatPanel's onNotifyPublicChat fields). */
export interface ChatLine {
  fromuser: string;
  msg: string;
  /** The send's own echo (rendered in the sender colour by the original). */
  self?: boolean;
}

/** The chat channels the client keeps (the 世界 channel of ChatPanel.as; more channels later). */
export const useChatStore = defineStore('chat', {
  state: () => ({
    /** The latest 世界 lines, oldest first (the display trims the tail). */
    world: [] as ChatLine[],
  }),
  actions: {
    push(line: ChatLine): void {
      this.world.push(line);
      if (this.world.length > 50) this.world.splice(0, this.world.length - 50);
    },
  },
});
