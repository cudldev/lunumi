export type MenuClassifier = {
  schema: number;
  algorithm: string;
  featureBuckets: number;
  language: string;
  classes: string[];
  logPrior: Record<string, number>;
  logLikelihood: Record<string, number[]>;
};

export const MENU_OTHER_FILTER_THRESHOLD = 0.9;

const classifierRequests: Partial<Record<'fi' | 'sv' | 'en' | 'fr', Promise<MenuClassifier>>> = {};

export function loadMenuClassifier(language: 'fi' | 'sv' | 'en' | 'fr'): Promise<MenuClassifier> {
  if (!classifierRequests[language]) {
    const file = language === 'en' ? 'menu-line-classifier.json' : `menu-line-classifier-${language}.json`;
    classifierRequests[language] = fetch(`${import.meta.env.BASE_URL}models/${file}`, { cache: 'force-cache' })
      .then(async response => {
        if (!response.ok) throw new Error(`Menu model unavailable (${response.status}).`);
        const model = await response.json() as MenuClassifier;
        if (model.schema !== 1 || model.algorithm !== 'character-ngram-multinomial-naive-bayes' || model.language !== language) {
          throw new Error('Unsupported menu model.');
        }
        return model;
      })
      .catch(error => { delete classifierRequests[language]; throw error; });
  }
  return classifierRequests[language]!;
}

export function scheduleMenuClassifierWarmup(): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return () => {};

  let cancelled = false;
  const load = () => {
    if (!cancelled) void loadMenuClassifier('en').catch(() => {});
  };
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(load, { timeout: 4000 });
    return () => {
      cancelled = true;
      idleWindow.cancelIdleCallback?.(handle);
    };
  }
  const handle = window.setTimeout(load, 1500);
  return () => {
    cancelled = true;
    window.clearTimeout(handle);
  };
}

function features(text: string, buckets: number): Map<number, number> {
  const normalized = `^${text.toLowerCase().trim()}$`;
  const chars = [...normalized];
  const vector = new Map<number, number>();
  for (let start = 0; start < chars.length; start += 1) {
    for (let size = 2; size <= 5 && start + size <= chars.length; size += 1) {
      const gram = chars.slice(start, start + size).join('');
      let hash = 2166136261;
      for (const char of gram) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
      const index = hash % buckets;
      vector.set(index, (vector.get(index) ?? 0) + 1);
    }
  }
  return vector;
}

export function classifyMenuLine(text: string, model: MenuClassifier): { label: string; confidence: number } | null {
  if (!['fi', 'sv', 'en', 'fr'].includes(model.language) || !model.classes.length || text.length < 2) return null;
  const vector = features(text, model.featureBuckets);
  const scores = Object.fromEntries(model.classes.map(label => {
    let score = model.logPrior[label] ?? 0;
    for (const [index, count] of vector) score += count * (model.logLikelihood[label]?.[index] ?? 0);
    return [label, score];
  }));
  const max = Math.max(...Object.values(scores));
  const exponentials = Object.fromEntries(Object.entries(scores).map(([label, score]) => [label, Math.exp(score - max)]));
  const denominator = Object.values(exponentials).reduce((sum, value) => sum + value, 0);
  const predicted = Object.entries(exponentials)
    .map(([key, value]) => [key, value / denominator] as const)
    .sort((a, b) => b[1] - a[1])[0];
  return predicted ? { label: predicted[0], confidence: predicted[1] } : null;
}
