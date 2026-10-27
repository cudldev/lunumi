import { describe, expect, it } from 'vitest';
import type { Place } from './core';
import { relevantPlaces } from './assistant-context';

const places: Place[] = [
  { id: 'far', name: 'Burger House', lat: 60, lon: 24, distance: 400, tags: { amenity: 'restaurant', cuisine: 'burger' } },
  { id: 'momochi', name: 'Momochi', lat: 60, lon: 24, distance: 60, tags: { amenity: 'cafe', cuisine: 'japanese;cafe' } },
  { id: 'near', name: 'Soup Corner', lat: 60, lon: 24, distance: 30, tags: { amenity: 'restaurant', cuisine: 'soup' } },
];

describe('assistant restaurant context selection', () => {
  it('prioritizes matching cuisines from the restaurant listing', () => {
    expect(relevantPlaces(places, 'Which nearby restaurant serves Japanese food?').map(place => place.id))
      .toEqual(['momochi']);
  });

  it('limits a restaurant-specific question to the named place', () => {
    expect(relevantPlaces(places, 'Tell me about Momochi').map(place => place.id)).toEqual(['momochi']);
  });

  it('uses the nearest places for a broad question', () => {
    expect(relevantPlaces(places, 'What is nearby?').map(place => place.id)).toEqual(['near', 'momochi', 'far']);
  });

  it('finds restaurants whose locally saved menus mention the requested dish, nearest first', () => {
    const menus = new Map([
      ['far', 'Classic beef burger'],
      ['momochi', 'Spicy miso ramen'],
      ['near', 'Tonkotsu ramen'],
    ]);

    expect(relevantPlaces(places, 'Find the closest restaurant with ramen', menus).map(place => place.id))
      .toEqual(['near', 'momochi']);
  });

  it('uses profile food preferences to prioritize matching nearby menus', () => {
    const menus = new Map([
      ['far', 'Classic beef burger'],
      ['momochi', 'Spicy miso ramen'],
      ['near', 'Tonkotsu ramen'],
    ]);

    expect(relevantPlaces(places, 'What is nearby?', menus, { likes: ['ramen'] }).map(place => place.id))
      .toEqual(['near', 'momochi']);
  });
});
