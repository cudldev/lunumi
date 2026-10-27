import type { PromptMessage } from './ai-context';
import type { AIEvent } from './conversation.worker';

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
export class LocalConversation {
  private worker: WorkerLike | null = null;
  private cpuOnly = false;
  private cancel: (() => void) | null = null;
  constructor(private createWorker: () => WorkerLike = () => new Worker(new URL('./conversation.worker.ts', import.meta.url), { type: 'module', name: 'lunumi-private-chat' })) {}

  releaseIdle() { if (!this.cancel) this.stop(); }

  stop() { this.cancel?.(); this.worker?.terminate(); this.worker = null; }

  async answer(messages: PromptMessage[], signal: AbortSignal, onEvent: (event: AIEvent) => void, mode: 'chat' | 'plan' = 'chat'): Promise<string> {
    signal.throwIfAborted();
    if (this.cancel) throw new Error('Please wait for the current reply.');
    let worker = this.worker ||= this.createWorker();
    return new Promise((resolve, reject) => {
      // First download can be slow. Once tokens begin, a separate inactivity limit applies.
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); this.cancel = null; worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; };
      const fail = (error: Error) => { cleanup(); worker.terminate(); if (this.worker === worker) this.worker = null; reject(error); };
      const abort = () => fail(new Error('AI reply cancelled.'));
      const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => fail(new Error('The private AI took too long. Retry, or use the menu tools.')), ms); };
      this.cancel = abort;
      signal.addEventListener('abort', abort, { once: true });
      const bind = () => { worker.onmessage = (message: MessageEvent<AIEvent>) => {
        const event = message.data;
        if (event.type === 'fallback') {
          if (this.cpuOnly) { fail(new Error('The model could not run on the CPU.')); return; }
          worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
          this.cpuOnly = true;
          try { worker = this.worker = this.createWorker(); bind(); onEvent({ type: 'status', text: event.text }); worker.postMessage({ messages, mode, device: 'wasm' }); }
          catch (error) { fail(error instanceof Error ? error : new Error('CPU fallback could not start.')); }
          return;
        }
        if (event.type === 'done') { cleanup(); resolve(event.text); return; }
        if (event.type === 'error') { fail(new Error(event.text)); return; }
        if (event.type === 'token') arm(90_000);
        onEvent(event);
      };
      worker.onerror = () => fail(new Error('The AI worker could not start. Reload or retry; menu tools still work.'));
      worker.onmessageerror = () => fail(new Error('The AI worker returned an unreadable message. Please retry.'));
      };
      bind();
      arm(6 * 60_000);
      try { worker.postMessage({ messages, mode, device: this.cpuOnly ? 'wasm' : 'auto' }); } catch (error) { fail(error instanceof Error ? error : new Error('Could not start private AI.')); }
    });
  }
}

// One lazy worker is shared by global chat and restaurant panels to avoid duplicate model memory.
export const browserConversation = new LocalConversation();
