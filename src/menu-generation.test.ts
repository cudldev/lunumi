import { describe, expect, it } from 'vitest';
import { extractGeneratedText } from './menu-generation';

describe('extractGeneratedText', () => {
  it('accepts text-generation string output', () => {
    expect(extractGeneratedText([{ generated_text: 'Hello.' }])).toBe('Hello.');
  });

  it('returns the final assistant message from chat output', () => {
    expect(extractGeneratedText([{ generated_text: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello there.' },
    ] }])).toBe('Hello there.');
  });

  it('does not mistake a trailing user message for the assistant reply', () => {
    expect(extractGeneratedText([{ generated_text: [
      { role: 'assistant', content: 'The answer.' },
      { role: 'user', content: 'Another question.' },
    ] }])).toBe('The answer.');
  });

  it('returns undefined when the pipeline produced no readable text', () => {
    expect(extractGeneratedText([{ generated_text: [{ role: 'assistant', content: null }] }])).toBeUndefined();
    expect(extractGeneratedText([])).toBeUndefined();
  });
});
