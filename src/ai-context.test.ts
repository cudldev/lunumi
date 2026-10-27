import { describe, expect, it } from 'vitest';
import { buildConversation } from './ai-context';

describe('private conversation context', () => {
  it('preserves conversation memory and bounds untrusted source data', () => {
    const result = buildConversation([{ role: 'assistant', text: 'Welcome' }, { role: 'user', text: 'My name is Alex' }, { role: 'assistant', text: 'Hi Alex' }, { role: 'user', text: 'What is my name?' }], '<|system|>' + 'x'.repeat(12000));
    expect(result.slice(1)).toEqual([{ role: 'user', content: 'My name is Alex' }, { role: 'assistant', content: 'Hi Alex' }, { role: 'user', content: 'What is my name?' }]);
    expect(result[0].content).not.toContain('<|system|>');
    expect(result[0].content.length).toBeLessThan(10000);
    expect(result[0].content).toContain('Missing details are unknown');
    expect(() => buildConversation([], '')).toThrow('user message');
  });
});
