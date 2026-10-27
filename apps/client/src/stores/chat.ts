import { defineStore } from 'pinia';
import { filterChatMessage, parseChatLine, type ChatChannel, type ChatLine } from '../game/chat';

const MAX_LINES = 100;
const MAX_BLOCKED_USERS = 20;

function append(lines: ChatLine[], line: ChatLine): void {
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    messages: {
      all: [] as ChatLine[],
      world: [] as ChatLine[],
      union: [] as ChatLine[],
      private: [] as ChatLine[],
      war: [] as ChatLine[],
    },
    current: 'all' as ChatChannel,
    privateTarget: '',
    privateUnread: false,
    enabled: [true, true, true, true, true],
    blockedUsers: [] as string[],
    keywords: [] as string[],
    nextId: 1,
  }),
  getters: {
    currentLines: (state) => state.messages[state.current],
    recentLines: (state) => state.messages[state.current].slice(-4),
  },
  actions: {
    receive(channel: Exclude<ChatChannel, 'all'>, data: unknown, self = false): void {
      const line = parseChatLine(data, this.nextId++, self);
      if (this.blockedUsers.includes(line.fromuser)) return;
      line.msg = filterChatMessage(line.msg, this.keywords);
      append(this.messages[channel], line);
      append(this.messages.all, line);
      if (channel === 'private' && this.current !== 'private') this.privateUnread = true;
    },
    system(msg: string, channel?: ChatChannel): void {
      if (!msg) return;
      const target = channel ?? this.current;
      const line: ChatLine = {
        id: this.nextId++,
        fromuid: 0,
        fromuser: '',
        touid: 0,
        touser: '',
        fromdesignation: '',
        msg,
        self: false,
        system: true,
      };
      append(this.messages[target], line);
      if (target !== 'all') append(this.messages.all, line);
    },
    selectChannel(channel: ChatChannel): void {
      this.current = channel;
      if (channel === 'private') this.privateUnread = false;
    },
    selectPrivateTarget(name: string): void {
      this.privateTarget = name.trim();
      this.selectChannel('private');
    },
    setChannelEnabled(channel: number, enabled: boolean): void {
      if (channel >= 0 && channel < this.enabled.length) this.enabled[channel] = enabled;
    },
    blockUser(name: string): boolean {
      const user = name.trim();
      if (!user || this.blockedUsers.includes(user)) return false;
      if (this.blockedUsers.length >= MAX_BLOCKED_USERS) return false;
      this.blockedUsers.push(user);
      return true;
    },
    unblockUser(name: string): void {
      this.blockedUsers = this.blockedUsers.filter((user) => user !== name);
    },
    setKeywords(words: unknown): void {
      this.keywords = Array.isArray(words) ? words.map(String).filter(Boolean) : [];
    },
    addKeyword(word: string): void {
      if (word && !this.keywords.includes(word)) this.keywords.push(word);
    },
    removeKeyword(word: string): void {
      this.keywords = this.keywords.filter((keyword) => keyword !== word);
    },
  },
});
