import { env, pipeline, TextStreamer, type TextGenerationPipeline } from '@huggingface/transformers';
import type { PromptMessage } from './ai-context';
import type { ModelStage } from './model-state';
import { MODEL_CONFIGS, ORT_RUNTIME_PATH, ORT_RUNTIME_VERSION, ORT_RUNTIME_BACKEND, type ModelSize } from './conversation-config';
import { requireGpuAdapter } from './gpu-support';
import { GpuDiagnostics } from './gpu-diagnostics';
export type AIEvent = { type: 'fallback'; text: string; cause?: string } | { type: 'status'; text: string; stage?: ModelStage; progress?: number } | { type: 'token'; text: string } | { type: 'done'; text: string } | { type: 'error'; text: string };
type Request = { messages: PromptMessage[]; mode: 'chat' | 'plan' | 'prepare'; device: 'webgpu'; modelSize?: ModelSize };
const scope = self as unknown as { postMessage: (event: AIEvent) => void; onmessage: ((event: MessageEvent<Request>) => void) | null };
let generator: TextGenerationPipeline | null = null, running = false;
let diagnostics: GpuDiagnostics | null = null;

async function loadModel(size: ModelSize = 'standard'): Promise<TextGenerationPipeline> {
  if (generator) return generator;
  diagnostics = new GpuDiagnostics(size, MODEL_CONFIGS[size].dtype, ORT_RUNTIME_VERSION + '/' + ORT_RUNTIME_BACKEND);
  await requireGpuAdapter((navigator as unknown as { gpu?: Parameters<typeof requireGpuAdapter>[0] }).gpu);
  env.allowLocalModels = false; env.useBrowserCache = true;
  const wasm = env.backends.onnx.wasm!; wasm.numThreads = 1;
  const base = new URL(import.meta.env.BASE_URL + ORT_RUNTIME_PATH, self.location.origin).href;
  wasm.wasmPaths = { mjs: base + 'ort-wasm-simd-threaded.jsep.mjs', wasm: base + 'ort-wasm-simd-threaded.jsep.wasm' };
  scope.postMessage({ type: 'status', text: 'Checking cached AI files…', stage: 'files' });
  let lastFile = '', lastPercent = -1;
  const progress_callback = (event: { status: string; file?: string; progress?: number }) => {
    const modelFile = /\.onnx$/.test(event.file || '');
    if (event.status === 'progress' && modelFile && typeof event.progress === 'number') {
      const percent = Math.max(0, Math.min(100, Math.floor(event.progress)));
      if (lastFile === event.file && lastPercent === percent) return;
      lastFile = event.file || ''; lastPercent = percent;
      scope.postMessage({ type: 'status', text: 'Downloading the private AI model…', stage: 'download', progress: percent });
    } else if (event.status === 'done' && modelFile) scope.postMessage({ type: 'status', text: 'AI files available. Loading the model into memory…', stage: 'load' });
  };
  const config = MODEL_CONFIGS[size];
  generator = await pipeline('text-generation', config.id, { revision: config.revision, dtype: config.dtype, device: 'webgpu', progress_callback });
  // Read only after session creation: accessing this getter earlier can create a separate device.
  const device = await env.backends.onnx.webgpu?.device;
  if (device) diagnostics.observe(device);
  return generator;
}

scope.onmessage = async event => {
  if (running) { scope.postMessage({ type: 'error', text: 'AI is already answering.' }); return; }
  running = true;
  try {
    const model = await loadModel(event.data.modelSize);
    diagnostics?.assertAvailable();
    if (event.data.mode === 'prepare') {
      if (diagnostics) diagnostics.stage = 'readiness';
      scope.postMessage({ type: 'status', text: 'Running the model readiness check…', stage: 'checking' });
      // A completed download is not sufficient: compile/run actual inference before app entry.
      await model([{ role: 'user', content: 'Hello' }], { max_new_tokens: 1, do_sample: false });
      scope.postMessage({ type: 'done', text: 'ready' }); return;
    }
    scope.postMessage({ type: 'status', text: event.data.mode === 'plan' ? 'Choosing a restaurant action on this device…' : 'Lunumi is thinking on this device…' });
    if (diagnostics) diagnostics.stage = event.data.mode;
    let text = '', planningChunks = 0;
    const streamer = new TextStreamer(model.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: (chunk: string) => {
      text += chunk;
      if (event.data.mode === 'chat') scope.postMessage({ type: 'token', text: chunk });
      else if (++planningChunks % 8 === 1) scope.postMessage({ type: 'status', text: 'Choosing a restaurant action on this device…' });
    } });
    await model(event.data.messages, { max_new_tokens: event.data.mode === 'plan' ? event.data.modelSize === 'compact' ? 96 : 120 : 160, do_sample: false, repetition_penalty: 1.12, no_repeat_ngram_size: 3, streamer });
    if (!text.trim()) throw new Error('The model returned an empty reply. Please retry.');
    scope.postMessage({ type: 'done', text: text.trim() });
  } catch (error) {
    generator = null;
    scope.postMessage({ type: 'error', text: diagnostics?.describe(error) || (error instanceof Error ? error.message : 'WebGPU inference failed on this device.') });
  } finally { running = false; }
};
