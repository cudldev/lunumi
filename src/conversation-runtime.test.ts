import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { ORT_RUNTIME_PATH, ORT_RUNTIME_VERSION, ORT_RUNTIME_BACKEND } from './conversation-config';
it('ships the same runtime version for the JS dependency and browser WASM URLs', () => {
  const require=createRequire(import.meta.url);
  const runtimeRoot=join(dirname(require.resolve('onnxruntime-web/webgpu')), '..');
  expect(JSON.parse(readFileSync(join(runtimeRoot,'package.json'),'utf8')).version).toBe(ORT_RUNTIME_VERSION);
  expect(ORT_RUNTIME_BACKEND).toBe('jsep');
  expect(ORT_RUNTIME_PATH).toBe(`onnxruntime/ort-${ORT_RUNTIME_VERSION}-jsep/`);
});
it('pins the unmodified official CI package archives for the patched-runtime trial', () => {
  const files = [
    ['common', '48cbea408d157a65a302a1c35068edcf17edd3aeab67845d573ac797a88aceb1'],
    ['web', '62bfba09728226ba8c57df427e261340843ccabbd4012ae638f7992479edf7a3'],
  ];
  for (const [name, hash] of files) {
    const file = new URL(`../vendor/onnxruntime/onnxruntime-${name}-${ORT_RUNTIME_VERSION}.tgz`, import.meta.url);
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
  }
});
