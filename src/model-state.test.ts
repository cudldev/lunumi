import { expect, it } from 'vitest';
import { canEnterApp, type ModelSnapshot } from './model-state';
it('requires both completed onboarding and a successful readiness check', () => {
  for (const phase of ['idle', 'loading', 'error'] as ModelSnapshot['phase'][]) {
    expect(canEnterApp(true, { phase, status: 'Waiting', progress: 100 })).toBe(false);
  }
  expect(canEnterApp(false, { phase: 'ready', status: 'Ready' })).toBe(false);
  expect(canEnterApp(true, { phase: 'ready', status: 'Ready' })).toBe(true);
});
