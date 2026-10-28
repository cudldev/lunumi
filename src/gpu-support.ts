export type GPUAdapterLike = { features: { has(feature: string): boolean } };
export async function requireGpuAdapter(gpu?: { requestAdapter(): Promise<GPUAdapterLike | null> }): Promise<GPUAdapterLike> {
  const adapter = await gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU is unavailable in this browser. GPU inference is required; CPU fallback is disabled.');
  if (!adapter.features.has('shader-f16')) throw new Error('This WebGPU adapter lacks shader-f16 support required by the GPU weights. CPU fallback is disabled.');
  return adapter;
}
