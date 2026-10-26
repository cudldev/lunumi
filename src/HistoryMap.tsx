import { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, MapPin, Minus, Plus } from 'lucide-react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Place } from './core';
import './history-map.css';

type MapEntry = { id: string; place: Place; when: string; sentiment?: string; recommendationVote?: 'yes' | 'maybe' | 'no'; status?: 'target' | 'visited'; visitedAt?: string; tags: string[]; isUnvisited?: boolean };
type Tile = { x: number; y: number; z: number; left: number; top: number };
type Marker = { kind: 'place'; entry: MapEntry; x: number; y: number; number?: number } | { kind: 'cluster'; entries: MapEntry[]; x: number; y: number; lat: number; lon: number };
const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const CLUSTER_SIZE = 120;
const MAX_NEARBY_ROWS = 12;
const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));
const worldPoint = (lat: number, lon: number, zoom: number) => {
  const scale = TILE_SIZE * 2 ** zoom;
  const safeLat = clampLat(lat) * Math.PI / 180;
  return { x: ((lon + 180) / 360) * scale, y: ((1 - Math.asinh(Math.tan(safeLat)) / Math.PI) / 2) * scale };
};
const wrap = (value: number, width: number) => ((value % width) + width) % width;

export default function HistoryMap({ entries, onSelect }: { entries: MapEntry[]; onSelect: (entry: MapEntry) => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const located = useMemo(() => entries.filter(entry => Number.isFinite(entry.place.lat) && Number.isFinite(entry.place.lon)), [entries]);
  const historyEntries = useMemo(() => located.filter(entry => !entry.isUnvisited), [located]);
  const nearbyEntries = useMemo(() => located.filter(entry => entry.isUnvisited), [located]);
  const projected = useMemo(() => new Map(located.map(entry => [entry.id, worldPoint(entry.place.lat, entry.place.lon, 0)])), [located]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const observer = new ResizeObserver(([item]) => setSize({ width: item.contentRect.width, height: item.contentRect.height }));
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  const fitted = useMemo(() => {
    if (!located.length || !size.width || !size.height) return null;
    const points = located.map(entry => worldPoint(entry.place.lat, entry.place.lon, 0));
    const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
    let zoom = MAX_ZOOM;
    while (zoom > MIN_ZOOM) {
      const scale = 2 ** zoom;
      if ((maxX - minX) * scale <= size.width * .72 && (maxY - minY) * scale <= size.height * .72) break;
      zoom--;
    }
    const center = worldPoint(
      (Math.min(...located.map(e => e.place.lat)) + Math.max(...located.map(e => e.place.lat))) / 2,
      (Math.min(...located.map(e => e.place.lon)) + Math.max(...located.map(e => e.place.lon))) / 2,
      zoom,
    );
    const worldSize = TILE_SIZE * 2 ** zoom;
    return { zoom, centerX: wrap(center.x, worldSize), centerY: center.y };
  }, [located, size]);

  const viewport = useMemo(() => {
    if (!fitted) return null;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitted.zoom + zoomOffset));
    const worldSize = TILE_SIZE * 2 ** zoom;
    const scale = 2 ** (zoom - fitted.zoom);
    const centerX = wrap(fitted.centerX * scale + pan.x, worldSize);
    const centerY = Math.max(size.height / 2, Math.min(worldSize - size.height / 2, fitted.centerY * scale + pan.y));
    const leftTile = Math.floor((centerX - size.width / 2) / TILE_SIZE);
    const rightTile = Math.floor((centerX + size.width / 2) / TILE_SIZE);
    const topTile = Math.max(0, Math.floor((centerY - size.height / 2) / TILE_SIZE));
    const bottomTile = Math.min(2 ** zoom - 1, Math.floor((centerY + size.height / 2) / TILE_SIZE));
    const tiles: Tile[] = [];
    for (let x = leftTile; x <= rightTile; x++) for (let y = topTile; y <= bottomTile; y++) {
      tiles.push({ x: wrap(x, 2 ** zoom), y, z: zoom, left: x * TILE_SIZE - centerX + size.width / 2, top: y * TILE_SIZE - centerY + size.height / 2 });
    }
    return { zoom, centerX, centerY, tiles };
  }, [fitted, pan, size, zoomOffset]);

  const markers = useMemo<Marker[]>(() => {
    if (!viewport) return [];
    const worldSize = TILE_SIZE * 2 ** viewport.zoom;
    const position = (entry: MapEntry) => {
      const base = projected.get(entry.id)!;
      const point = { x: base.x * 2 ** viewport.zoom, y: base.y * 2 ** viewport.zoom };
      return { x: wrap(point.x, worldSize) - viewport.centerX + size.width / 2, y: point.y - viewport.centerY + size.height / 2 };
    };
    const historyNumbers = new Map(historyEntries.map((entry, index) => [entry.id, index + 1]));
    const result: Marker[] = historyEntries.map(entry => ({ kind: 'place', entry, ...position(entry), number: historyNumbers.get(entry.id) }));
    const groups = new Map<string, Array<{ entry: MapEntry; x: number; y: number }>>();
    nearbyEntries.forEach(entry => {
      const point = position(entry);
      const overscan = CLUSTER_SIZE / 2;
      if (point.x < -overscan || point.x > size.width + overscan || point.y < -overscan || point.y > size.height + overscan) return;
      const key = `${Math.floor(point.x / CLUSTER_SIZE)}:${Math.floor(point.y / CLUSTER_SIZE)}`;
      const group = groups.get(key) || [];
      group.push({ entry, ...point });
      groups.set(key, group);
    });
    groups.forEach(group => {
      if (group.length === 1) {
        const item = group[0];
        result.push({ kind: 'place', entry: item.entry, x: item.x, y: item.y });
        return;
      }
      result.push({ kind: 'cluster', entries: group.map(item => item.entry), x: group.reduce((sum, item) => sum + item.x, 0) / group.length, y: group.reduce((sum, item) => sum + item.y, 0) / group.length, lat: group.reduce((sum, item) => sum + item.entry.place.lat, 0) / group.length, lon: group.reduce((sum, item) => sum + item.entry.place.lon, 0) / group.length });
    });
    return result;
  }, [historyEntries, nearbyEntries, projected, size, viewport]);

  const zoomBy = (delta: number) => {
    if (!fitted || !viewport) return;
    setZoomOffset(current => Math.max(MIN_ZOOM - fitted.zoom, Math.min(MAX_ZOOM - fitted.zoom, current + delta)));
  };
  const zoomTo = (lat: number, lon: number) => {
    if (!fitted || !viewport) return;
    const zoom = Math.min(MAX_ZOOM, viewport.zoom + 2);
    const scale = 2 ** (zoom - fitted.zoom);
    const point = worldPoint(lat, lon, zoom);
    const worldSize = TILE_SIZE * 2 ** zoom;
    setZoomOffset(zoom - fitted.zoom);
    setPan({ x: wrap(point.x, worldSize) - fitted.centerX * scale, y: point.y - fitted.centerY * scale });
  };
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button,a')) return;
    dragStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setPan({ x: dragStart.current.panX - (event.clientX - dragStart.current.x), y: dragStart.current.panY - (event.clientY - dragStart.current.y) });
  };
  const stopPan = () => { dragStart.current = null; };
  const panByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const shifts: Record<string, [number, number]> = { ArrowLeft: [-72, 0], ArrowRight: [72, 0], ArrowUp: [0, -72], ArrowDown: [0, 72] };
    const shift = shifts[event.key];
    if (!shift) return;
    event.preventDefault();
    setPan(current => ({ x: current.x + shift[0], y: current.y + shift[1] }));
  };

  if (!located.length) return <section className="history-map-empty"><MapPin size={30}/><h2>Your map is waiting</h2><p>Nearby places will appear after a location is set. Saved restaurants stay on the map.</p></section>;
  return <section className="history-map-section" aria-label="Restaurant history and nearby map">
    <div className="history-map" ref={mapRef} tabIndex={0} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan} onKeyDown={panByKey} aria-label={`${historyEntries.length} history places and ${nearbyEntries.length} nearby places on OpenStreetMap. Drag to move, use arrow keys to pan.`}>
      {viewport && <>
        <div className="history-map-tiles" aria-hidden="true">{viewport.tiles.map(tile => <img key={`${tile.z}/${tile.x}/${tile.y}`} src={`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`} alt="" draggable={false} style={{ left: tile.left, top: tile.top }} />)}</div>
        <div className="history-map-markers">{markers.map((marker, index) => marker.kind === 'cluster'
          ? <button key={`cluster-${index}`} className="history-map-cluster" style={{ left: marker.x, top: marker.y }} onClick={() => zoomTo(marker.lat, marker.lon)} aria-label={`Zoom in on ${marker.entries.length} nearby restaurants`} title={`${marker.entries.length} nearby restaurants`}>{marker.entries.length}</button>
          : <button key={marker.entry.id} className={`history-map-pin ${marker.entry.isUnvisited ? 'is-nearby' : marker.entry.status === 'target' ? 'is-target' : marker.entry.status === 'visited' ? 'is-visited' : 'is-explored'}`} style={{ left: marker.x, top: marker.y }} onClick={() => onSelect(marker.entry)} aria-label={`Open ${marker.entry.place.name}`} title={marker.entry.place.name}><MapPin size={22}/>{marker.number && <span>{marker.number}</span>}</button>)}</div>
      </>}
      {viewport && <>
        <nav className="history-map-controls" aria-label="Map navigation">
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={viewport.zoom >= MAX_ZOOM} onClick={() => zoomBy(1)}><Plus size={16}/></button>
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={viewport.zoom <= MIN_ZOOM} onClick={() => zoomBy(-1)}><Minus size={16}/></button>
          <button type="button" className="history-map-fit" aria-label="Fit all places" title="Fit all places" onClick={() => { setZoomOffset(0); setPan({ x: 0, y: 0 }); }}><LocateFixed size={15}/><span>Fit</span></button>
        </nav>
        <div className="history-map-legend" aria-label="Pin colors"><span><i className="is-explored"/>Explored</span><span><i className="is-target"/>To try</span><span><i className="is-nearby"/>Nearby</span><span><i className="is-visited"/>Visited</span></div>
      </>}
      <a className="history-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      <span className="history-map-local">Saved on this device</span>
    </div>
    <p className="history-map-note">Nearby pins are places not marked visited in your history. Clustered pins expand as you zoom; drag to pan, use Fit to reset, or use arrow keys when the map is focused. OpenStreetMap receives only the map tiles you view.</p>
    <div className="history-map-list">{[...historyEntries, ...nearbyEntries.slice(0, MAX_NEARBY_ROWS)].map((entry, index) => <button key={entry.id} className="history-map-row" onClick={() => onSelect(entry)}><span className="history-map-number">{index + 1}</span><span>{entry.place.name}<small>{entry.isUnvisited ? 'Nearby · not marked visited' : entry.status === 'visited' ? 'Visited' : entry.sentiment === 'favorite' ? 'Favorite' : entry.status === 'target' ? 'To try' : 'Explored'}</small></span><MapPin size={16}/></button>)}</div>
    {nearbyEntries.length > MAX_NEARBY_ROWS && <p className="history-map-note">Showing your history and the 12 closest nearby suggestions in the list; all nearby places are shown on the map.</p>}
  </section>;
}
