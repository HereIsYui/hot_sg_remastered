import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '../stores/chat';
import { chatReplyError, filterChatMessage, parseChatInput, validChatMessage } from './chat';

beforeEach(() => setActivePinia(createPinia()));

describe('chat input and keyword filtering', () => {
  it('parses private slash commands and validates blank messages', () => {
    expect(parseChatInput('/玩家甲　你好', 'world')).toEqual({
      channel: 'private',
      touser: '玩家甲',
      msg: '你好',
    });
    expect(parseChatInput('联盟好', 'union')).toEqual({
      channel: 'union',
      touser: '',
      msg: '联盟好',
    });
    expect(validChatMessage(' \u3000')).toBe(false);
    expect(validChatMessage('正文')).toBe(true);
    expect(chatReplyError({ nouser: 1 })).toBe('私聊玩家不存在。');
  });

  it('ports punctuation removal and replacement for matching keywords', () => {
    expect(filterChatMessage('你，好', ['坏'])).toBe('你，好');
    expect(filterChatMessage('你，好', ['好'])).toBe('你!*%');
    expect(filterChatMessage('坏坏', ['坏', '坏'])).toBe('!*%!*%');
    expect(filterChatMessage('<b>正文</b>', [])).toBe('<b>正文</b>');
  });
});

describe('chat store channels', () => {
  it('keeps channel and combined lists without duplicate sender echoes', () => {
    const chat = useChatStore();
    chat.receive('world', { fromuid: 2, fromuser: '乙', msg: '世界' }, true);
    chat.receive('union', { fromuid: 2, fromuser: '乙', msg: '联盟' });
    chat.receive('private', { fromuid: 2, fromuser: '乙', touser: '甲', msg: '私聊' });
    expect(chat.messages.world).toHaveLength(1);
    expect(chat.messages.union).toHaveLength(1);
    expect(chat.messages.private).toHaveLength(1);
    expect(chat.messages.all).toHaveLength(3);
    expect(chat.privateUnread).toBe(true);
    chat.selectChannel('private');
    expect(chat.privateUnread).toBe(false);
  });

  it('filters keywords and blocked players before storing messages', () => {
    const chat = useChatStore();
    chat.setKeywords(['坏']);
    chat.receive('world', { fromuser: '乙', msg: '好坏。' });
    expect(chat.messages.world[0]?.msg).toBe('好!*%');
    expect(chat.blockUser('丙')).toBe(true);
    chat.receive('world', { fromuser: '丙', msg: '不可见' });
    expect(chat.messages.world).toHaveLength(1);
    chat.unblockUser('丙');
    chat.receive('world', { fromuser: '丙', msg: '可见' });
    expect(chat.messages.world).toHaveLength(2);
  });
});
