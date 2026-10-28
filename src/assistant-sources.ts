export type AssistantSource = { name: string; url: string };

const ignoredNameWords = new Set(['and', 'the', 'for', 'restaurant', 'cafe', 'coffee', 'food', 'place', 'bar', 'bistro']);

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function sourcesForAnswer(answer: string, sources: AssistantSource[], limit = 5): AssistantSource[] {
  const normalizedAnswer = normalize(answer);
  const answerWords = new Set(normalizedAnswer.split(' '));
  const placeNames = [...new Set(sources.map(source => normalize(source.name.split(' · ')[0].split(/[—–]/)[0])))].filter(Boolean);
  const tokenOwners = new Map<string, Set<string>>();
  for (const placeName of placeNames) {
    for (const word of normalize(placeName).split(' ').filter(token => token.length > 2 && !ignoredNameWords.has(token))) {
      const owners = tokenOwners.get(word) ?? new Set<string>();
      owners.add(placeName);
      tokenOwners.set(word, owners);
    }
  }
  return sources.filter(source => {
    const placeName = source.name.split(' · ')[0].split(/[—–]/)[0];
    const normalizedName = normalize(placeName);
    if (!normalizedName) return false;
    if (normalizedAnswer.includes(normalizedName)) return true;
    const distinctiveWords = normalizedName.split(' ').filter(word => word.length > 2 && !ignoredNameWords.has(word));
    if (distinctiveWords.length === 1 && answerWords.has(distinctiveWords[0])) return true;
    if (distinctiveWords.length > 1 && distinctiveWords.every(word => answerWords.has(word))) return true;
    return distinctiveWords.some(word => word.length >= 5 && tokenOwners.get(word)?.size === 1 && answerWords.has(word));
  }).slice(0, limit);
}
