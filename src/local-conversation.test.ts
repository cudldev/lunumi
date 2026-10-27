import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalConversation } from './local-conversation';
const messages = [{ role: 'user' as const, content: 'Hello' }];
function fakeWorker() { return { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null, onerror: null as Worker['onerror'], onmessageerror: null as Worker['onmessageerror'] }; }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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
    await second; expect(create).toHaveBeenCalledTimes(1); expect(worker.postMessage).toHaveBeenCalledWith({ messages, mode: 'chat', device: 'auto', modelSize: 'standard' });
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
  expect(cpu.postMessage).toHaveBeenCalledWith({ messages, mode: 'plan', device: 'wasm', modelSize: 'standard' });
  cpu.onmessage!(new MessageEvent('message', { data: { type: 'done', text: '{"tool":"finish"}' } }));
  expect(await pending).toBe('{"tool":"finish"}');
  expect(events).toHaveBeenCalledWith({ type: 'status', text: 'Retrying on CPU' });
  client.stop();
});

it('keeps the app locked at 100% until inference completes, and retains the ready worker', async () => {
  const worker = fakeWorker(), client = new LocalConversation(() => worker), release = client.retain();
  const pending = client.prepare(new AbortController().signal);
  expect(worker.postMessage).toHaveBeenCalledWith({ messages: [], mode: 'prepare', device: 'auto', modelSize: 'standard' });
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

it('sends compact weights to mobile workers and avoids an automatic second memory allocation', async () => {
  vi.stubGlobal('navigator', {userAgent:'iPhone Safari'});
  const worker = fakeWorker(), create = vi.fn(() => worker), client = new LocalConversation(create);
  const pending = client.prepare(new AbortController().signal);
  expect(worker.postMessage).toHaveBeenCalledWith({messages:[],mode:'prepare',device:'auto',modelSize:'compact'});
  worker.onmessage!(new MessageEvent('message', {data:{type:'fallback',text:'GPU failed'}}));
  await expect(pending).rejects.toThrow('another memory allocation');
  expect(create).toHaveBeenCalledTimes(1); expect(client.snapshot.phase).toBe('error');
});

it('leaves a recovery marker during active work and clears it on cancellation', async () => {
  const data = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(key:string)=>data.get(key),setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)});
  const worker = fakeWorker(), client = new LocalConversation(() => worker), controller = new AbortController();
  const pending = client.prepare(controller.signal);
  expect(data.get('lunumi-ai-work-pending')).toBe('yes');
  controller.abort(); await expect(pending).rejects.toThrow('cancelled');
  expect(data.has('lunumi-ai-work-pending')).toBe(false);
});

it('retries compact loading on CPU only after an explicit request', async () => {
  vi.stubGlobal('navigator', {userAgent:'Android SamsungBrowser/27'});
  const gpu = fakeWorker(), cpu = fakeWorker(), create = vi.fn().mockReturnValueOnce(gpu).mockReturnValueOnce(cpu), client = new LocalConversation(create);
  const first = client.prepare(new AbortController().signal);
  gpu.onmessage!(new MessageEvent('message', {data:{type:'fallback',text:'Graphics failed'}}));
  await expect(first).rejects.toThrow('another memory allocation');
  expect(create).toHaveBeenCalledTimes(1);
  client.preferCPU();
  const retry = client.prepare(new AbortController().signal);
  expect(cpu.postMessage).toHaveBeenCalledWith({messages:[],mode:'prepare',device:'wasm',modelSize:'compact'});
  cpu.onmessage!(new MessageEvent('message', {data:{type:'done',text:'ready'}}));
  await retry; expect(client.snapshot.phase).toBe('ready'); client.stop();
});
