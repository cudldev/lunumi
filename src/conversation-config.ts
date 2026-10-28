export const MODEL_ID = 'HuggingFaceTB/SmolLM2-1.7B-Instruct';
export const MODEL_REVISION = '31b70e2e869a7173562077fd711b654946d38674';
export type ModelSize = 'compact' | 'standard';
export const MODEL_CONFIGS = {
  standard: { id: MODEL_ID, revision: MODEL_REVISION, download: '1.1 GB' },
  compact: { id: 'HuggingFaceTB/SmolLM2-360M-Instruct', revision: 'a10cc1512eabd3dde888204e902eca88bddb4951', download: '273 MB' },
} as const;
type DeviceHints = { userAgent?: string; maxTouchPoints?: number; deviceMemory?: number };
export function modelSizeForDevice(device: DeviceHints): ModelSize {
  return /Android|iPhone|iPad|iPod|Mobile|SamsungBrowser/i.test(device.userAgent || '') || (/Macintosh/i.test(device.userAgent || '') && (device.maxTouchPoints || 0) > 1) || (typeof device.deviceMemory === 'number' && device.deviceMemory <= 4) ? 'compact' : 'standard';
}
export function currentModelSize(): ModelSize { return modelSizeForDevice(typeof navigator === 'undefined' ? {} : navigator as DeviceHints); }
export function currentModelConfig() { return MODEL_CONFIGS[currentModelSize()]; }
