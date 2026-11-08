import { defineStore } from 'pinia';
import { filterChatMessage, parseChatLine, type ChatChannel, type ChatLine } from '../game/chat';
import {
  appendChatItem,
  decodeChatItems,
  type ChatItemLink,
  type ChatItemSegment,
} from '../game/chatLink';

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
    // the bottom-bar chat input (CTextInput): the typed text plus its queued 装备展示 pieces
    inputText: '',
    inputItems: [] as ChatItemLink[],
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
      // filterHtmlTags → ArmorShow.filterTip: strip the tooltips, keep the link markers
      const decoded = decodeChatItems(line.msg);
      if (decoded.segments.some((s) => s.sid !== null)) {
        line.msg = decoded.segments.map((s) => s.text).join('');
        line.segments = decoded.segments as ChatItemSegment[];
        line.tips = decoded.tips;
      }
      append(this.messages[channel], line);
      append(this.messages.all, line);
      if (channel === 'private' && this.current !== 'private') this.privateUnread = true;
    },
    /** `CTextInput.addItem`: queue a 装备展示 into the input; false when three are queued. */
    addItemLink(link: ChatItemLink): boolean {
      const next = appendChatItem(this.inputText, this.inputItems, link);
      if (!next) return false;
      this.inputText = next.text;
      this.inputItems = next.items;
      return true;
    },
    /** `BottomPanel.sendChatMsg`'s `chatInput.clear()`. */
    clearInput(): void {
      this.inputText = '';
      this.inputItems = [];
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
