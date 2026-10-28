import { expect, it, vi } from 'vitest';
import { GpuDiagnostics } from './gpu-diagnostics';

it('reports device loss and validation details without claiming a root cause', async () => {
  let lose!: (info: { reason: string; message: string }) => void;
  const addEventListener = vi.fn();
  const diagnostics = new GpuDiagnostics('compact', 'q4f16', '1.31.1');
  diagnostics.observe({ adapterInfo: { vendor: 'qualcomm', architecture: 'adreno' }, limits: { maxBufferSize: 512 }, lost: new Promise(resolve => { lose = resolve; }), addEventListener });
  diagnostics.stage = 'readiness';
  expect(() => diagnostics.assertAvailable()).not.toThrow();
  addEventListener.mock.calls[0][1]({ error: { message: 'pipeline validation failed' } });
  lose({ reason: 'unknown', message: 'Instance reference lost' });
  await Promise.resolve();
  expect(() => diagnostics.assertAvailable()).toThrow('WebGPU device was lost');
  const report = diagnostics.describe(new Error('MatMul failed'));
  expect(report).toContain('MatMul failed');
  expect(report).toContain('stage=readiness');
  expect(report).toContain('adapter=qualcomm/adreno');
  expect(report).toContain('deviceLost=unknown: Instance reference lost');
  expect(report).toContain('validation=pipeline validation failed');
});

it('marks unavailable device information without inventing memory or driver errors', () => {
  expect(new GpuDiagnostics('compact', 'q4f16', '1.31.1').describe(new Error('Load failed'))).toContain('device not available; deviceLost=not reported; validation=not reported');
});
