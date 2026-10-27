import type { Place } from './core';

const chatStopWords = new Set(['a', 'about', 'and', 'are', 'can', 'do', 'does', 'for', 'food', 'have', 'i', 'is', 'it', 'me', 'near', 'nearby', 'of', 'on', 'or', 'place', 'restaurant', 'restaurants', 'serve', 'serves', 'the', 'to', 'what', 'which', 'with', 'you']);

function normalizeChatText(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function nearest(places: Place[], limit: number): Place[] {
  return [...places].sort((a, b) => a.distance - b.distance).slice(0, limit);
}

export function relevantPlaces(places: Place[], query: string): Place[] {
  const normalizedQuery = normalizeChatText(query);
  const named = places.filter(place => {
    const name = normalizeChatText(place.name);
    return name.length > 2 && normalizedQuery.includes(name);
  });
  if (named.length) return nearest(named, 4);

  const terms = normalizedQuery.split(' ').filter(term => term.length > 2 && !chatStopWords.has(term));
  if (!terms.length) return nearest(places, 5);
  const ranked = places.map(place => {
    const name = normalizeChatText(place.name).split(' ');
    const cuisine = normalizeChatText(place.tags.cuisine || '').split(' ');
    const details = normalizeChatText(Object.entries(place.tags)
      .filter(([key]) => key === 'amenity' || key === 'food' || key.startsWith('food:') || key.startsWith('diet:'))
      .map(([key, value]) => `${key} ${value}`).join(' ')).split(' ');
    const score = terms.reduce((total, term) => total + (cuisine.includes(term) ? 4 : name.includes(term) ? 2 : details.includes(term) ? 1 : 0), 0);
    return { place, score };
  }).sort((a, b) => b.score - a.score || a.place.distance - b.place.distance);
  const matches = ranked.filter(entry => entry.score > 0).map(entry => entry.place);
  return matches.length ? matches.slice(0, 6) : nearest(places, 5);
}
