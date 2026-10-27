export type MenuModelProgress = { status: string; file?: string; progress?: number };
export type MenuModelPreferences = { likes: string[]; dislikes: string[]; diet: string[]; notes: string };
export type MenuAssistantTurn = { role: 'user' | 'assistant'; content: string };
type WorkerResponse =
  | { type: 'progress'; progress: MenuModelProgress }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };
type PendingRequest = { resolve: (text: string) => void; reject: (error: Error) => void };
type WorkerTask =
  | { type: 'analyze'; restaurantName: string; language: string; sourceText: string; preferences: MenuModelPreferences }
  | { type: 'chat'; turns: MenuAssistantTurn[]; context: string; preferences: MenuModelPreferences };

let worker: Worker | null = null;
let modelPromise: Promise<void> | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingRequest>();
const progressSubscribers = new Set<(progress: MenuModelProgress) => void>();

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
      pending.get(message.id)?.reject(error);
      pending.delete(message.id);
      return;
    }
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    modelPromise = null;
  };
  worker.onerror = event => {
    const error = new Error(event.message || 'The local AI worker failed to start.');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    modelPromise = null;
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function prepareLocalMenuModel(onProgress: (progress: MenuModelProgress) => void): Promise<void> {
  progressSubscribers.add(onProgress);
  const instance = ensureWorker();
  if (!modelPromise) {
    modelPromise = new Promise<void>((resolve, reject) => {
      const listener = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') {
          instance.removeEventListener('message', listener);
          resolve();
        } else if (event.data.type === 'error' && event.data.id === undefined) {
          instance.removeEventListener('message', listener);
          reject(new Error(event.data.message));
        }
      };
      instance.addEventListener('message', listener);
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
    pending.set(id, { resolve, reject });
    instance.postMessage({ ...request, id });
  });
}
