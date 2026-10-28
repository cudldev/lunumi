import { describe, expect, it } from 'vitest';
import { constrainedRestaurantQuery, hasVisited, normalizeFoodQuery, recommendPlaces } from './recommendations';
import type { Place } from './core';
const place = (id: string, cuisine: string, distance: number): Place => ({ id, name: id, tags: { cuisine }, lat: 60, lon: 24, distance });
const places = [place('visited', 'italian', 50), place('new-italian', 'italian', 300), place('new-thai', 'thai', 100)];
const history = [{ id: 'visited', cuisine: 'italian', status: 'visited', sentiment: 'loved' }];

describe('history-based recommendations', () => {
  it('uses liked cuisine history to rank new places and excludes visits', () => {
    const result = recommendPlaces(places, history, { likes: [], dislikes: [], learn: true });
    expect(result.map(item => item.place.id)).toEqual(['new-italian', 'new-thai']);
    expect(result[0].reason).toContain('liked before');
  });
  it('respects learning opt-out while still honoring explicit cuisine preferences', () => {
    expect(recommendPlaces(places, history, { likes: [], dislikes: [], learn: false })[0].place.id).toBe('new-thai');
    expect(recommendPlaces(places, history, { likes: ['Italian'], dislikes: [], learn: false })[0].place.id).toBe('new-italian');
  });
  it('keeps a visit recorded even after status changes, and does not invent new matches', () => {
    expect(hasVisited([{ id: 'one', status: 'target', visitedAt: '2026-10-01' }], 'one')).toBe(true);
    expect(recommendPlaces(places, history, { likes: [], dislikes: [], learn: true }, 'sushi')).toEqual([]);
    expect(recommendPlaces([places[0]], history, { likes: [], dislikes: [], learn: true })).toEqual([]);
  });
});

it('normalizes model search phrases without losing the food constraint', () => {
  expect(normalizeFoodQuery('Italian restaurants near me')).toBe('italian');
  expect(recommendPlaces(places, history, { likes: [], dislikes: [], learn: true }, 'Italian restaurants near me').map(item => item.place.id)).toEqual(['new-italian']);
});

it('preserves an explicit cuisine when the model omits the query', () => {
  expect(constrainedRestaurantQuery('', 'Find Italian restaurants nearby.', places)).toBe('italian');
  expect(constrainedRestaurantQuery('Italian restaurants near me', 'Find Italian restaurants nearby.', places)).toBe('italian');
});
