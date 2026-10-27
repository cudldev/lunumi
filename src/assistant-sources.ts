export type AssistantSource = { name: string; url: string };

const ignoredNameWords = new Set(['and', 'the', 'for', 'restaurant', 'cafe', 'food', 'place']);

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function sourcesForAnswer(answer: string, sources: AssistantSource[], limit = 5): AssistantSource[] {
  const normalizedAnswer = normalize(answer);
  return sources.filter(source => {
    const placeName = source.name.split(' · ')[0];
    const normalizedName = normalize(placeName);
    if (!normalizedName) return false;
    if (normalizedAnswer.includes(normalizedName)) return true;
    const distinctiveWords = normalizedName.split(' ').filter(word => word.length > 2 && !ignoredNameWords.has(word));
    return distinctiveWords.some(word => normalizedAnswer.includes(word));
  }).slice(0, limit);
}
