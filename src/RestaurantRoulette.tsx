import { useEffect, useRef, useState } from 'react';
import { ArrowRight, MapPin, RotateCw, Sparkles, X } from 'lucide-react';
import type { Place } from './core';

type Props = {
  place: Place;
  spinning: boolean;
  onSpinAgain: () => void;
  onChoose: () => void;
  onClose: () => void;
};

export default function RestaurantRoulette({ place, spinning, onSpinAgain, onChoose, onClose }: Props) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', closeOnEscape); };
  }, []);

  const cuisine = (place.tags.cuisine || place.tags.amenity?.replace('_', ' ') || 'A nearby food spot')
    .split(';').map(value => value.trim()).filter(Boolean).slice(0, 2).join(' · ');
  const distance = place.distance < 1000 ? `${Math.round(place.distance / 10) * 10} m away` : `${(place.distance / 1000).toFixed(1)} km away`;

  return <div className="roulette-backdrop" role="presentation">
    <section className="restaurant-roulette" role="dialog" aria-modal="true" aria-labelledby="roulette-title" aria-describedby="roulette-status">
      <button className="roulette-close" type="button" onClick={onClose} aria-label="Close roulette"><X size={20}/></button>
      <span className="eyebrow">A LITTLE LUNUMI LUCK</span>
      <h2 id="roulette-title">{spinning ? 'Let’s see where we land…' : 'Your next little adventure'}</h2>
      <div key={spinning ? place.id : 'revealed'} className={`roulette-stage${spinning && !reducedMotion ? ' is-spinning' : ''}${!spinning ? ' is-revealed' : ''}`} aria-hidden="true">
        <div className="roulette-wheel"><span>✦</span><span>✿</span><span>✦</span><span>✿</span><span>✦</span><span>✿</span></div>
        <img className="roulette-mascot" src={new URL('mascot/lunumi-lunch-pose.png', document.baseURI).href} alt=""/>
        {!spinning && <Sparkles className="roulette-sparkle" size={28}/>}
      </div>
      {spinning ? <p id="roulette-status" className="roulette-status" role="status" aria-live="polite">Lunumi is choosing from your nearby places…</p> : <>
        <div className="roulette-winner" id="roulette-status" aria-live="polite">
          <span className="eyebrow">TODAY’S PICK</span>
          <h3>{place.name}</h3>
          <p>{cuisine} <span>·</span> <MapPin size={14}/> {distance}</p>
        </div>
        <div className="roulette-actions">
          <button className="button roulette-choose" type="button" onClick={onChoose}>Go with this <ArrowRight size={17}/></button>
          <button className="button outline roulette-again" type="button" onClick={onSpinAgain}><RotateCw size={16}/>Spin again</button>
        </div>
      </>}
    </section>
  </div>;
}
