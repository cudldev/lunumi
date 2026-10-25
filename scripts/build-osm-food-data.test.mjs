import { describe, expect, it } from 'vitest';
import { buildDataset } from './build-osm-food-data.mjs';

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
        { type: 'Feature', id: 'n1', properties: { name: 'Metro Cafe', amenity: 'cafe', cuisine: 'coffee_shop', opening_hours: 'Mo-Fr 08:00-17:00', phone: 'discard', website: 'discard', 'contact:website': 'https://metro.example', 'addr:street': 'discard' }, geometry: { type: 'Point', coordinates: [24.01, 60.01] } },
        { type: 'Feature', id: 'n2', properties: { name: 'Nearby Grill', amenity: 'restaurant' }, geometry: { type: 'Point', coordinates: [23.94, 60.01] } },
        { type: 'Feature', id: 'n3', properties: { name: 'Too Far', amenity: 'restaurant' }, geometry: { type: 'Point', coordinates: [23.8, 60.01] } },
        { type: 'Feature', id: 'n4', properties: { name: 'Not Food', amenity: 'bar' }, geometry: { type: 'Point', coordinates: [24.01, 60.01] } },
        { type: 'Feature', id: 'n5', properties: { amenity: 'restaurant' }, geometry: { type: 'Point', coordinates: [24.01, 60.01] } },
      ],
    }, '2026-10-25T00:00:00.000Z');

    expect(dataset.places.map(place => place.name)).toEqual(['Metro Cafe', 'Nearby Grill']);
    expect(dataset.places[0]).toEqual({ id: 'osm:n1', name: 'Metro Cafe', lat: 60.01, lon: 24.01, amenity: 'cafe', cuisine: 'coffee_shop', opening_hours: 'Mo-Fr 08:00-17:00', 'contact:website': 'https://metro.example' });
    expect(JSON.stringify(dataset)).not.toContain('discard');
    expect(dataset.coverage.type).toBe('MultiPolygon');
  });

  it('fails closed if any required municipality boundary is missing', () => {
    expect(() => buildDataset({ type: 'FeatureCollection', features: boundaryFeatures.slice(1) })).toThrow('Helsinki');
  });
});
