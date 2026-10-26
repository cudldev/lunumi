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

type VisitOrigin = 'target' | 'explored' | 'nearby' | 'visited';
type Props = { place: Place; favorite: boolean; status?: string; sentiment?: string; recommendationVote?: 'yes' | 'maybe' | 'no'; dietary: boolean; recommendation: string; onFavorite: () => void; onDirections: () => void; onStatus: (value: 'target' | 'visited') => void | Promise<void>; onSentiment: (value: 'loved' | 'okay' | 'disliked') => void; onRecommendation: (value: 'yes' | 'maybe' | 'no') => void; onReturn: (placeId: string, from: VisitOrigin) => void; onTransitionStart?: () => void; onTransitionCancel?: () => void; initiallyOpen?: boolean; onDismiss?: () => void };

export default function PlaceCard({ place, favorite, status, sentiment, recommendationVote, dietary, recommendation, onFavorite, onDirections, onStatus, onSentiment, onRecommendation, onReturn, onTransitionStart, onTransitionCancel, initiallyOpen = false, onDismiss }: Props) {
  const [details, setDetails] = useState(initiallyOpen);
  const [visitMode, setVisitMode] = useState(false);
  const [visitStage, setVisitStage] = useState<'journey' | 'outro'>('journey');
  const [visitIntro, setVisitIntro] = useState(false);
  const [visitFlightActive, setVisitFlightActive] = useState(false);
  const [visitFinishing, setVisitFinishing] = useState(false);
  const [visitFeedbackStep, setVisitFeedbackStep] = useState<'sentiment' | 'recommendation'>('sentiment');
  const [visitSaveError, setVisitSaveError] = useState('');
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const visitCharacterRef = useRef<HTMLSpanElement>(null);
  const visitOutroMascotRef = useRef<HTMLImageElement>(null);
  const visitFinishingRef = useRef(false);
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
  const closeDetails = () => { setDetails(false); setVisitMode(false); setVisitIntro(false); setVisitFlightActive(false); setVisitFinishing(false); visitFinishingRef.current = false; setDetailsExpanded(false); onDismiss?.(); };
  const startVisit = () => { const hasSentiment = Boolean(sentiment && ['loved', 'okay', 'disliked'].includes(sentiment)); setVisitStage(status === 'visited' || visitStage === 'outro' ? 'outro' : 'journey'); setVisitFeedbackStep(hasSentiment ? 'recommendation' : 'sentiment'); setVisitSaveError(''); setVisitIntro(true); setVisitMode(true); if (status !== 'visited') onStatus('target'); };
  const feedbackComplete = Boolean(sentiment && ['loved', 'okay', 'disliked'].includes(sentiment) && recommendationVote);
  const finishVisit = async () => {
    if (!feedbackComplete || visitFinishingRef.current) return;
    visitFinishingRef.current = true;
    onTransitionStart?.();
    setVisitFinishing(true);
    setVisitSaveError('');
    const mascot = visitOutroMascotRef.current;
    const mapTab = document.querySelector<HTMLElement>('[data-nav-tab="map"]');
    const mapIcon = mapTab?.querySelector<SVGElement>('svg');
    const sourceRect = mascot?.getBoundingClientRect();
    const targetRect = mapIcon?.getBoundingClientRect();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const arrivalFrom: VisitOrigin = status === 'visited' ? 'visited' : 'target';
    let flight: HTMLDivElement | null = null;
    let flightFrames: Keyframe[] = [];

    if (mascot && mapTab && sourceRect && targetRect && !reducedMotion && typeof mascot.animate === 'function') {
      flight = document.createElement('div');
      flight.setAttribute('aria-hidden', 'true');
      flight.className = 'visit-flight-character visit-return-flight-character';
      Object.assign(flight.style, { left: `${sourceRect.left}px`, top: `${sourceRect.top}px`, width: `${sourceRect.width}px`, height: `${sourceRect.height}px` });
      const flightMascot = document.createElement('img');
      flightMascot.src = visitJumpSrc;
      flightMascot.alt = '';
      flightMascot.draggable = false;
      const carriedMarker = document.createElement('span');
      carriedMarker.className = 'visit-carried-map-marker';
      const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pin.setAttribute('viewBox', '0 0 24 24');
      pin.setAttribute('aria-hidden', 'true');
      const pinPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pinPath.setAttribute('d', 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z');
      const pinCenter = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      pinCenter.setAttribute('cx', '12');
      pinCenter.setAttribute('cy', '10');
      pinCenter.setAttribute('r', '2.7');
      pin.append(pinPath, pinCenter);
      carriedMarker.appendChild(pin);
      flight.append(flightMascot, carriedMarker);
      document.body.appendChild(flight);
      mascot.style.visibility = 'hidden';
      mapTab.classList.add('visit-return-target');

      const startX = sourceRect.left + sourceRect.width / 2;
      const startY = sourceRect.top + sourceRect.height / 2;
      const targetX = targetRect.left + targetRect.width / 2;
      const targetY = targetRect.top + targetRect.height / 2;
      const control1 = { x: startX + (targetX - startX) * 0.18, y: startY - Math.max(150, Math.abs(targetX - startX) * 0.2) };
      const control2 = { x: startX + (targetX - startX) * 0.84, y: targetY - Math.max(100, Math.abs(targetX - startX) * 0.12) };
      flightFrames = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.94, 1].map(offset => {
        const inverse = 1 - offset;
        const x = inverse ** 3 * startX + 3 * inverse ** 2 * offset * control1.x + 3 * inverse * offset ** 2 * control2.x + offset ** 3 * targetX;
        const y = inverse ** 3 * startY + 3 * inverse ** 2 * offset * control1.y + 3 * inverse * offset ** 2 * control2.y + offset ** 3 * targetY;
        const scale = 1 - offset * 0.84;
        const rotation = -8 + offset * 34;
        const opacity = offset < 0.84 ? 1 : Math.max(0, 1 - (offset - 0.84) / 0.16);
        return { transform: `translate3d(${x - startX}px,${y - startY}px,0) scale(${scale}) rotate(${rotation}deg)`, opacity, offset, ...(offset < 1 ? { easing: 'cubic-bezier(.22,.72,.28,1)' } : {}) };
      });
    }

    try {
      await onStatus('visited');
    } catch {
      flight?.remove();
      if (mascot?.isConnected) mascot.style.visibility = '';
      mapTab?.classList.remove('visit-return-target');
      visitFinishingRef.current = false;
      setVisitFinishing(false);
      onTransitionCancel?.();
      setVisitSaveError('Your visit could not be saved. Please try again.');
      return;
    }

    if (flight && mapTab) {
      if (mascot?.isConnected) closeDetails();
      try {
        await new Promise(resolve => window.setTimeout(resolve, 650));
        await flight.animate(flightFrames, { duration: 3000, fill: 'forwards' }).finished.catch(() => undefined);
      } finally {
        flight.remove();
        onReturn(place.id, arrivalFrom);
        window.setTimeout(() => mapTab.classList.remove('visit-return-target'), 2400);
      }
      return;
    }

    if (mascot?.isConnected) closeDetails();
    onReturn(place.id, arrivalFrom);
  };

  return <>
    <article className="place-card place-card-visual" onClick={event => { if (!(event.target as HTMLElement).closest('button,a')) setDetails(true); }}>
      <RestaurantPhoto name={place.name} photo={place.photo} cuisine={cuisine[0]} />
      <div className="place-card-copy"><div className="place-title"><h3>{place.name}</h3><p>{cuisine.slice(0, 2).join(' · ')} <span>·</span> {place.distance < 1000 ? `${Math.round(place.distance / 10) * 10} m` : `${(place.distance / 1000).toFixed(1)} km`}</p></div>
      <button className={`heart${favorite ? ' hearted' : ''}`} aria-label={favorite ? 'Remove favorite' : 'Add favorite'} onClick={event => { event.stopPropagation(); onFavorite(); }}>♥</button></div>
      <div className="place-card-foot"><span>{hours?.text || 'Nearby food spot'}</span><button className="card-open" type="button" aria-label={`View ${place.name}`} onClick={() => setDetails(true)}>View place <ArrowLeft size={14}/></button></div>
    </article>
    {details && createPortal(<div ref={node=>node?.toggleAttribute("inert", visitFinishing)} className="place-detail-backdrop" role="presentation"><section className={`place-detail${detailsExpanded ? ' expanded' : ''}${visitMode ? ' visit-mode' : ''}${visitIntro ? ' visit-intro-active' : ''}${visitFlightActive ? ' visit-flight-active' : ''}`} role="dialog" aria-modal="true" aria-label={visitMode ? `Visit ${place.name}` : `${place.name} details`}>
      <button className="place-detail-handle" type="button" aria-label={detailsExpanded ? 'Collapse details' : 'Expand details'} aria-expanded={detailsExpanded} onClick={() => { if (suppressHandleClick.current) { suppressHandleClick.current = false; return; } setDetailsExpanded(value => !value); }} onPointerDown={event => { dragStartY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (dragStartY.current === null) return; const delta = event.clientY - dragStartY.current; dragStartY.current = null; if (Math.abs(delta) > 28) { suppressHandleClick.current = true; setDetailsExpanded(delta < 0); } }} onPointerCancel={() => { dragStartY.current = null; }}><span /></button>
      <button className="place-detail-close" onClick={closeDetails} aria-label="Close details"><X size={20}/></button>
      {visitMode ? <div className={`visit-journey${visitStage === 'outro' ? ' visit-outro' : ''}`} aria-label={visitStage === 'outro' ? `Visit feedback for ${place.name}` : `Starting a visit to ${place.name}`}>
        {visitStage === 'journey' ? <>
          <div className="visit-route" aria-hidden="true"><span className="visit-route-line"/><MapPin className="visit-route-pin" size={22}/><span className="visit-character" ref={visitCharacterRef}><img className="visit-character-frame visit-character-frame-a" src={visitWalkFrameASrc} alt="" draggable={false}/></span></div>
          <div className="visit-journey-copy"><span className="eyebrow">A LITTLE ADVENTURE</span><strong>On our way to {place.name}</strong><span>Good food is just around the corner.</span></div>
        </> : <>
          <img className="visit-outro-mascot" ref={visitOutroMascotRef} src={visitJumpSrc} alt="" aria-hidden="true"/>
          <div className="visit-journey-copy"><span className="eyebrow">YOU MADE IT</span><strong>How was {place.name}?</strong><span>Your visit is complete after your quick rating.</span></div>
        </>}
      </div> : <RestaurantPhoto name={place.name} photo={place.photo} cuisine={cuisine[0]} large />}
      <div className="place-detail-content">
        {visitMode ? <>
          {visitStage === 'journey' ? <>
            <button className="back visit-details-back" onClick={() => setVisitMode(false)}><ArrowLeft size={17}/>Place details</button>
            <div className="visit-title"><div><span className="eyebrow">YOUR NEXT STOP</span><h2>{place.name}</h2><p>{cuisine.join(' · ')} · {place.distance < 1000 ? `${Math.round(place.distance / 10) * 10} m away` : `${(place.distance / 1000).toFixed(1)} km away`}</p></div><Sparkles size={23}/></div>
            <div className="visit-map"><iframe title={`Map showing ${place.name}`} src={mapUrl.toString()} loading="lazy" referrerPolicy="no-referrer"/><a href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=16/${place.lat}/${place.lon}`} target="_blank" rel="noopener noreferrer">Open map</a></div>
            <button className="button directions visit-directions" onClick={onDirections}><Navigation size={17}/>Directions to {place.name}<span>↗</span></button>
          </> : <>
            {visitFeedbackStep === 'sentiment' ? <div className="visit-feedback" aria-live="polite">
              <span className="eyebrow">QUESTION 1 OF 2</span><h3>Did you like it?</h3><div className="visit-feedback-actions">
                <button className={`button outline${sentiment === 'loved' ? ' selected' : ''}`} aria-pressed={sentiment === 'loved'} onClick={() => { onSentiment('loved'); setVisitFeedbackStep('recommendation'); }}><Heart size={17}/>Loved it</button>
                <button className={`button outline${sentiment === 'okay' ? ' selected' : ''}`} aria-pressed={sentiment === 'okay'} onClick={() => { onSentiment('okay'); setVisitFeedbackStep('recommendation'); }}>It was okay</button>
                <button className={`button outline${sentiment === 'disliked' ? ' selected' : ''}`} aria-pressed={sentiment === 'disliked'} onClick={() => { onSentiment('disliked'); setVisitFeedbackStep('recommendation'); }}>Not for me</button>
              </div></div> : <div className="visit-feedback" aria-live="polite">
              <span className="eyebrow">QUESTION 2 OF 2</span><h3>Would you recommend this place?</h3><div className="visit-feedback-actions">
                <button className={`button outline${recommendationVote === 'yes' ? ' selected' : ''}`} aria-pressed={recommendationVote === 'yes'} onClick={() => onRecommendation('yes')}>Yes</button>
                <button className={`button outline${recommendationVote === 'maybe' ? ' selected' : ''}`} aria-pressed={recommendationVote === 'maybe'} onClick={() => onRecommendation('maybe')}>Maybe</button>
                <button className={`button outline${recommendationVote === 'no' ? ' selected' : ''}`} aria-pressed={recommendationVote === 'no'} onClick={() => onRecommendation('no')}>No</button>
              </div><button className="text-button visit-change-rating" onClick={() => setVisitFeedbackStep('sentiment')}>Change your rating</button></div>}
            <p className="visit-feedback-hint" aria-live="polite">{visitSaveError || (feedbackComplete ? 'Your answers are ready. Complete your visit to save it and open the Map.' : 'Choose an answer to each question to complete your visit.')}</p>
          </>}
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
        <button className="button visit-start" onClick={startVisit}><Sparkles size={17}/>{status === 'visited' ? 'Finish your visit' : status === 'target' ? 'Continue your visit' : 'Start a visit'}<span>→</span></button>
        </>}
      </div>
      <div className="place-detail-bottom-bar">{visitMode ? visitStage === 'journey' ? <button className="button visit-arrived" onClick={() => { setVisitFeedbackStep(sentiment && ['loved', 'okay', 'disliked'].includes(sentiment) ? 'recommendation' : 'sentiment'); setVisitSaveError(''); setVisitStage('outro'); }}><Check size={18}/>I’m here — mark as visited</button> : <button className="button visit-done" disabled={!feedbackComplete || visitFinishing} onClick={() => void finishVisit()}><Check size={18}/>{visitFinishing ? 'Heading to the Map…' : feedbackComplete ? 'Complete visit · open Map' : 'Answer both questions to finish'}</button> : <button className="place-detail-bottom-back" onClick={closeDetails}><ArrowLeft size={17}/>Back to places</button>}</div>
    </section></div>, document.body)}
  </>;
}
