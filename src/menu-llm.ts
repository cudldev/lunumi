export type MenuModelProgress = { status: string; file?: string; progress?: number; device?: 'webgpu' | 'wasm' };
export type MenuModelPreferences = { likes: string[]; dislikes: string[]; diet: string[]; notes: string };
export type MenuAssistantTurn = { role: 'user' | 'assistant'; content: string };
type WorkerResponse =
  | { type: 'progress'; progress: MenuModelProgress }
  | { type: 'ready' }
  | { type: 'activity'; id: number; text: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };
type PendingRequest = { resolve: (text: string) => void; reject: (error: Error) => void; onActivity?: (text: string) => void; task: WorkerTask; timeout: number };
type WorkerTask =
  | { type: 'analyze'; restaurantName: string; language: string; sourceText: string; preferences: MenuModelPreferences }
  | { type: 'chat'; turns: MenuAssistantTurn[]; context: string; preferences: MenuModelPreferences };

let worker: Worker | null = null;
let modelPromise: Promise<void> | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingRequest>();
const progressSubscribers = new Set<(progress: MenuModelProgress) => void>();
let rejectInitialization: ((error: Error) => void) | null = null;
let forceCpuWorker = false;
let currentDevice: 'webgpu' | 'wasm' = 'webgpu';
const MODEL_START_TIMEOUT_MS = 4 * 60_000;
// This is an inactivity timeout, refreshed whenever the worker produces output.
// It catches a lost WebGPU context without cutting off slower menu generations.
const INFERENCE_IDLE_TIMEOUT_MS = 90_000;

function armRequestTimeout(request: PendingRequest): void {
  window.clearTimeout(request.timeout);
  request.timeout = window.setTimeout(() => {
    if (currentDevice === 'webgpu' && !forceCpuWorker) {
      retryPendingRequestsOnCpu();
      return;
    }
    stopWorker(new Error('The local AI stopped responding. It was stopped to free this device; please try again.'));
  }, INFERENCE_IDLE_TIMEOUT_MS);
}

function refreshPendingTimeouts(): void {
  for (const request of pending.values()) armRequestTimeout(request);
}

function isWebGpuFailure(error: Error): boolean {
  return /webgpu|gpu|adapter|device lost|ortRun|groupqueryattention|external instance|compute pipeline/i.test(error.message);
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

function retryPendingRequestsOnCpu(): void {
  if (forceCpuWorker) return;
  worker?.terminate();
  worker = null;
  modelPromise = null;
  forceCpuWorker = true;
  currentDevice = 'wasm';
  for (const request of pending.values()) window.clearTimeout(request.timeout);
  const progress: MenuModelProgress = { status: 'WebGPU stopped responding; retrying with the local CPU model', device: 'wasm' };
  for (const subscriber of progressSubscribers) subscriber(progress);
  void prepareLocalMenuModel(() => undefined).then(() => {
    const instance = ensureWorker();
    for (const [id, request] of pending) {
      armRequestTimeout(request);
      instance.postMessage({ ...request.task, id });
    }
  }).catch(error => stopWorker(error instanceof Error ? error : new Error('The local CPU model could not be started.')));
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
      currentDevice = message.progress.device ?? currentDevice;
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
      if (currentDevice === 'webgpu' && !forceCpuWorker && isWebGpuFailure(error)) {
        retryPendingRequestsOnCpu();
        return;
      }
      const request = pending.get(message.id);
      if (request) window.clearTimeout(request.timeout);
      request?.reject(error);
      pending.delete(message.id);
      return;
    }
    stopWorker(error);
  };
  worker.onerror = event => {
    stopWorker(new Error(event.message || 'The local AI worker failed to start.'));
  };
  return worker;
}

export function prepareLocalMenuModel(onProgress: (progress: MenuModelProgress) => void): Promise<void> {
  progressSubscribers.add(onProgress);
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
      instance.postMessage({ type: 'initialize', ...(forceCpuWorker ? { device: 'wasm' as const } : {}) });
    }).catch(error => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise.finally(() => progressSubscribers.delete(onProgress));
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
      task: request,
      timeout: 0,
    };
    armRequestTimeout(requestState);
    pending.set(id, requestState);
    instance.postMessage({ ...request, id });
  });
}
