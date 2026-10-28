import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { ORT_RUNTIME_PATH, ORT_RUNTIME_VERSION } from './conversation-config';
it('ships the same runtime version for the JS dependency and browser WASM URLs', () => {
  const require=createRequire(import.meta.url);
  const runtimeRoot=join(dirname(require.resolve('onnxruntime-web/webgpu')), '..');
  expect(JSON.parse(readFileSync(join(runtimeRoot,'package.json'),'utf8')).version).toBe(ORT_RUNTIME_VERSION);
  expect(ORT_RUNTIME_PATH).toBe(`onnxruntime/ort-${ORT_RUNTIME_VERSION}/`);
});
