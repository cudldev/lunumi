import { useState } from 'react';
import type { PlacePhoto } from './core';
import FoodIllustration from './FoodIllustration';

export default function RestaurantPhoto({ name, photo, cuisine = 'food', large = false }: { name: string; photo?: PlacePhoto; cuisine?: string; large?: boolean }) {
  const [available, setAvailable] = useState(true);
  if (!photo || !available) return <div className={`restaurant-photo restaurant-photo-fallback${large ? ' restaurant-photo-large' : ''}`} aria-label={`${cuisine} illustration`}><FoodIllustration cuisine={cuisine}/><span>{cuisine}</span></div>;
  let imageUrl: string;
  let sourceUrl: string;
  let licenseUrl: string;
  try {
    imageUrl = new URL(photo.url).toString();
    sourceUrl = new URL(photo.sourceUrl).toString();
    licenseUrl = new URL(photo.licenseUrl).toString();
  } catch {
    return <div className={`restaurant-photo restaurant-photo-fallback${large ? ' restaurant-photo-large' : ''}`}><FoodIllustration cuisine={cuisine}/><span>{cuisine}</span></div>;
  }
  if (![imageUrl, sourceUrl, licenseUrl].every(url => url.startsWith('https://'))) return <div className={`restaurant-photo restaurant-photo-fallback${large ? ' restaurant-photo-large' : ''}`}><FoodIllustration cuisine={cuisine}/><span>{cuisine}</span></div>;

  return <figure className={`restaurant-photo${large ? ' restaurant-photo-large' : ''}`}>
    <img src={imageUrl} alt={`${name} — photo from Wikimedia Commons`} loading="lazy" referrerPolicy="no-referrer" onError={() => setAvailable(false)} />
    <figcaption>
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{photo.attribution}</a>
      {' · '}
      <a href={licenseUrl} target="_blank" rel="noopener noreferrer">{photo.license}</a>
    </figcaption>
  </figure>;
}
