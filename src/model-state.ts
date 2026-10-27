export type ModelStage = 'files' | 'download' | 'load' | 'checking';
export type ModelSnapshot = { phase: 'idle' | 'loading' | 'ready' | 'error'; status: string; stage?: ModelStage; progress?: number; error?: string };
export const canEnterApp = (onboardingDone: boolean, model: ModelSnapshot, bypassed = false) => onboardingDone && (model.phase === 'ready' || bypassed);
