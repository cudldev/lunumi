import { createContext, useEffect, useRef, useState } from 'react';
import { browserConversation } from './local-conversation';
import type { ModelSnapshot } from './model-state';
import { currentModelConfig, currentModelSize } from './conversation-config';
import { deferAI, isAIDeferred, wasAIInterrupted } from './model-recovery';

export type ModelReadiness = ModelSnapshot & { ready: boolean; usable: boolean; bypassed: boolean; active: boolean; manual: boolean; interrupted: boolean; download: string; retry: () => void; retryCPU: () => void; pause: () => void; skip: () => void };
export const ModelAccess = createContext<ModelReadiness | null>(null);
export function useModelReadiness(active: boolean): ModelReadiness {
  const [state, setState] = useState<ModelSnapshot>(browserConversation.snapshot), [attempt, setAttempt] = useState(0);
  const [interrupted] = useState(wasAIInterrupted), [bypassed, setBypassed] = useState(isAIDeferred);
  const [manual] = useState(() => currentModelSize() === 'compact' || interrupted || isAIDeferred());
  const controller = useRef<AbortController | null>(null);
  useEffect(() => browserConversation.subscribe(setState), []);
  useEffect(() => browserConversation.retain(), []);
  useEffect(() => {
    if (!active || bypassed || (manual && !attempt)) return;
    const current = new AbortController(); controller.current = current;
    queueMicrotask(() => { if (!current.signal.aborted) void browserConversation.prepare(current.signal).catch(() => undefined); });
    return () => { current.abort(); if (controller.current === current) controller.current = null; };
  }, [active, attempt, bypassed, manual]);
  const ready = state.phase === 'ready';
  return { ...state, ready, usable: ready || bypassed, bypassed, active, manual, interrupted, download: currentModelConfig().download,
    retry: () => { deferAI(false); setBypassed(false); setAttempt(value => value + 1); },
    retryCPU: () => { browserConversation.preferCPU(); deferAI(false); setBypassed(false); setAttempt(value => value + 1); },
    pause: () => controller.current?.abort(),
    skip: () => { controller.current?.abort(); browserConversation.stop(); deferAI(true); setBypassed(true); },
  };
}
