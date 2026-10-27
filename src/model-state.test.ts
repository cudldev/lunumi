import { expect, it } from 'vitest';
import { canEnterApp, type ModelSnapshot } from './model-state';
it('requires both completed onboarding and a successful readiness check', () => {
  for (const phase of ['idle', 'loading', 'error'] as ModelSnapshot['phase'][]) {
    expect(canEnterApp(true, { phase, status: 'Waiting', progress: 100 })).toBe(false);
  }
  expect(canEnterApp(false, { phase: 'ready', status: 'Ready' })).toBe(false);
  expect(canEnterApp(true, { phase: 'ready', status: 'Ready' })).toBe(true);
});

it('allows explicit non-AI app access without treating the model as ready', () => {
  const loading = {phase:'loading' as const,status:'Downloading',progress:100};
  expect(canEnterApp(true, loading, true)).toBe(true);
  expect(canEnterApp(false, loading, true)).toBe(false);
  expect(canEnterApp(true, loading)).toBe(false);
});
