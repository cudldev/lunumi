import type { Place } from './core';

const chatStopWords = new Set(['a', 'about', 'and', 'are', 'can', 'closest', 'do', 'does', 'find', 'for', 'food', 'get', 'have', 'has', 'i', 'is', 'it', 'me', 'near', 'nearby', 'of', 'on', 'or', 'place', 'restaurant', 'restaurants', 'serve', 'serves', 'the', 'to', 'want', 'what', 'which', 'with', 'you']);

function normalizeChatText(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function nearest(places: Place[], limit: number): Place[] {
  return [...places].sort((a, b) => a.distance - b.distance).slice(0, limit);
}

export type AssistantFoodPreferences = { likes?: string[]; dislikes?: string[]; diet?: string[] };

export function relevantPlaces(
  places: Place[],
  query: string,
  cachedMenuText: ReadonlyMap<string, string> = new Map(),
  preferences: AssistantFoodPreferences = {},
): Place[] {
  const normalizedQuery = normalizeChatText(query);
  const named = places.filter(place => {
    const name = normalizeChatText(place.name);
    return name.length > 2 && normalizedQuery.includes(name);
  });
  if (named.length) return nearest(named, 4);

  const terms = normalizedQuery.split(' ').filter(term => term.length > 2 && !chatStopWords.has(term));
  const likes = (preferences.likes || []).map(normalizeChatText).filter(Boolean);
  const dislikes = (preferences.dislikes || []).map(normalizeChatText).filter(Boolean);
  const diet = (preferences.diet || []).map(normalizeChatText).filter(Boolean);
  if (!terms.length && !likes.length && !diet.length) return nearest(places, 5);
  const ranked = places.map(place => {
    const name = normalizeChatText(place.name).split(' ');
    const cuisineText = normalizeChatText(place.tags.cuisine || '');
    const cuisine = cuisineText.split(' ');
    const dietaryTags = normalizeChatText(Object.entries(place.tags)
      .filter(([key]) => key.startsWith('diet:') || key === 'diet' || key === 'dietary')
      .map(([key, value]) => `${key} ${value}`).join(' '));
    const details = normalizeChatText(Object.entries(place.tags)
      .filter(([key]) => key === 'amenity' || key === 'food' || key.startsWith('food:') || key.startsWith('diet:'))
      .map(([key, value]) => `${key} ${value}`).join(' ')).split(' ');
    const menuText = normalizeChatText(cachedMenuText.get(place.id) || '');
    const menu = menuText.split(' ');
    const queryScore = terms.reduce((total, term) => total + (menu.includes(term) ? 8 : cuisine.includes(term) ? 4 : name.includes(term) ? 2 : details.includes(term) ? 1 : 0), 0);
    const profileScore = likes.reduce((total, preference) => total + (menuText.includes(preference) || cuisineText.includes(preference) ? 4 : 0), 0)
      + diet.reduce((total, preference) => total + (menuText.includes(preference) || dietaryTags.includes(preference) ? 6 : 0), 0)
      - dislikes.reduce((total, preference) => total + (menuText.includes(preference) || cuisineText.includes(preference) ? 8 : 0), 0);
    const score = queryScore + profileScore;
    return { place, score };
  }).sort((a, b) => b.score - a.score || a.place.distance - b.place.distance);
  const matches = ranked.filter(entry => entry.score > 0).map(entry => entry.place);
  return matches.length ? matches.slice(0, 6) : nearest(places, 5);
}
