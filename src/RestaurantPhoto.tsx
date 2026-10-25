import { useState } from 'react';
import type { PlacePhoto } from './core';

export default function RestaurantPhoto({ name, photo }: { name: string; photo?: PlacePhoto }) {
  const [available, setAvailable] = useState(true);
  if (!photo || !available) return null;
  let imageUrl: string;
  let sourceUrl: string;
  let licenseUrl: string;
  try {
    imageUrl = new URL(photo.url).toString();
    sourceUrl = new URL(photo.sourceUrl).toString();
    licenseUrl = new URL(photo.licenseUrl).toString();
  } catch {
    return null;
  }
  if (![imageUrl, sourceUrl, licenseUrl].every(url => url.startsWith('https://'))) return null;

  return <figure className="restaurant-photo">
    <img src={imageUrl} alt={`${name} — photo from Wikimedia Commons`} loading="lazy" referrerPolicy="no-referrer" onError={() => setAvailable(false)} />
    <figcaption>
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{photo.attribution}</a>
      {' · '}
      <a href={licenseUrl} target="_blank" rel="noopener noreferrer">{photo.license}</a>
    </figcaption>
  </figure>;
}
