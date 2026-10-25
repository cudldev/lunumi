import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const amenityValues = new Set(['restaurant', 'cafe', 'fast_food', 'food_court']);
const municipalityNames = ['Helsinki', 'Espoo', 'Vantaa', 'Kauniainen'];
const municipalityNameSet = new Set(municipalityNames.map(name => name.toLocaleLowerCase('en')));
const searchMarginMeters = 5000;
const maxOutputBytes = 10 * 1024 * 1024;

function safeWebsite(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

function polygonCoordinates(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function ringsFor(geometry) {
  return polygonCoordinates(geometry).flatMap(polygon => polygon);
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const crosses = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInMunicipality(lon, lat, geometry) {
  return polygonCoordinates(geometry).some(polygon =>
    pointInRing(lon, lat, polygon[0]) && !polygon.slice(1).some(ring => pointInRing(lon, lat, ring))
  );
}

function distanceToSegmentMeters(lon, lat, a, b) {
  const latitudeScale = 111132;
  const longitudeScale = 111320 * Math.cos(lat * Math.PI / 180);
  const px = lon * longitudeScale, py = lat * latitudeScale;
  const ax = a[0] * longitudeScale, ay = a[1] * latitudeScale;
  const bx = b[0] * longitudeScale, by = b[1] * latitudeScale;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToMunicipalitiesMeters(lon, lat, geometries) {
  let nearest = Infinity;
  for (const geometry of geometries) {
    for (const ring of ringsFor(geometry)) {
      for (let i = 1; i < ring.length; i++) {
        nearest = Math.min(nearest, distanceToSegmentMeters(lon, lat, ring[i - 1], ring[i]));
      }
    }
  }
  return nearest;
}

function ringCentroid(ring) {
  let twiceArea = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    twiceArea += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) return null;
  return { point: [x / (3 * twiceArea), y / (3 * twiceArea)], weight: Math.abs(twiceArea) };
}

function geometryPoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type === 'Polygon') {
    return ringCentroid(geometry.coordinates[0])?.point ?? geometry.coordinates[0]?.[0] ?? null;
  }
  if (geometry.type === 'MultiPolygon') {
    const centroids = geometry.coordinates.map(polygon => ringCentroid(polygon[0])).filter(Boolean);
    if (!centroids.length) return null;
    const weight = centroids.reduce((sum, item) => sum + item.weight, 0);
    return [
      centroids.reduce((sum, item) => sum + item.point[0] * item.weight, 0) / weight,
      centroids.reduce((sum, item) => sum + item.point[1] * item.weight, 0) / weight,
    ];
  }
  const points = [];
  const collect = value => {
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') points.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
  };
  collect(geometry.coordinates);
  if (!points.length) return null;
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

function placeId(feature, properties) {
  const raw = feature.id ?? properties['@id'] ?? properties.id;
  if (raw == null) return null;
  return `osm:${raw}`;
}

export function buildDataset(collection, updatedAt = new Date().toISOString()) {
  if (!Array.isArray(collection?.features)) throw new Error('Expected a GeoJSON FeatureCollection.');

  const boundaries = new Map(municipalityNames.map(name => [name, []]));
  for (const feature of collection.features) {
    const tags = feature.properties ?? {};
    const name = municipalityNames.find(candidate => candidate.toLocaleLowerCase('en') === String(tags.name ?? '').toLocaleLowerCase('en'));
    if (name && tags.boundary === 'administrative' && tags.admin_level === '8' && polygonCoordinates(feature.geometry).length) {
      boundaries.get(name).push(feature.geometry);
    }
  }

  const missing = municipalityNames.filter(name => boundaries.get(name).length === 0);
  if (missing.length) throw new Error(`Missing Helsinki metro boundary relation(s): ${missing.join(', ')}.`);
  const municipalityGeometries = [...boundaries.values()].flat();
  const places = [];
  const seen = new Set();

  for (const feature of collection.features) {
    const tags = feature.properties ?? {};
    if (!amenityValues.has(tags.amenity) || typeof tags.name !== 'string' || !tags.name.trim()) continue;
    const point = geometryPoint(feature.geometry);
    if (!point || !point.every(Number.isFinite)) continue;
    const [lon, lat] = point;
    const inside = municipalityGeometries.some(geometry => pointInMunicipality(lon, lat, geometry));
    if (!inside && distanceToMunicipalitiesMeters(lon, lat, municipalityGeometries) > searchMarginMeters) continue;

    const id = placeId(feature, tags);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const place = { id, name: tags.name.trim(), lat, lon, amenity: tags.amenity };
    if (typeof tags.cuisine === 'string' && tags.cuisine) place.cuisine = tags.cuisine;
    if (typeof tags.opening_hours === 'string' && tags.opening_hours) place.opening_hours = tags.opening_hours;
    for (const key of ['website', 'contact:website', 'menu', 'menu:website', 'website:menu', 'lunch', 'lunch:website', 'website:lunch', 'lunch:feed', 'food']) {
      if (typeof tags[key] === 'string' && tags[key] && (key === 'food' || safeWebsite(tags[key]))) place[key] = tags[key].trim();
    }
    for (const [key, value] of Object.entries(tags)) {
      if (/^diet:[a-z_]+$/.test(key) && typeof value === 'string' && value) place[key] = value;
      if (/^food:[a-z_]+$/.test(key) && typeof value === 'string' && value) place[key] = value;
    }
    places.push(place);
  }

  if (!places.length) throw new Error('No named food places were found inside the Helsinki metro coverage area.');
  places.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
  const coverage = municipalityGeometries.flatMap(polygonCoordinates);
  const dataset = {
    schema: 1,
    region: 'Helsinki metropolitan area',
    updatedAt,
    attribution: '© OpenStreetMap contributors',
    license: 'Open Database License (ODbL) 1.0',
    sources: [{ name: 'OpenStreetMap', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' }],
    coverage: { type: 'MultiPolygon', coordinates: coverage },
    places,
  };
  const bytes = Buffer.byteLength(JSON.stringify(dataset));
  if (bytes > maxOutputBytes) throw new Error(`Filtered dataset is ${bytes} bytes; maximum allowed is ${maxOutputBytes}.`);
  return dataset;
}

async function generate(inputPath, outputPath) {
  const downloadInput = !inputPath;
  outputPath = outputPath || path.resolve('public/data/helsinki-metro.json');
  const tempDirectory = await mkdir(path.join(os.tmpdir(), `lunumi-osm-${process.pid}`), { recursive: true }).then(() => path.join(os.tmpdir(), `lunumi-osm-${process.pid}`));
  if (downloadInput) inputPath = path.join(tempDirectory, 'finland-latest.osm.pbf');
  const filteredPath = path.join(tempDirectory, 'food-and-boundaries.osm.pbf');
  const geojsonPath = path.join(tempDirectory, 'food-and-boundaries.geojson');
  try {
    if (downloadInput) {
      process.stdout.write('Downloading the latest Finland OpenStreetMap extract from Geofabrik…\n');
      let response;
      try {
        response = await fetch('https://download.geofabrik.de/europe/finland-latest.osm.pbf', {
          headers: { 'User-Agent': 'Lunumi local food data builder (OpenStreetMap ODbL dataset)' },
          signal: AbortSignal.timeout(120000),
        });
      } catch {
        throw new Error('Could not reach Geofabrik from this environment. Download the Finland PBF manually and pass its path to this command.');
      }
      if (!response.ok || !response.body) throw new Error(`Geofabrik download failed (HTTP ${response.status}). Download the Finland PBF manually and pass its path to this command.`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(inputPath));
    }
    execFileSync('osmium', [
      'tags-filter', inputPath,
      ...[...amenityValues].map(value => `nwr/amenity=${value}`),
      ...municipalityNames.map(name => `r/name=${name}`),
      '-o', filteredPath,
    ], { stdio: 'inherit' });
    execFileSync('osmium', ['export', filteredPath, '-o', geojsonPath, '--add-unique-id=type_id'], { stdio: 'inherit' });
    const collection = JSON.parse(await readFile(geojsonPath, 'utf8'));
    const dataset = buildDataset(collection);
    await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, JSON.stringify(dataset));
    process.stdout.write(`Generated ${dataset.places.length} Helsinki metro food places (${Buffer.byteLength(JSON.stringify(dataset))} bytes).\n`);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  generate(process.argv[2], process.argv[3]).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
