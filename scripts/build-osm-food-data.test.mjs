import { describe, expect, it, vi } from 'vitest';
import { addCommonsPhotos, buildDataset } from './build-osm-food-data.mjs';

const municipalityNames = ['Helsinki', 'Espoo', 'Vantaa', 'Kauniainen'];
const polygon = (west, south, east, north) => ({
  type: 'Polygon',
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});
const boundaryFeatures = municipalityNames.map((name, index) => ({
  type: 'Feature',
  id: `r${index + 1}`,
  properties: { name, boundary: 'administrative', admin_level: '8', unrelated_tag: 'discard me' },
  geometry: polygon(24 + index * 0.02, 60, 24.02 + index * 0.02, 60.02),
}));

describe('Helsinki OSM data builder', () => {
  it('keeps only named food places in the metro plus the 5 km search margin', () => {
    const dataset = buildDataset({
      type: 'FeatureCollection',
      features: [
        ...boundaryFeatures,
        { type: 'Feature', id: 'n1', properties: { name: 'Metro Cafe', amenity: 'cafe', cuisine: 'coffee_shop', opening_hours: 'Mo-Fr 08:00-17:00', phone: 'discard', website: 'discard', 'contact:website': 'https://metro.example', 'lunch:feed': 'https://feed.example/menu.json', 'diet:vegetarian': 'yes', 'diet:vegan': 'limited', 'food:vegan': 'yes', 'addr:street': 'discard' }, geometry: { type: 'Point', coordinates: [24.01, 60.01] } },
        { type: 'Feature', id: 'n2', properties: { name: 'Nearby Grill', amenity: 'restaurant' }, geometry: { type: 'Point', coordinates: [23.94, 60.01] } },
        { type: 'Feature', id: 'n3', properties: { name: 'Too Far', amenity: 'restaurant' }, geometry: { type: 'Point', coordinates: [23.8, 60.01] } },
        { type: 'Feature', id: 'n4', properties: { name: 'Not Food', amenity: 'bar' }, geometry: { type: 'Point', coordinates: [24.01, 60.01] } },
        { type: 'Feature', id: 'n5', properties: { amenity: 'restaurant' }, geometry: { type: 'Point', coordinates: [24.01, 60.01] } },
      ],
    }, '2026-10-25T00:00:00.000Z');

    expect(dataset.places.map(place => place.name)).toEqual(['Metro Cafe', 'Nearby Grill']);
    expect(dataset.places[0]).toEqual({ id: 'osm:n1', name: 'Metro Cafe', lat: 60.01, lon: 24.01, amenity: 'cafe', cuisine: 'coffee_shop', opening_hours: 'Mo-Fr 08:00-17:00', 'contact:website': 'https://metro.example', 'lunch:feed': 'https://feed.example/menu.json', 'diet:vegetarian': 'yes', 'diet:vegan': 'limited', 'food:vegan': 'yes' });
    expect(JSON.stringify(dataset)).not.toContain('discard');
    expect(dataset.coverage.type).toBe('MultiPolygon');
  });

  it('fails closed if any required municipality boundary is missing', () => {
    expect(() => buildDataset({ type: 'FeatureCollection', features: boundaryFeatures.slice(1) })).toThrow('Helsinki');
  });

  it('adds licensed Commons preview metadata without downloading the image', async () => {
    const dataset = { places: [{ name: 'Metro Cafe', wikimedia_commons: 'File:Metro Cafe.jpg' }] };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: [{
            title: 'File:Metro Cafe.jpg',
            imageinfo: [{
              thumburl: 'https://upload.wikimedia.org/thumb.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Metro_Cafe.jpg',
              extmetadata: {
                LicenseShortName: { value: 'CC BY-SA 4.0' },
                LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
                Artist: { value: '<a href="https://commons.wikimedia.org/wiki/User:Photographer">Photographer</a>' },
              },
            }],
          }],
        },
      }),
    });

    await addCommonsPhotos(dataset, fetchImpl);

    expect(dataset.places[0].photo).toEqual({
      url: 'https://upload.wikimedia.org/thumb.jpg',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Metro_Cafe.jpg',
      attribution: 'Photographer',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses files in mapped Commons categories for licensed photo previews', async () => {
    const dataset = { places: [{ name: 'Cafe Regatta', wikimedia_commons: 'Category:Cafe Regatta' }] };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: [{
        title: 'File:Cafe Regatta in Helsinki.jpg',
        imageinfo: [{
          thumburl: 'https://upload.wikimedia.org/cafe-regatta.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cafe_Regatta_in_Helsinki.jpg',
          extmetadata: {
            LicenseShortName: { value: 'CC BY 4.0' },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
            Artist: { value: 'Local Photographer' },
          },
        }],
      }] } }),
    });

    await addCommonsPhotos(dataset, fetchImpl);

    expect(dataset.places[0].photo).toMatchObject({ attribution: 'Local Photographer', license: 'CC BY 4.0' });
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('gcmtitle')).toBe('Category:Cafe Regatta');
  });
});
