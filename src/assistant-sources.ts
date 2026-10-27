export type AssistantSource = { name: string; url: string };

const ignoredNameWords = new Set(['and', 'the', 'for', 'restaurant', 'cafe', 'coffee', 'food', 'place', 'bar', 'bistro']);

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function sourcesForAnswer(answer: string, sources: AssistantSource[], limit = 5): AssistantSource[] {
  const normalizedAnswer = normalize(answer);
  const answerWords = new Set(normalizedAnswer.split(' '));
  return sources.filter(source => {
    const placeName = source.name.split(' · ')[0].split(/[—–]/)[0];
    const normalizedName = normalize(placeName);
    if (!normalizedName) return false;
    if (normalizedAnswer.includes(normalizedName)) return true;
    const distinctiveWords = normalizedName.split(' ').filter(word => word.length > 2 && !ignoredNameWords.has(word));
    return distinctiveWords.length === 1 && answerWords.has(distinctiveWords[0]);
  }).slice(0, limit);
}
