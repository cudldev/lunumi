// A surviving loading marker means startup/generation was interrupted, not proof of an OOM.
const pendingKey = 'lunumi-ai-work-pending', deferredKey = 'lunumi-ai-deferred';
function read(key: string) { try { return localStorage.getItem(key) === 'yes'; } catch { return false; } }
function write(key: string, enabled: boolean) { try { if (enabled) localStorage.setItem(key, 'yes'); else localStorage.removeItem(key); } catch { /* Storage may be disabled. */ } }
export const wasAIInterrupted = () => read(pendingKey);
export const markAIWork = (pending: boolean) => write(pendingKey, pending);
export const isAIDeferred = () => read(deferredKey);
export const deferAI = (deferred: boolean) => write(deferredKey, deferred);
