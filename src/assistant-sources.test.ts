import { describe, expect, it } from 'vitest';
import { sourcesForAnswer } from './assistant-sources';

describe('sourcesForAnswer', () => {
  it('matches restaurant names independently of their source label', () => {
    const sources = [
      { name: 'Momochi · directory', url: 'https://www.openstreetmap.org/node/1' },
      { name: 'Fazer Café — Forum · website', url: 'https://fazer.fi/forum' },
    ];
    expect(sourcesForAnswer('Momochi and Fazer Café are nearby.', sources)).toEqual(sources);
  });

  it('does not attach a source for an unmentioned restaurant and respects the limit', () => {
    const sources = Array.from({ length: 7 }, (_, index) => ({ name: `Place ${index} · directory`, url: `https://example.com/${index}` }));
    expect(sourcesForAnswer('Place 0, Place 1 and a made up place.', sources)).toEqual(sources.slice(0, 2));
    expect(sourcesForAnswer('A made up place.', sources)).toEqual([]);
  });

  it('does not mistake a location suffix for a restaurant-name mention', () => {
    const sources = [
      { name: 'Momochi · directory', url: 'https://www.openstreetmap.org/node/1' },
      { name: 'Robert\'s Coffee — Helsinki Central Railway Station · directory', url: 'https://example.com/roberts' },
    ];
    expect(sourcesForAnswer('Momochi is in Helsinki, Finland.', sources)).toEqual([sources[0]]);
  });
});
