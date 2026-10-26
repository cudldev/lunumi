import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Clock3, ExternalLink, Globe2, Heart, Leaf, MapPin, Navigation, Sparkles, Utensils, X } from 'lucide-react';
import type { Place } from './core';
import { openingHoursStatus } from './opening-hours';
import RestaurantPhoto from './RestaurantPhoto';
import MenuAssistant from './MenuAssistant';

const visitJumpSrc = new URL('mascot/lunumi-jump.webp', document.baseURI).href;
const visitJumpPreload = new Image();
visitJumpPreload.src = visitJumpSrc;
const visitWalkFrameASrc = new URL('mascot/lunumi-walk-right-a.webp', document.baseURI).href;
const visitWalkFrameAPreload = new Image();
visitWalkFrameAPreload.src = visitWalkFrameASrc;

const safeUrl = (value?: string) => {
  if (!value) return null;
  try { const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
};

type Props = { place: Place; favorite: boolean; status?: string; sentiment?: string; dietary: boolean; recommendation: string; onFavorite: () => void; onDirections: () => void; onStatus: (value: 'target' | 'visited') => void; onSentiment: (value: 'loved' | 'okay' | 'disliked') => void };

export default function PlaceCard({ place, favorite, status, sentiment, dietary, recommendation, onFavorite, onDirections, onStatus, onSentiment }: Props) {
  const [details, setDetails] = useState(false);
  const [visitMode, setVisitMode] = useState(false);
  const [visitIntro, setVisitIntro] = useState(false);
  const [visitFlightActive, setVisitFlightActive] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const visitCharacterRef = useRef<HTMLSpanElement>(null);
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
  useEffect(() => {
    if (!visitIntro || !visitMode) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisitIntro(false);
      return;
    }

    let overlay: HTMLImageElement | null = null;
    let animation: Animation | null = null;
    let walkTimer = 0;
    let firstFrame = 0;
    let secondFrame = 0;
    let cancelled = false;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(async () => {
        const target = visitCharacterRef.current;
        if (!target) { setVisitIntro(false); return; }
        const targetRect = target.getBoundingClientRect();
        const startWidth = targetRect.width * 2;
        const startHeight = targetRect.height * 2;
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const bottomTop = window.innerHeight + 12;
        const startCenterY = bottomTop + startHeight / 2;
        const targetCenterX = targetRect.left + targetRect.width / 2;
        const targetCenterY = targetRect.top + targetRect.height / 2;
        const jumpFrame = (center: number, scale: number, rotation: number, offset: number, opacity = 1, easing?: string): Keyframe => {
          const width = startWidth * scale;
          const height = startHeight * scale;
          return { opacity, left: `${centerX - width / 2}px`, top: `${center - height / 2}px`, width: `${width}px`, height: `${height}px`, transform: `rotate(${rotation}deg)`, offset, ...(easing ? { easing } : {}) };
        };
        const travelFrame = (progress: number, rotation: number, offset: number): Keyframe => {
          const width = startWidth + (targetRect.width - startWidth) * progress;
          const height = startHeight + (targetRect.height - startHeight) * progress;
          const x = centerX + (targetCenterX - centerX) * progress;
          const y = centerY + (targetCenterY - centerY) * progress;
          return { opacity: 1, left: `${x - width / 2}px`, top: `${y - height / 2}px`, width: `${width}px`, height: `${height}px`, transform: `rotate(${rotation}deg)`, offset, easing: 'cubic-bezier(.2,.72,.25,1)' };
        };

        overlay = document.createElement('img');
        overlay.src = visitJumpSrc;
        overlay.alt = '';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.className = 'visit-flight-character';
        Object.assign(overlay.style, { left: `${centerX - startWidth / 2}px`, top: `${bottomTop}px`, width: `${startWidth}px`, height: `${startHeight}px`, transformOrigin: 'center center' });
        try {
          await Promise.all([visitJumpPreload.decode(), visitWalkFrameAPreload.decode(), overlay.decode()]);
        } catch {
          if (!cancelled) setVisitIntro(false);
          return;
        }
        if (cancelled) return;
        document.body.appendChild(overlay);
        setVisitFlightActive(true);
        animation = overlay.animate([
          jumpFrame(startCenterY, 0.76, -6, 0, 0, 'cubic-bezier(.22,.72,.28,1)'),
          jumpFrame(centerY - 42, 1.04, -4, 0.344, 1, 'cubic-bezier(.18,.85,.25,1)'),
          jumpFrame(centerY, 0.97, 3, 0.467, 1, 'cubic-bezier(.2,.7,.3,1)'),
          jumpFrame(centerY, 1, 0, 0.58, 1, 'cubic-bezier(.2,.72,.25,1)'),
          travelFrame(0.25, 12, 0.685),
          travelFrame(0.75, -12, 0.895),
          travelFrame(1, 12, 1),
        ], { duration: 1810, fill: 'forwards' });
        walkTimer = window.setTimeout(() => { if (!cancelled && overlay) overlay.src = visitWalkFrameASrc; }, 1050);
        await animation.finished.catch(() => undefined);
        if (cancelled || !overlay) return;
        overlay.remove(); overlay = null; setVisitFlightActive(false); setVisitIntro(false);
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(walkTimer);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      animation?.cancel();
      overlay?.remove();
      setVisitFlightActive(false);
    };
  }, [visitIntro, visitMode]);
  const cuisine = (place.tags.cuisine || place.tags.amenity?.replace('_', ' ') || 'Food nearby').split(';').map(x => x.trim()).filter(Boolean);
  const hours = openingHoursStatus(place.tags.opening_hours);
  const lunchFeed = safeUrl(place.tags['lunch:feed']), menuFeed = safeUrl(place.tags['menu:feed']);
  const menu = lunchFeed || menuFeed || safeUrl(place.tags['menu:website'] || place.tags['website:menu'] || place.tags['lunch:website'] || place.tags['website:lunch'] || place.tags.menu);
  const website = safeUrl(place.tags.website || place.tags['contact:website']);
  const menuLabel = lunchFeed ? 'Live lunch feed' : menuFeed ? 'Live menu feed' : place.tags['lunch:website'] || place.tags['website:lunch'] ? 'Lunch menu' : 'Menu';
  const dietTags = Object.entries(place.tags).filter(([key, value]) => key.startsWith('diet:') && ['yes', 'only', 'limited'].includes(value.toLowerCase()));
  const foodTags = Object.entries(place.tags).filter(([key, value]) => (key === 'food' || key.startsWith('food:')) && value.toLowerCase() === 'yes').map(([key]) => key === 'food' ? 'Food served' : key.slice(5).replace(/_/g, ' '));

  const mapUrl = new URL('https://www.openstreetmap.org/export/embed.html');
  mapUrl.searchParams.set('bbox', `${place.lon - 0.006},${place.lat - 0.0035},${place.lon + 0.006},${place.lat + 0.0035}`);
  mapUrl.searchParams.set('layer', 'mapnik');
  mapUrl.searchParams.set('marker', `${place.lat},${place.lon}`);
  const closeDetails = () => { setDetails(false); setVisitMode(false); setVisitIntro(false); setVisitFlightActive(false); setDetailsExpanded(false); };
  const startVisit = () => { setVisitIntro(true); setVisitMode(true); onStatus('target'); };

  return <>
    <article className="place-card place-card-visual" onClick={() => setDetails(true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetails(true); } }} tabIndex={0} role="button" aria-label={`View ${place.name}`}>
      <RestaurantPhoto name={place.name} photo={place.photo} cuisine={cuisine[0]} />
      <div className="place-card-copy"><div className="place-title"><h3>{place.name}</h3><p>{cuisine.slice(0, 2).join(' · ')} <span>·</span> {place.distance < 1000 ? `${Math.round(place.distance / 10) * 10} m` : `${(place.distance / 1000).toFixed(1)} km`}</p></div>
      <button className={`heart${favorite ? ' hearted' : ''}`} aria-label={favorite ? 'Remove favorite' : 'Add favorite'} onClick={event => { event.stopPropagation(); onFavorite(); }}>♥</button></div>
      <div className="place-card-foot"><span>{hours?.text || 'Nearby food spot'}</span><span className="card-open">View place <ArrowLeft size={14}/></span></div>
    </article>
    {details && createPortal(<div className="place-detail-backdrop" onClick={closeDetails} role="presentation"><section className={`place-detail${detailsExpanded ? ' expanded' : ''}${visitMode ? ' visit-mode' : ''}${visitIntro ? ' visit-intro-active' : ''}${visitFlightActive ? ' visit-flight-active' : ''}`} role="dialog" aria-modal="true" aria-label={visitMode ? `Visit ${place.name}` : `${place.name} details`} onClick={event => event.stopPropagation()}>
      <button className="place-detail-handle" type="button" aria-label={detailsExpanded ? 'Collapse details' : 'Expand details'} aria-expanded={detailsExpanded} onClick={() => { if (suppressHandleClick.current) { suppressHandleClick.current = false; return; } setDetailsExpanded(value => !value); }} onPointerDown={event => { dragStartY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (dragStartY.current === null) return; const delta = event.clientY - dragStartY.current; dragStartY.current = null; if (Math.abs(delta) > 28) { suppressHandleClick.current = true; setDetailsExpanded(delta < 0); } }} onPointerCancel={() => { dragStartY.current = null; }}><span /></button>
      <button className="place-detail-close" onClick={closeDetails} aria-label="Close details"><X size={20}/></button>
      {visitMode ? <div className="visit-journey" aria-label={`Starting a visit to ${place.name}`}>
        <div className="visit-route" aria-hidden="true"><span className="visit-route-line"/><MapPin className="visit-route-pin" size={22}/><span className="visit-character" ref={visitCharacterRef}><img className="visit-character-frame visit-character-frame-a" src={visitWalkFrameASrc} alt="" draggable={false}/></span></div>
        <div className="visit-journey-copy"><span className="eyebrow">A LITTLE ADVENTURE</span><strong>On our way to {place.name}</strong><span>Good food is just around the corner.</span></div>
      </div> : <RestaurantPhoto name={place.name} photo={place.photo} cuisine={cuisine[0]} large />}
      <div className="place-detail-content">
        {visitMode ? <>
          <button className="back" onClick={() => setVisitMode(false)}><ArrowLeft size={17}/> Place details</button>
          <div className="visit-title"><div><span className="eyebrow">YOUR NEXT STOP</span><h2>{place.name}</h2><p>{cuisine.join(' · ')} · {place.distance < 1000 ? `${Math.round(place.distance / 10) * 10} m away` : `${(place.distance / 1000).toFixed(1)} km away`}</p></div><Sparkles size={23}/></div>
          <div className="visit-map"><iframe title={`Map showing ${place.name}`} src={mapUrl.toString()} loading="lazy" referrerPolicy="no-referrer"/><a href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=16/${place.lat}/${place.lon}`} target="_blank" rel="noopener noreferrer">Open map</a></div>
          <button className="button directions visit-directions" onClick={onDirections}><Navigation size={17}/>Directions to {place.name}<span>↗</span></button>
          <div className="visit-feedback"><h3>{sentiment ? 'How was it?' : 'Did you like it?'}</h3><div className="visit-feedback-actions">
            <button className={`button outline${sentiment === 'loved' ? ' selected' : ''}`} aria-pressed={sentiment === 'loved'} onClick={() => onSentiment('loved')}><Heart size={16}/>Loved it</button>
            <button className={`button outline${sentiment === 'okay' ? ' selected' : ''}`} aria-pressed={sentiment === 'okay'} onClick={() => onSentiment('okay')}>It was okay</button>
            <button className={`button outline${sentiment === 'disliked' ? ' selected' : ''}`} aria-pressed={sentiment === 'disliked'} onClick={() => onSentiment('disliked')}>Not for me</button>
          </div></div>
          <button className={`button visit-complete${status === 'visited' ? ' is-visited' : ''}`} onClick={() => onStatus('visited')}><Check size={17}/>{status === 'visited' ? 'Visited — saved to your places' : 'Mark as visited'}</button>
        </> : <>
        <div className="place-detail-heading"><div><span className="eyebrow">{cuisine.join(' · ')}</span><h2>{place.name}</h2></div><button className={`heart${favorite ? ' hearted' : ''}`} aria-label={favorite ? 'Remove favorite' : 'Add favorite'} onClick={onFavorite}>♥</button></div>
        <div className="detail-facts"><span><MapPin size={15}/>{place.distance < 1000 ? `${Math.round(place.distance / 10) * 10} m away` : `${(place.distance / 1000).toFixed(1)} km away`}</span>{hours && <span><Clock3 size={15}/>{hours.text}</span>}</div>
        {place.stale && <p className="smallprint">Saved result · may be out of date</p>}
        {dietary && <span className="status unknown">Dietary compatibility unknown — check with the restaurant</span>}
        {(dietTags.length > 0 || foodTags.length > 0) && <div className="place-tags detail-tags">{dietTags.map(([key, value]) => <span className="food-tag" key={key}><Leaf size={12}/>{key.slice(5).replace(/_/g, ' ')}{value === 'only' ? ' only' : ''}</span>)}{foodTags.map(tag => <span className="food-tag" key={tag}><Utensils size={12}/>{tag}</span>)}</div>}
        <p className="reason detail-reason">{sentiment === 'loved' ? 'A place you loved before' : recommendation}</p>
        <h3 className="detail-section-title">Good to know</h3><p className="detail-description">{place.tags.opening_hours ? `Hours: ${place.tags.opening_hours}` : 'Opening hours are not listed.'}</p>
        <h3 className="detail-section-title">Menu & links</h3>{menu || website ? <div className="detail-actions">{menu && <a className="button outline" href={menu} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>{menuLabel}</a>}{website && <a className="button outline" href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={15}/>Website</a>}</div> : <p className="detail-description">No menu link is listed yet. Check the restaurant website or open directions.</p>}
        <MenuAssistant restaurantName={place.name} sourceUrl={menu || website}/>
        <button className="button visit-start" onClick={startVisit}><Sparkles size={17}/>{status === 'target' ? 'Continue your visit' : 'Start a visit'}<span>→</span></button>
        </>}
      </div>
      <div className="place-detail-bottom-bar"><button className="place-detail-bottom-back" onClick={closeDetails}><ArrowLeft size={17}/>Back to places</button></div>
    </section></div>, document.body)}
  </>;
}
