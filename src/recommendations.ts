import { filterNearby, type Place } from './core.ts';
export type HistorySignal = { id: string; name?: string; cuisine?: string; status?: string; sentiment?: string; visitedAt?: string };
export type FoodPreferences = { likes: string[]; dislikes: string[]; learn: boolean };
export type Recommendation = { place: Place; reason: string };
export function normalizeFoodQuery(value: string): string {
  return value.toLowerCase().replace(/\bgluten\s+free\b/g, 'gluten-free').replace(/\bdairy\s+free\b/g, 'dairy-free')
    .replace(/\b(please|can|could|would|you|find|show|list|recommend|suggest|somewhere|something|some|new|that|which|want|looking|like|might|yet|before|been|where|should|try|food|good|best|eat|go|places?|restaurants?|nearby|near|me|my|i|have|haven.t|not|visited|the|a|an|for|to|at|with|and|or|cuisine|empty|options?|items?|dishes|of)\b/g, ' ')
    .replace(/[?!.]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function constrainedRestaurantQuery(modelQuery: string, request: string, places: Place[]): string {
  const text = request.toLowerCase();
  const terms = [...new Set(places.flatMap(place => cuisines(place.tags.cuisine)))].filter(term => {
    if (term.length < 3 || !text.includes(term)) return false;
    const start = text.indexOf(term), prefix = text.slice(Math.max(0, start - 15), start);
    return !/\b(?:not|no|avoid)\s*$/.test(prefix);
  });
  // Preserve a single explicit cuisine constraint even if a small model drops it.
  if (terms.length === 1) return terms[0];
  return normalizeFoodQuery(modelQuery || request);
}
export const hasVisited = (history: HistorySignal[], id: string) => history.some(entry => entry.id === id && (entry.status === 'visited' || Boolean(entry.visitedAt)));
const cuisines = (value = '') => value.toLowerCase().split(';').map(term => term.trim()).filter(Boolean);

export function recommendPlaces(places: Place[], history: HistorySignal[], preferences: FoodPreferences, query = '', unvisited = true): Recommendation[] {
  const words = normalizeFoodQuery(query).split(/\s+/).filter(Boolean);
  const liked = new Set(preferences.likes.map(term => term.toLowerCase()));
  const disliked = new Set(preferences.dislikes.map(term => term.toLowerCase()));
  if (preferences.learn) for (const entry of history) {
    if (entry.sentiment === 'loved' || entry.sentiment === 'favorite') for (const term of cuisines(entry.cuisine)) liked.add(term);
    if (entry.sentiment === 'disliked') for (const term of cuisines(entry.cuisine)) disliked.add(term);
  }
  return places.filter(place => (!unvisited || !hasVisited(history, place.id)) && words.every(word => filterNearby([place], word).length > 0))
    .map(place => {
      const food = cuisines(place.tags.cuisine), feedback = preferences.learn ? history.find(entry => entry.id === place.id)?.sentiment : undefined;
      const matches = food.filter(term => [...liked].some(like => term.includes(like)));
      const avoids = food.filter(term => [...disliked].some(dislike => term.includes(dislike)));
      const historyMatch = preferences.learn && history.some(entry => ['loved', 'favorite'].includes(entry.sentiment || '') && cuisines(entry.cuisine).some(term => food.includes(term)));
      const score = matches.length * 35 - avoids.length * 55 + (feedback === 'loved' || feedback === 'favorite' ? 60 : feedback === 'disliked' ? -100 : 0) - place.distance / 300;
      const reason = historyMatch ? 'Similar cuisine to a place you liked before' : matches.length ? 'Matches your ' + matches.join(', ') + ' preferences' : unvisited ? 'Nearby and not marked visited in your history' : 'Nearby within your current search';
      return { place, reason, score };
    }).sort((a, b) => b.score - a.score).slice(0, 8).map(({ place, reason }) => ({ place, reason }));
}
