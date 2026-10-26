import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { Place } from './core';
import './history-map.css';

type MapEntry = { id: string; place: Place; when: string; sentiment?: string; recommendationVote?: 'yes' | 'maybe' | 'no'; status?: 'target' | 'visited'; visitedAt?: string; tags: string[] };
type Tile = { x: number; y: number; z: number; left: number; top: number };
const TILE_SIZE = 256;
const MAX_ZOOM = 17;
const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));
const worldPoint = (lat: number, lon: number, zoom: number) => {
  const scale = TILE_SIZE * 2 ** zoom;
  const safeLat = clampLat(lat) * Math.PI / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: ((1 - Math.asinh(Math.tan(safeLat)) / Math.PI) / 2) * scale,
  };
};

export default function HistoryMap({ entries, onSelect }: { entries: MapEntry[]; onSelect: (entry: MapEntry) => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const located = useMemo(() => entries.filter(entry => Number.isFinite(entry.place.lat) && Number.isFinite(entry.place.lon)), [entries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const observer = new ResizeObserver(([item]) => setSize({ width: item.contentRect.width, height: item.contentRect.height }));
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  const viewport = useMemo(() => {
    if (!located.length || !size.width || !size.height) return null;
    const points = located.map(entry => worldPoint(entry.place.lat, entry.place.lon, 0));
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    let zoom = MAX_ZOOM;
    while (zoom > 2) {
      const scale = 2 ** zoom;
      if ((maxX - minX) * scale <= size.width * .72 && (maxY - minY) * scale <= size.height * .72) break;
      zoom--;
    }
    const center = worldPoint((Math.min(...located.map(e => e.place.lat)) + Math.max(...located.map(e => e.place.lat))) / 2,
      (Math.min(...located.map(e => e.place.lon)) + Math.max(...located.map(e => e.place.lon))) / 2, zoom);
    const worldSize = TILE_SIZE * 2 ** zoom;
    const centerX = ((center.x % worldSize) + worldSize) % worldSize;
    const centerY = center.y;
    const leftTile = Math.floor((centerX - size.width / 2) / TILE_SIZE);
    const rightTile = Math.floor((centerX + size.width / 2) / TILE_SIZE);
    const topTile = Math.max(0, Math.floor((centerY - size.height / 2) / TILE_SIZE));
    const bottomTile = Math.min(2 ** zoom - 1, Math.floor((centerY + size.height / 2) / TILE_SIZE));
    const tiles: Tile[] = [];
    for (let x = leftTile; x <= rightTile; x++) for (let y = topTile; y <= bottomTile; y++) {
      tiles.push({ x: ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom, y, z: zoom,
        left: x * TILE_SIZE - centerX + size.width / 2, top: y * TILE_SIZE - centerY + size.height / 2 });
    }
    return { zoom, centerX, centerY, tiles };
  }, [located, size]);

  if (!located.length) return <section className="history-map-empty"><MapPin size={30}/><h2>Your map is waiting</h2><p>Restaurants you save, rate, visit, or get directions to will appear here.</p></section>;
  return <section className="history-map-section" aria-label="Restaurant history map">
    <div className="history-map" ref={mapRef} aria-label={`${located.length} explored restaurants on OpenStreetMap`}>
      {viewport && <>
        <div className="history-map-tiles" aria-hidden="true">{viewport.tiles.map(tile => <img key={`${tile.z}/${tile.x}/${tile.y}`} src={`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`} alt="" draggable={false} style={{ left: tile.left, top: tile.top }} />)}</div>
        <div className="history-map-markers">{located.map((entry, index) => {
          const point = worldPoint(entry.place.lat, entry.place.lon, viewport.zoom);
          const x = ((point.x % (TILE_SIZE * 2 ** viewport.zoom)) + TILE_SIZE * 2 ** viewport.zoom) % (TILE_SIZE * 2 ** viewport.zoom);
          return <button key={entry.id} className={`history-map-pin ${entry.status === 'visited' ? 'is-visited' : ''}`} style={{ left: x - viewport.centerX + size.width / 2, top: point.y - viewport.centerY + size.height / 2 }} onClick={() => onSelect(entry)} aria-label={`Open ${entry.place.name}`} title={entry.place.name}><MapPin size={22}/><span>{index + 1}</span></button>;
        })}</div>
      </>}
      <a className="history-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      <span className="history-map-local">Saved on this device</span>
    </div>
    <p className="history-map-note">Map tiles come from OpenStreetMap; rendering the map sends the viewed area to its tile server. Your restaurant history stays on this device.</p>
    <div className="history-map-list">{located.map((entry, index) => <button key={entry.id} className="history-map-row" onClick={() => onSelect(entry)}><span className="history-map-number">{index + 1}</span><span>{entry.place.name}<small>{entry.status === 'visited' ? 'Visited' : entry.sentiment === 'favorite' ? 'Favorite' : entry.status === 'target' ? 'To try' : 'Explored'}</small></span><MapPin size={16}/></button>)}</div>
  </section>;
}
