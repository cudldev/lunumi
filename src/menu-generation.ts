type GeneratedMessage = {
  role?: unknown;
  content?: unknown;
};

/** Read either Transformers.js string output or the chat-message output shape. */
export function extractGeneratedText(output: unknown): string | undefined {
  if (!Array.isArray(output) || output.length === 0 || !output[0] || typeof output[0] !== 'object') return undefined;
  const generated = (output[0] as { generated_text?: unknown }).generated_text;
  if (typeof generated === 'string') return generated;
  if (!generated || typeof generated !== 'object') return undefined;

  const messages: GeneratedMessage[] = Array.isArray(generated)
    ? generated.filter((message): message is GeneratedMessage => Boolean(message) && typeof message === 'object')
    : [generated as GeneratedMessage];
  const assistantMessage = [...messages].reverse().find(message => message.role === 'assistant' && typeof message.content === 'string');
  const lastTextMessage = [...messages].reverse().find(message => typeof message.content === 'string');
  const content = assistantMessage?.content ?? lastTextMessage?.content;
  return typeof content === 'string' ? content : undefined;
}
