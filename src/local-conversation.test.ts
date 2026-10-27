import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalConversation } from './local-conversation';
const messages = [{ role: 'user' as const, content: 'Hello' }];
function fakeWorker() { return { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null, onerror: null as Worker['onerror'], onmessageerror: null as Worker['onmessageerror'] }; }
afterEach(() => vi.useRealTimers());

describe('AI worker lifecycle', () => {
  it('streams tokens, completes, and reuses a loaded worker', async () => {
    const worker = fakeWorker(), create = vi.fn(() => worker), events = vi.fn();
    const client = new LocalConversation(create);
    const first = client.answer(messages, new AbortController().signal, events);
    worker.onmessage!(new MessageEvent('message', { data: { type: 'token', text: 'Hello' } }));
    worker.onmessage!(new MessageEvent('message', { data: { type: 'done', text: 'Hello!' } }));
    expect(await first).toBe('Hello!'); expect(events).toHaveBeenCalledWith({ type: 'token', text: 'Hello' });
    const second = client.answer(messages, new AbortController().signal, events);
    worker.onmessage!(new MessageEvent('message', { data: { type: 'done', text: 'Again' } }));
    await second; expect(create).toHaveBeenCalledTimes(1); expect(worker.postMessage).toHaveBeenCalledWith({ messages, mode: 'chat', device: 'auto' });
    client.stop(); expect(worker.terminate).toHaveBeenCalled();
  });
  it('terminates on cancellation and allows a fresh retry', async () => {
    const worker = fakeWorker(), client = new LocalConversation(() => worker), controller = new AbortController();
    const pending = client.answer(messages, controller.signal, vi.fn());
    controller.abort(); await expect(pending).rejects.toThrow('cancelled');
    expect(worker.terminate).toHaveBeenCalled(); expect(worker.onmessage).toBeNull();
    const retry = client.answer(messages, new AbortController().signal, vi.fn());
    worker.onmessage!(new MessageEvent('message', { data: { type: 'done', text: 'Recovered' } }));
    expect(await retry).toBe('Recovered');
  });
  it('stops stalled generation and resets the worker after model errors', async () => {
    vi.useFakeTimers();
    const worker = fakeWorker(), client = new LocalConversation(() => worker);
    const stalled = client.answer(messages, new AbortController().signal, vi.fn());
    const rejected = expect(stalled).rejects.toThrow('too long');
    worker.onmessage!(new MessageEvent('message', { data: { type: 'token', text: 'Start' } }));
    await vi.advanceTimersByTimeAsync(90_001); await rejected;
    const retry = client.answer(messages, new AbortController().signal, vi.fn());
    worker.onmessage!(new MessageEvent('message', { data: { type: 'error', text: 'GPU lost' } }));
    await expect(retry).rejects.toThrow('GPU lost');
    expect(worker.terminate).toHaveBeenCalledTimes(2);
  });
});

it('retries a failed GPU initializer in a fresh CPU worker using cached weights', async () => {
  const gpu = fakeWorker(), cpu = fakeWorker(), create = vi.fn().mockReturnValueOnce(gpu).mockReturnValueOnce(cpu);
  const client = new LocalConversation(create), events = vi.fn();
  const pending = client.answer(messages, new AbortController().signal, events, 'plan');
  gpu.onmessage!(new MessageEvent('message', { data: { type: 'fallback', text: 'Retrying on CPU' } }));
  expect(gpu.terminate).toHaveBeenCalled();
  expect(cpu.postMessage).toHaveBeenCalledWith({ messages, mode: 'plan', device: 'wasm' });
  cpu.onmessage!(new MessageEvent('message', { data: { type: 'done', text: '{"tool":"finish"}' } }));
  expect(await pending).toBe('{"tool":"finish"}');
  expect(events).toHaveBeenCalledWith({ type: 'status', text: 'Retrying on CPU' });
  client.stop();
});

it('keeps the app locked at 100% until inference completes, and retains the ready worker', async () => {
  const worker = fakeWorker(), client = new LocalConversation(() => worker), release = client.retain();
  const pending = client.prepare(new AbortController().signal);
  expect(worker.postMessage).toHaveBeenCalledWith({ messages: [], mode: 'prepare', device: 'auto' });
  worker.onmessage!(new MessageEvent('message', { data: { type: 'status', text: 'Downloaded', stage: 'download', progress: 100 } }));
  expect(client.snapshot.phase).toBe('loading');
  worker.onmessage!(new MessageEvent('message', { data: { type: 'status', text: 'Checking inference', stage: 'checking' } }));
  expect(client.snapshot.phase).toBe('loading');
  worker.onmessage!(new MessageEvent('message', { data: { type: 'done', text: 'ready' } }));
  await pending;
  expect(client.snapshot.phase).toBe('ready');
  client.releaseIdle(); expect(worker.terminate).not.toHaveBeenCalled();
  await client.prepare(new AbortController().signal);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  release(); expect(worker.terminate).toHaveBeenCalledOnce(); expect(client.snapshot.phase).toBe('idle');
});

it('exposes worker startup errors and lets preparation retry', async () => {
  const worker = fakeWorker(), create = vi.fn().mockImplementationOnce(() => { throw new Error('Worker blocked'); }).mockReturnValue(worker);
  const client = new LocalConversation(create);
  await expect(client.prepare(new AbortController().signal)).rejects.toThrow('Worker blocked');
  expect(client.snapshot).toMatchObject({ phase: 'error', error: 'Worker blocked' });
  const retry = client.prepare(new AbortController().signal);
  worker.onmessage!(new MessageEvent('message', { data: { type: 'done', text: 'ready' } }));
  await retry; expect(client.snapshot.phase).toBe('ready'); client.stop();
});
