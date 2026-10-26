import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Clock3, ExternalLink, Globe2, Leaf, MapPin, Navigation, Utensils, X } from 'lucide-react';
import type { Place } from './core';
import { openingHoursStatus } from './opening-hours';
import RestaurantPhoto from './RestaurantPhoto';

const safeUrl = (value?: string) => {
  if (!value) return null;
  try { const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
};

type Props = { place: Place; favorite: boolean; status?: string; sentiment?: string; dietary: boolean; recommendation: string; onFavorite: () => void; onDirections: () => void; onStatus: (value: 'target' | 'visited') => void; onSentiment: (value: 'loved' | 'okay' | 'disliked') => void };

export default function PlaceCard({ place, favorite, status, sentiment, dietary, recommendation, onFavorite, onDirections, onStatus, onSentiment }: Props) {
  const [details, setDetails] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const suppressHandleClick = useRef(false);
  useEffect(() => {
    if (!details) return;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const previousOverflowY = shell?.style.overflowY ?? '';
    const previousOverscrollBehavior = shell?.style.overscrollBehavior ?? '';
    const previousBodyOverflow = document.body.style.overflow;
    const scrollTop = shell?.scrollTop ?? 0;
    if (shell) {
      shell.style.overflowY = 'hidden';
      shell.style.overscrollBehavior = 'none';
    }
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetails(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      if (shell) {
        shell.style.overflowY = previousOverflowY;
        shell.style.overscrollBehavior = previousOverscrollBehavior;
        shell.scrollTop = scrollTop;
      }
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [details]);
  const cuisine = (place.tags.cuisine || place.tags.amenity?.replace('_', ' ') || 'Food nearby').split(';').map(x => x.trim()).filter(Boolean);
  const hours = openingHoursStatus(place.tags.opening_hours);
  const lunchFeed = safeUrl(place.tags['lunch:feed']), menuFeed = safeUrl(place.tags['menu:feed']);
  const menu = lunchFeed || menuFeed || safeUrl(place.tags['menu:website'] || place.tags['website:menu'] || place.tags['lunch:website'] || place.tags['website:lunch'] || place.tags.menu);
  const website = safeUrl(place.tags.website || place.tags['contact:website']);
  const menuLabel = lunchFeed ? 'Live lunch feed' : menuFeed ? 'Live menu feed' : place.tags['lunch:website'] || place.tags['website:lunch'] ? 'Lunch menu' : 'Menu';
  const dietTags = Object.entries(place.tags).filter(([key, value]) => key.startsWith('diet:') && ['yes', 'only', 'limited'].includes(value.toLowerCase()));
  const foodTags = Object.entries(place.tags).filter(([key, value]) => (key === 'food' || key.startsWith('food:')) && value.toLowerCase() === 'yes').map(([key]) => key === 'food' ? 'Food served' : key.slice(5).replace(/_/g, ' '));

  const actions = <div className="detail-actions">
    {menu && <a className="button outline" href={menu} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>{menuLabel}</a>}
    {website && <a className="button outline" href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={15}/>Website</a>}
    <button className="button directions" onClick={onDirections}><Navigation size={16}/>Directions</button>
    <button className="button outline" onClick={() => onStatus('target')}>{status === 'target' ? 'To try ✓' : 'Try this'}</button>
    <button className="button outline" onClick={() => onStatus('visited')}>{status === 'visited' ? 'Visited ✓' : 'Mark visited'}</button>
    <button className="button outline" onClick={() => onSentiment('loved')}>♥ Loved</button>
    <button className="button outline" onClick={() => onSentiment('okay')}>Okay</button>
    <button className="button outline" onClick={() => onSentiment('disliked')}>Nope</button>
  </div>;

  return <>
    <article className="place-card place-card-visual" onClick={() => setDetails(true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetails(true); } }} tabIndex={0} role="button" aria-label={`View ${place.name}`}>
      <RestaurantPhoto name={place.name} photo={place.photo} cuisine={cuisine[0]} />
      <div className="place-card-copy"><div className="place-title"><h3>{place.name}</h3><p>{cuisine.slice(0, 2).join(' · ')} <span>·</span> {place.distance < 1000 ? `${Math.round(place.distance / 10) * 10} m` : `${(place.distance / 1000).toFixed(1)} km`}</p></div>
      <button className={`heart${favorite ? ' hearted' : ''}`} aria-label={favorite ? 'Remove favorite' : 'Add favorite'} onClick={event => { event.stopPropagation(); onFavorite(); }}>♥</button></div>
      <div className="place-card-foot"><span>{hours?.text || 'Nearby food spot'}</span><span className="card-open">View place <ArrowLeft size={14}/></span></div>
    </article>
    {details && createPortal(<div className="place-detail-backdrop" onClick={() => setDetails(false)} role="presentation"><section className={`place-detail${detailsExpanded ? ' expanded' : ''}`} role="dialog" aria-modal="true" aria-label={`${place.name} details`} onClick={event => event.stopPropagation()}>
      <button className="place-detail-handle" type="button" aria-label={detailsExpanded ? 'Collapse details' : 'Expand details'} aria-expanded={detailsExpanded} onClick={() => { if (suppressHandleClick.current) { suppressHandleClick.current = false; return; } setDetailsExpanded(value => !value); }} onPointerDown={event => { dragStartY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (dragStartY.current === null) return; const delta = event.clientY - dragStartY.current; dragStartY.current = null; if (Math.abs(delta) > 28) { suppressHandleClick.current = true; setDetailsExpanded(delta < 0); } }} onPointerCancel={() => { dragStartY.current = null; }}><span /></button>
      <button className="place-detail-close" onClick={() => setDetails(false)} aria-label="Close details"><X size={20}/></button>
      <RestaurantPhoto name={place.name} photo={place.photo} cuisine={cuisine[0]} large />
      <div className="place-detail-content"><button className="back" onClick={() => setDetails(false)}><ArrowLeft size={17}/> Back to places</button>
        <div className="place-detail-heading"><div><span className="eyebrow">{cuisine.join(' · ')}</span><h2>{place.name}</h2></div><button className={`heart${favorite ? ' hearted' : ''}`} aria-label={favorite ? 'Remove favorite' : 'Add favorite'} onClick={onFavorite}>♥</button></div>
        <div className="detail-facts"><span><MapPin size={15}/>{place.distance < 1000 ? `${Math.round(place.distance / 10) * 10} m away` : `${(place.distance / 1000).toFixed(1)} km away`}</span>{hours && <span><Clock3 size={15}/>{hours.text}</span>}</div>
        {place.stale && <p className="smallprint">Saved result · may be out of date</p>}
        {dietary && <span className="status unknown">Dietary compatibility unknown — check with the restaurant</span>}
        {(dietTags.length > 0 || foodTags.length > 0) && <div className="place-tags detail-tags">{dietTags.map(([key, value]) => <span className="food-tag" key={key}><Leaf size={12}/>{key.slice(5).replace(/_/g, ' ')}{value === 'only' ? ' only' : ''}</span>)}{foodTags.map(tag => <span className="food-tag" key={tag}><Utensils size={12}/>{tag}</span>)}</div>}
        <p className="reason detail-reason">{sentiment === 'loved' ? 'A place you loved before' : recommendation}</p>
        <h3 className="detail-section-title">Good to know</h3><p className="detail-description">{place.tags.opening_hours ? `Hours: ${place.tags.opening_hours}` : 'Opening hours are not listed.'}</p>
        <h3 className="detail-section-title">Menu & links</h3>{menu || website ? actions : <p className="detail-description">No menu link is listed yet. Check the restaurant website or open directions.</p>}
        {!(menu || website) && actions}
      </div>
    </section></div>, document.body)}
  </>;
}
