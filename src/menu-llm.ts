export type MenuModelProgress = { status: string; file?: string; progress?: number; device?: 'webgpu' };
export type MenuModelPreferences = { likes: string[]; dislikes: string[]; diet: string[]; notes: string };
export type MenuAssistantTurn = { role: 'user' | 'assistant'; content: string };
type WorkerResponse =
  | { type: 'progress'; progress: MenuModelProgress }
  | { type: 'ready' }
  | { type: 'activity'; id: number; text: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };
type PendingRequest = { resolve: (text: string) => void; reject: (error: Error) => void; onActivity?: (text: string) => void; timeout: number };
type WorkerTask =
  | { type: 'analyze'; restaurantName: string; language: string; sourceText: string; preferences: MenuModelPreferences }
  | { type: 'chat'; turns: MenuAssistantTurn[]; context: string; preferences: MenuModelPreferences };

let worker: Worker | null = null;
let modelPromise: Promise<void> | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingRequest>();
const progressSubscribers = new Set<(progress: MenuModelProgress) => void>();
let rejectInitialization: ((error: Error) => void) | null = null;
const MODEL_START_TIMEOUT_MS = 4 * 60_000;
// This is an inactivity timeout, refreshed whenever the worker produces output.
const INFERENCE_IDLE_TIMEOUT_MS = 90_000;

function armRequestTimeout(request: PendingRequest): void {
  window.clearTimeout(request.timeout);
  request.timeout = window.setTimeout(() => stopWorker(new Error('Lunumi’s WebGPU model stopped responding. The request was stopped; please retry or reload the app.')), INFERENCE_IDLE_TIMEOUT_MS);
}

function refreshPendingTimeouts(): void {
  for (const request of pending.values()) armRequestTimeout(request);
}

function isWebGpuFailure(error: Error): boolean {
  return /webgpu|gpu|adapter|device lost|ortRun|groupqueryattention|external instance|compute pipeline/i.test(error.message);
}

function displayWorkerError(error: Error): Error {
  if (!isWebGpuFailure(error)) return error;
  return new Error(`Lunumi needs working WebGPU on this device. The local model could not run; no CPU model will be downloaded. Try reloading or using a supported browser. ${error.message.slice(0, 260)}`);
}

function stopWorker(error: Error): void {
  const currentWorker = worker;
  worker = null;
  modelPromise = null;
  currentWorker?.terminate();
  rejectInitialization?.(error);
  rejectInitialization = null;
  for (const request of pending.values()) {
    window.clearTimeout(request.timeout);
    request.reject(error);
  }
  pending.clear();
}

export function subscribeLocalMenuModelProgress(onProgress: (progress: MenuModelProgress) => void): () => void {
  progressSubscribers.add(onProgress);
  return () => progressSubscribers.delete(onProgress);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./menu-llm.worker.ts', import.meta.url), { type: 'module', name: 'lunumi-local-menu-ai' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'progress') {
      for (const subscriber of progressSubscribers) subscriber(message.progress);
      return;
    }
    if (message.type === 'ready') return;
    if (message.type === 'activity') {
      const request = pending.get(message.id);
      if (!request) return;
      // Requests share one serial queue, so activity in the active generation
      // also means any later request is still waiting its turn normally.
      refreshPendingTimeouts();
      request.onActivity?.(message.text);
      return;
    }
    if (message.type === 'result') {
      pending.get(message.id)?.resolve(message.text);
      pending.delete(message.id);
      refreshPendingTimeouts();
      return;
    }
    const error = new Error(message.message);
    if (message.id !== undefined) {
      if (isWebGpuFailure(error)) {
        stopWorker(displayWorkerError(error));
        return;
      }
      const request = pending.get(message.id);
      if (request) window.clearTimeout(request.timeout);
      request?.reject(error);
      pending.delete(message.id);
      return;
    }
    stopWorker(displayWorkerError(error));
  };
  worker.onerror = event => {
    const location = event.filename ? ` (${event.filename}${event.lineno ? `:${event.lineno}` : ''})` : '';
    const detail = event.message || 'The local AI worker failed to start.';
    stopWorker(displayWorkerError(new Error(`${detail}${location}`)));
  };
  return worker;
}

async function requireWebGpuAdapter(): Promise<void> {
  type NavigatorWithWebGpu = Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
  const gpu = (navigator as NavigatorWithWebGpu).gpu;
  if (!gpu) throw new Error('Lunumi AI needs WebGPU, which is not available in this browser. The assistant is disabled on this device.');
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error('This browser exposes WebGPU but returned no usable GPU adapter. Update the browser and device, restart the browser, or try another WebGPU-capable browser. Lunumi will not download a CPU model.');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Lunumi AI needs a compatible WebGPU adapter. The assistant is disabled on this device. ${detail.slice(0, 180)}`);
  }
}

export async function prepareLocalMenuModel(onProgress: (progress: MenuModelProgress) => void): Promise<void> {
  progressSubscribers.add(onProgress);
  try {
    await requireWebGpuAdapter();
    const instance = ensureWorker();
    if (!modelPromise) {
      modelPromise = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => stopWorker(new Error('The local AI took too long to start. Please try again.')), MODEL_START_TIMEOUT_MS);
      const finish = (result?: Error) => {
        window.clearTimeout(timeout);
        instance.removeEventListener('message', listener);
        rejectInitialization = null;
        if (result) reject(result);
        else resolve();
      };
      const listener = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') {
          finish();
        } else if (event.data.type === 'error' && event.data.id === undefined) {
          finish(new Error(event.data.message));
        }
      };
      instance.addEventListener('message', listener);
      rejectInitialization = finish;
      instance.postMessage({ type: 'initialize' });
      }).catch(error => {
        modelPromise = null;
        throw error;
      });
    }
    await modelPromise;
  } finally {
    progressSubscribers.delete(onProgress);
  }
}

export async function analyzeMenuLocally(input: {
  restaurantName: string;
  language: string;
  sourceText: string;
  preferences: MenuModelPreferences;
}, onActivity?: (text: string) => void): Promise<string> {
  await prepareLocalMenuModel(() => undefined);
  return sendToWorker({ type: 'analyze', ...input }, onActivity);
}

export async function chatWithLocalAssistant(input: {
  turns: MenuAssistantTurn[];
  context: string;
  preferences: MenuModelPreferences;
}, onActivity?: (text: string) => void): Promise<string> {
  await prepareLocalMenuModel(() => undefined);
  return sendToWorker({ type: 'chat', ...input }, onActivity);
}

async function sendToWorker(request: WorkerTask, onActivity?: (text: string) => void): Promise<string> {
  const id = ++nextRequestId;
  const instance = ensureWorker();
  return new Promise<string>((resolve, reject) => {
    const requestState: PendingRequest = {
      resolve: text => { window.clearTimeout(requestState.timeout); resolve(text); },
      reject: error => { window.clearTimeout(requestState.timeout); reject(error); },
      onActivity,
      timeout: 0,
    };
    armRequestTimeout(requestState);
    pending.set(id, requestState);
    instance.postMessage({ ...request, id });
  });
}
