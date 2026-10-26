import { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import type { Place } from './core';
import './history-map.css';

type MapEntry = { id: string; place: Place; when: string; status?: string; sentiment?: string };

export default function HistoryMap({ entries, onSelect }: { entries: MapEntry[]; onSelect: (entry: MapEntry) => void }) {
  const located = useMemo(() => entries.filter(entry => Number.isFinite(entry.place.lat) && Number.isFinite(entry.place.lon)), [entries]);
  const bounds = useMemo(() => {
    if (!located.length) return null;
    const lats = located.map(entry => entry.place.lat), lons = located.map(entry => entry.place.lon);
    const padLat = Math.max((Math.max(...lats) - Math.min(...lats)) * .2, .006);
    const padLon = Math.max((Math.max(...lons) - Math.min(...lons)) * .2, .008);
    return { south: Math.min(...lats) - padLat, north: Math.max(...lats) + padLat, west: Math.min(...lons) - padLon, east: Math.max(...lons) + padLon };
  }, [located]);
  if (!located.length || !bounds) return <section className="history-map-empty"><MapPin size={30}/><h2>Your map is waiting</h2><p>Restaurants you save, rate, visit, or get directions to will appear here.</p></section>;
  return <section className="history-map-section" aria-label="Restaurant history map">
    <div className="history-map" aria-label={`${located.length} explored restaurants on map`}>
      <div className="history-map-grid" aria-hidden="true" />
      <span className="history-map-compass" aria-hidden="true">N ↑</span>
      {located.map((entry, index) => {
        const left = 8 + (entry.place.lon - bounds.west) / (bounds.east - bounds.west) * 84;
        const top = 8 + (bounds.north - entry.place.lat) / (bounds.north - bounds.south) * 84;
        return <button key={entry.id} className={`history-map-pin ${entry.status === 'visited' ? 'is-visited' : ''}`} style={{ left: `${left}%`, top: `${top}%` }} onClick={() => onSelect(entry)} aria-label={`Open ${entry.place.name}`} title={entry.place.name}><MapPin size={22}/><span>{index + 1}</span></button>;
      })}
      <span className="history-map-local">Saved on this device</span>
    </div>
    <p className="history-map-note">Pins are positioned by restaurant coordinates. No location data is sent to a map service.</p>
    <div className="history-map-list">{located.map((entry, index) => <button key={entry.id} className="history-map-row" onClick={() => onSelect(entry)}><span className="history-map-number">{index + 1}</span><span>{entry.place.name}<small>{entry.status === 'visited' ? 'Visited' : entry.sentiment === 'favorite' ? 'Favorite' : entry.status === 'target' ? 'To try' : 'Explored'}</small></span><MapPin size={16}/></button>)}</div>
  </section>;
}
