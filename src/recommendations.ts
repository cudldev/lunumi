import { filterNearby, type Place } from './core';
export type HistorySignal = { id: string; name?: string; cuisine?: string; status?: string; sentiment?: string; visitedAt?: string };
export type FoodPreferences = { likes: string[]; dislikes: string[]; learn: boolean };
export type Recommendation = { place: Place; reason: string };
export const hasVisited = (history: HistorySignal[], id: string) => history.some(entry => entry.id === id && (entry.status === 'visited' || Boolean(entry.visitedAt)));
const cuisines = (value = '') => value.toLowerCase().split(';').map(term => term.trim()).filter(Boolean);

export function recommendPlaces(places: Place[], history: HistorySignal[], preferences: FoodPreferences, query = '', unvisited = true): Recommendation[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
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
