export type MenuModelProgress = { status: string; file?: string; progress?: number; device?: 'webgpu' | 'wasm' };
export type MenuModelPreferences = { likes: string[]; dislikes: string[]; diet: string[]; notes: string };
export type MenuAssistantTurn = { role: 'user' | 'assistant'; content: string };
type WorkerResponse =
  | { type: 'progress'; progress: MenuModelProgress }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };
type PendingRequest = { resolve: (text: string) => void; reject: (error: Error) => void; timeout: number };
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
const INFERENCE_TIMEOUT_MS = 2 * 60_000;

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
    if (message.type === 'result') {
      pending.get(message.id)?.resolve(message.text);
      pending.delete(message.id);
      return;
    }
    const error = new Error(message.message);
    if (message.id !== undefined) {
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
      instance.postMessage({ type: 'initialize' });
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
}): Promise<string> {
  await prepareLocalMenuModel(() => undefined);
  return sendToWorker({ type: 'analyze', ...input });
}

export async function chatWithLocalAssistant(input: {
  turns: MenuAssistantTurn[];
  context: string;
  preferences: MenuModelPreferences;
}): Promise<string> {
  await prepareLocalMenuModel(() => undefined);
  return sendToWorker({ type: 'chat', ...input });
}

async function sendToWorker(request: WorkerTask): Promise<string> {
  const id = ++nextRequestId;
  const instance = ensureWorker();
  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => stopWorker(new Error('The local AI took too long to respond. The model was stopped to free this device; please try again.')), INFERENCE_TIMEOUT_MS);
    pending.set(id, {
      resolve: text => { window.clearTimeout(timeout); resolve(text); },
      reject: error => { window.clearTimeout(timeout); reject(error); },
      timeout,
    });
    instance.postMessage({ ...request, id });
  });
}
