import { useEffect, useRef, useState } from 'react';
import { browserConversation } from './local-conversation';
import type { ModelSnapshot } from './model-state';

export type ModelReadiness = ModelSnapshot & { ready: boolean; active: boolean; retry: () => void; pause: () => void };
export function useModelReadiness(active: boolean): ModelReadiness {
  const [state, setState] = useState<ModelSnapshot>(browserConversation.snapshot), [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => browserConversation.subscribe(setState), []);
  useEffect(() => browserConversation.retain(), []);
  useEffect(() => {
    if (!active) return;
    const current = new AbortController(); controller.current = current;
    // Avoid starting a download in Strict Mode's immediately discarded mount.
    queueMicrotask(() => { if (!current.signal.aborted) void browserConversation.prepare(current.signal).catch(() => undefined); });
    return () => { current.abort(); if (controller.current === current) controller.current = null; };
  }, [active, attempt]);
  return { ...state, ready: state.phase === 'ready', active, retry: () => setAttempt(value => value + 1), pause: () => controller.current?.abort() };
}
