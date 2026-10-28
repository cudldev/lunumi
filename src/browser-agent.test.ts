import { describe, expect, it, vi } from 'vitest';
import { parseAction, runAgent } from './browser-agent';
const records = [{ id: 'one', name: 'Test Kitchen', cuisine: 'italian', distanceMetres: 100 }];
const turns = [{ role: 'user' as const, text: 'Find somewhere Italian, then open its card.' }];

describe('browser AI agent', () => {
  it('validates structured actions and rejects unsupported tools', () => {
    expect(parseAction('```json\n{"tool":"read_menu","id":"one"}\n```')).toEqual({ tool: 'read_menu', id: 'one' });
    expect(() => parseAction('{"tool":"fetch_url","url":"https://arbitrary.test"}')).toThrow('unsupported');
    expect(() => parseAction('Just open it')).toThrow('valid action');
  });
  it('searches then opens the exact known restaurant card', async () => {
    const plan = vi.fn().mockResolvedValueOnce('{"tool":"search_restaurants","query":"italian"}').mockResolvedValueOnce('{"tool":"open_restaurant","id":"one"}').mockResolvedValueOnce('{"tool":"finish"}');
    const execute = vi.fn().mockResolvedValueOnce(records).mockResolvedValueOnce({ opened: 'one' });
    const result = await runAgent({ turns, records, signal: new AbortController().signal, plan, execute });
    expect(execute.mock.calls.map(([action]) => action.tool)).toEqual(['search_restaurants', 'open_restaurant']);
    expect(result).toHaveLength(2);
    expect(plan.mock.calls[1][0][0].content).toContain('Test Kitchen');
  });
  it('never executes invented IDs and prevents repeated tool loops', async () => {
    const execute = vi.fn();
    await runAgent({ turns, records, signal: new AbortController().signal, plan: async () => '{"tool":"open_restaurant","id":"invented"}', execute });
    expect(execute).not.toHaveBeenCalled();
    await runAgent({ turns, records, signal: new AbortController().signal, plan: async () => '{"tool":"read_menu","id":"one"}', execute });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('reports retrieval failures as facts for the answer and respects cancellation', async () => {
    const results = await runAgent({ turns, records, signal: new AbortController().signal, plan: async () => '{"tool":"read_menu","id":"one"}', execute: async () => { throw new Error('Source blocked'); } });
    expect(results).toEqual([{ tool: 'read_menu', error: 'Source blocked' }]);
    const controller = new AbortController(); controller.abort();
    const execute = vi.fn();
    await expect(runAgent({ turns, records, signal: controller.signal, plan: vi.fn(), execute })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

it('retrieves actual menu evidence even when the planner would answer from memory', async () => {
  const plan = vi.fn().mockResolvedValue('{"tool":"finish"}');
  const execute = vi.fn().mockResolvedValue({ entries: [{ name: 'Soup', price: '12€' }] });
  const result = await runAgent({ turns: [{ role: 'user', text: 'Tell me about the menu at Test Kitchen.' }], records, signal: new AbortController().signal, plan, execute });
  expect(execute).toHaveBeenCalledWith({ tool: 'read_menu', id: 'one' });
  expect(result).toHaveLength(1);
});

it('resolves ordinal references against displayed recommendations rather than catalog order', async () => {
  const second = { id: 'two', name: 'Second Cafe', distanceMetres: 200 };
  const execute = vi.fn().mockResolvedValue({ opened: 'one' });
  await runAgent({ turns: [{ role: 'user', text: 'Open the second restaurant card.' }], records: [...records, second], previousResults: [{ tool: 'recommend_restaurants', result: [second, records[0]] }], signal: new AbortController().signal, plan: async () => '{"tool":"open_restaurant","id":"two"}', execute });
  expect(execute).toHaveBeenCalledWith({ tool: 'open_restaurant', id: 'one' });
});

it('resolves a named restaurant to its real ID for directions', async () => {
  const execute = vi.fn().mockResolvedValue({ directions: 'verified URL' });
  await runAgent({ turns: [{ role: 'user', text: 'Give me directions to Test Kitchen.' }], records, signal: new AbortController().signal, plan: async () => '{"tool":"get_directions","id":"Test Kitchen"}', execute });
  expect(execute).toHaveBeenCalledWith({ tool: 'get_directions', id: 'one' });
});

it('parses the model-supported function-call format and empty no-op calls', () => {
  expect(parseAction('<tool_call>[{"name":"recommend_restaurants","arguments":{"query":"italian","unvisited":true}}]</tool_call>')).toEqual({ tool: 'recommend_restaurants', query: 'italian', unvisited: true });
  expect(parseAction('<tool_call>[]</tool_call>')).toEqual({ tool: 'finish' });
});

it('keeps discovery grounded when the model declines a natural nearby request', async () => {
  const execute = vi.fn().mockResolvedValue(records);
  await runAgent({ turns: [{ role: 'user', text: 'Recommend somewhere Italian nearby that I have not visited yet.' }], records, signal: new AbortController().signal, plan: async () => '<tool_call>[]</tool_call>', execute });
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ tool: 'recommend_restaurants', unvisited: true }));
});

it('sends ordinary chat directly to conversation without any hidden planning call', async () => {
  const plan=vi.fn(), execute=vi.fn();
  for(const text of ['Hello!', 'My name is Alex.', 'What is my name?', 'Recommend a good science fiction book.', 'How are you today?']) {
    expect(await runAgent({turns:[{role:'user',text}],records,selectedId:'one',previousResults:[{tool:'recommend_restaurants',result:records}],signal:new AbortController().signal,plan,execute,compact:true})).toEqual([]);
  }
  expect(plan).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
});

it('uses verified tools directly for clear mobile requests, including ordinal card handoff', async () => {
  const plan=vi.fn(), execute=vi.fn().mockResolvedValue(records);
  for(const [text,expected] of [['Find Italian restaurants nearby.','search_restaurants'],['Recommend a new restaurant.','recommend_restaurants'],['Show the menu at Test Kitchen.','read_menu'],['Give me directions to Test Kitchen.','get_directions'],['Open the first restaurant card.','open_restaurant']]) {
    execute.mockClear();
    await runAgent({turns:[{role:'user',text}],records,previousResults:[{tool:'search_restaurants',result:records}],signal:new AbortController().signal,plan,execute,compact:true});
    expect(execute).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledWith(expect.objectContaining({tool:expected}));
  }
  expect(plan).not.toHaveBeenCalled();
});
