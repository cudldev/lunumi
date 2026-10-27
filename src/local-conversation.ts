import type { PromptMessage } from './ai-context';
import type { AIEvent } from './conversation.worker';
import type { ModelSnapshot } from './model-state';
import { currentDevicePrefersCPU, currentModelSize } from './conversation-config';
import { markAIWork } from './model-recovery';

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
type Mode = 'chat' | 'plan' | 'prepare';
export class LocalConversation {
  private worker: WorkerLike | null = null;
  private cpuOnly = currentDevicePrefersCPU();
  private cancel: (() => void) | null = null;
  private pins = 0;
  private state: ModelSnapshot = { phase: 'idle', status: 'Private AI is not prepared yet.' };
  private listeners = new Set<(state: ModelSnapshot) => void>();
  constructor(private createWorker: () => WorkerLike = () => new Worker(new URL('./conversation.worker.ts', import.meta.url), { type: 'module', name: 'lunumi-private-chat' })) {}

  get snapshot(): ModelSnapshot { return this.state; }
  subscribe(listener: (state: ModelSnapshot) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private publish(state: ModelSnapshot) { this.state = state; for (const listener of this.listeners) listener(state); }
  retain() { this.pins++; return () => { this.pins = Math.max(0, this.pins - 1); this.releaseIdle(); }; }
  releaseIdle() { if (!this.cancel && !this.pins) this.stop(); }
  preferCPU() { this.stop(); this.cpuOnly = true; }
  stop() {
    if (this.cancel) { this.cancel(); return; }
    this.worker?.terminate(); this.worker = null;
    markAIWork(false);
    this.publish({ phase: 'idle', status: 'Private AI preparation is paused.' });
  }
  async prepare(signal: AbortSignal, onEvent: (event: AIEvent) => void = () => undefined) {
    signal.throwIfAborted();
    if (this.state.phase === 'ready' && this.worker) return;
    await this.answer([], signal, onEvent, 'prepare');
  }

  async answer(messages: PromptMessage[], signal: AbortSignal, onEvent: (event: AIEvent) => void, mode: Mode = 'chat'): Promise<string> {
    signal.throwIfAborted();
    if (this.cancel) throw new Error('Please wait for the current reply.');
    if (this.state.phase !== 'ready') this.publish({ phase: 'loading', status: 'Checking cached AI files…', stage: 'files' });
    let worker: WorkerLike;
    try { worker = this.worker ||= this.createWorker(); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'The AI worker could not start.';
      this.publish({ phase: 'error', status: 'Private AI could not start.', error: message });
      throw new Error(message);
    }
    markAIWork(true);
    const modelSize = currentModelSize();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { markAIWork(false); clearTimeout(timer); signal.removeEventListener('abort', abort); this.cancel = null; worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; };
      const fail = (error: Error, paused = false) => {
        cleanup(); worker.terminate(); if (this.worker === worker) this.worker = null;
        this.publish(paused ? { phase: 'idle', status: 'Private AI preparation is paused.' } : { phase: 'error', status: 'Private AI is not ready.', error: error.message });
        reject(error);
      };
      const abort = () => fail(new Error('AI reply cancelled.'), true);
      const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => fail(new Error('The private AI took too long. Please retry.')), ms); };
      this.cancel = abort;
      signal.addEventListener('abort', abort, { once: true });
      const bind = () => {
        worker.onmessage = (message: MessageEvent<AIEvent>) => {
          const event = message.data;
          if (event.type === 'fallback') {
            if (modelSize === 'compact') { fail(new Error('Graphics loading failed. AI was stopped to avoid another memory allocation on this device. Try CPU (slower), or continue without AI.' + (event.cause ? '\nGraphics details: ' + event.cause : ''))); return; }
            if (this.cpuOnly) { fail(new Error('The model could not run on the CPU.')); return; }
            worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); this.cpuOnly = true;
            this.publish({ phase: 'loading', status: event.text, stage: 'load' });
            try { worker = this.worker = this.createWorker(); bind(); onEvent({ type: 'status', text: event.text }); worker.postMessage({ messages, mode, device: 'wasm', modelSize }); }
            catch (error) { fail(error instanceof Error ? error : new Error('CPU fallback could not start.')); }
            return;
          }
          if (event.type === 'done') { cleanup(); this.publish({ phase: 'ready', status: 'Private AI is ready. Readiness check passed.' }); resolve(event.text); return; }
          if (event.type === 'error') { fail(new Error(event.text)); return; }
          if (event.type === 'status' && (this.state.phase !== 'ready' || mode === 'prepare')) this.publish({ phase: 'loading', status: event.text, stage: event.stage, progress: event.progress });
          if (event.type === 'token') { arm(90_000); if (mode !== 'prepare' && this.state.phase !== 'ready') this.publish({ phase: 'ready', status: 'Private AI is ready.' }); }
          onEvent(event);
        };
        worker.onerror = () => fail(new Error('The AI worker could not start. Reload or retry in a supported browser.'));
        worker.onmessageerror = () => fail(new Error('The AI worker returned an unreadable message. Please retry.'));
      };
      bind(); arm(6 * 60_000);
      try { worker.postMessage({ messages, mode, device: this.cpuOnly ? 'wasm' : 'auto', modelSize }); }
      catch (error) { fail(error instanceof Error ? error : new Error('Could not start private AI.')); }
    });
  }
}
export const browserConversation = new LocalConversation();
