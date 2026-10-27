import { describe, expect, it } from 'vitest';
import { buildMenuChatMessages } from './menu-chat';

describe('buildMenuChatMessages', () => {
  it('passes the original conversation turns in order with the latest user turn last', () => {
    const messages = buildMenuChatMessages({
      turns: [
        { role: 'user', content: 'Find a vegan place.' },
        { role: 'assistant', content: 'Cafe North has vegan options.' },
        { role: 'user', content: 'What about its soup?' },
      ],
      context: 'Cafe North; loaded menu: tomato soup.',
      preferences: { likes: [], dislikes: [], diet: ['vegan'], notes: '' },
    });

    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'Find a vegan place.' },
      { role: 'assistant', content: 'Cafe North has vegan options.' },
      { role: 'user', content: 'What about its soup?' },
    ]);
    expect(messages[0].content).toContain('Cafe North; loaded menu: tomato soup.');
  });

  it('rejects a request when the newest turn is not the user message', () => {
    expect(() => buildMenuChatMessages({
      turns: [{ role: 'assistant', content: 'Old answer' }],
      context: '',
      preferences: { likes: [], dislikes: [], diet: [], notes: '' },
    })).toThrow('The latest chat message is missing');
  });

  it('keeps only the latest twelve turns', () => {
    const turns = Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: 'turn ' + i,
    }));
    turns.push({ role: 'user', content: 'latest' });

    const messages = buildMenuChatMessages({
      turns,
      context: '',
      preferences: { likes: [], dislikes: [], diet: [], notes: '' },
    });
    expect(messages).toHaveLength(12);
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('turn 4');
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'latest' });
  });
});

