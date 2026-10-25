import {describe,it,expect} from 'vitest';import {directionsUrl,haversine,meal,nearbyQuery} from './core';
describe('local discovery helpers',()=>{
  it('measures straight-line distance in meters',()=>{expect(haversine({lat:0,lon:0},{lat:0,lon:1})).toBeGreaterThan(111000);expect(haversine({lat:0,lon:0},{lat:0,lon:1})).toBeLessThan(112000)});
  it('returns zero for identical coordinates',()=>expect(haversine({lat:60,lon:25},{lat:60,lon:25})).toBe(0));
  it('uses device local time to pick a meal period',()=>expect(['breakfast','lunch','afternoon','dinner','late night']).toContain(meal()));
  it('builds a bounded Overpass query using the selected location and radius',()=>{const query=nearbyQuery(51.5,-0.12,500);expect(query).toContain('[timeout:12]');expect(query).toContain('around:500,51.5,-0.12');expect(query).toContain('nwr[amenity');});
  it('builds Google Maps directions with an encoded latitude,longitude destination',()=>{const url=new URL(directionsUrl({lat:60.1699,lon:24.9384}));expect(url.origin).toBe('https://www.google.com');expect(url.pathname).toBe('/maps/dir/');expect(url.searchParams.get('api')).toBe('1');expect(url.searchParams.get('destination')).toBe('60.1699,24.9384');expect(url.search).toContain('destination=60.1699%2C24.9384');});
});
