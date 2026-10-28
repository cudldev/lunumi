import { expect, it, vi } from 'vitest';
import { requireGpuAdapter } from './gpu-support';
it('requires a WebGPU adapter and shader-f16 before model loading', async () => {
  await expect(requireGpuAdapter()).rejects.toThrow('WebGPU is unavailable');
  await expect(requireGpuAdapter({requestAdapter:async()=>null})).rejects.toThrow('CPU fallback is disabled');
  await expect(requireGpuAdapter({requestAdapter:async()=>({features:new Set<string>()})})).rejects.toThrow('shader-f16');
  const adapter={features:new Set(['shader-f16'])}, requestAdapter=vi.fn().mockResolvedValue(adapter);
  expect(await requireGpuAdapter({requestAdapter})).toBe(adapter);
  expect(requestAdapter).toHaveBeenCalledOnce();
});
