export type MenuClassifier = {
  schema: number;
  algorithm: string;
  featureBuckets: number;
  language: string;
  classes: string[];
  logPrior: Record<string, number>;
  logLikelihood: Record<string, number[]>;
};

let classifierRequest: Promise<MenuClassifier> | null = null;

export function loadMenuClassifier(): Promise<MenuClassifier> {
  if (!classifierRequest) {
    classifierRequest = fetch(`${import.meta.env.BASE_URL}models/menu-line-classifier.json`, { cache: 'force-cache' })
      .then(async response => {
        if (!response.ok) throw new Error(`Menu model unavailable (${response.status}).`);
        const model = await response.json() as MenuClassifier;
        if (model.schema !== 1 || model.algorithm !== 'character-ngram-multinomial-naive-bayes' || model.language !== 'en') {
          throw new Error('Unsupported menu model.');
        }
        return model;
      })
      .catch(error => { classifierRequest = null; throw error; });
  }
  return classifierRequest;
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
  if (model.language !== 'en' || !model.classes.length || text.length < 2) return null;
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
