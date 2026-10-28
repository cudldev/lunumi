import type { Place } from './core';
import { detectLanguage, discoverMenuLinks, feedText, parseMenu, type MenuSource, type ParsedMenu } from './menu-data';

export function menuSources(place: Place): MenuSource[] {
  const fields = ['lunch:feed', 'menu:feed', 'menu:website', 'website:menu', 'lunch:website', 'website:lunch', 'menu', 'website', 'contact:website'];
  return fields.flatMap(key => {
    const value = place.tags[key]?.trim();
    if (!value) return [];
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
      return /^https?:$/.test(url.protocol) ? [{ url: url.href, label: key.includes('feed') ? 'Published menu feed' : 'Restaurant menu / website', discover: !key.includes('feed') }] : [];
    } catch { return []; }
  }).filter((source, index, all) => all.findIndex(other => other.url === source.url) === index);
}

export type Intent = { kind: 'menu' | 'items' | 'places' | 'help' | 'safety' | 'navigate'; term?: string; destination?: 'discover' | 'profile' | 'together' | 'map' };
export function understand(message: string): Intent {
  const text = message.toLowerCase().trim();
  if (/\b(allerg\w*|safe|safety|cross.contamination)\b/.test(text)) return { kind: 'safety' };
  if (/\b(profile|preferences|together|group|history|map|location)\b/.test(text) && /\b(open|show|go|change|edit|where)\b/.test(text)) {
    return { kind: 'navigate', destination: /profile|preferences/.test(text) ? 'profile' : /together|group/.test(text) ? 'together' : /history|map/.test(text) ? 'map' : 'discover' };
  }
  if (/\b(menu|menus|lunch|lounas|meny)\b/.test(text) && !/\b(items?|dishes|vegan|vegetarian|gluten|dairy|halal|contains?)\b/.test(text)) return { kind: 'menu' };
  if (/\b(items?|dishes|vegan|vegetarian|gluten|dairy|halal|contains?)\b/.test(text)) {
    return { kind: 'items', term: text.replace(/\b(please|can|you|show|me|find|list|all|the|menu|items?|dishes|with|containing|contains?|options?|any|are|there|on|it|at|from|for|what|about)\b/g, '').replace(/[?!.]/g, '').trim() };
  }
  if (/\b(help|hello|hi|hey)\b|what can you do/.test(text)) return { kind: 'help' };
  return { kind: 'places', term: text.replace(/\b(please|can|you|show|me|find|list|nearby|restaurants?|places?|for|a|an|the)\b/g, '').replace(/[?!.]/g, '').trim() };
}

export function matchingItems(menu: ParsedMenu, term = '') {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return menu.items.filter(item => words.every(word => /^(vegan|vegetarian|halal|gluten-free|dairy-free)$/.test(word)
    ? item.diets.some(diet => diet.toLowerCase() === `marked ${word}`)
    : `${item.name} ${item.description} ${item.section} ${item.diets.join(' ')}`.toLowerCase().includes(word)));
}

async function boundedText(response: Response, limit = 500_000): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < limit) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text.slice(0, limit);
  } finally { await reader.cancel(); }
}

export async function fetchMenuSource(url: string, signal: AbortSignal, readerUrl = import.meta.env.VITE_MENU_READER_URL): Promise<{ text: string; type: string; url: string }> {
  if (readerUrl?.trim()) {
    const endpoint = new URL(readerUrl.trim());
    if (endpoint.protocol !== 'https:' || !endpoint.pathname.endsWith('/v1/menu')) throw new Error('Menu reader configuration is invalid.');
    const response = await fetch(endpoint.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Menu reader could not fetch this source.');
    const payload: unknown = JSON.parse(await boundedText(response, 1_100_000));
    if (!payload || typeof payload !== 'object') throw new Error('Invalid menu-reader response.');
    const data = payload as Record<string, unknown>;
    if (typeof data.text !== 'string' || typeof data.contentType !== 'string' || typeof data.sourceUrl !== 'string' || !/^https:\/\//.test(data.sourceUrl)) throw new Error('Invalid menu-reader response.');
    return { text: data.text.slice(0, 500_000), type: data.contentType, url: data.sourceUrl };
  }
  const response = await fetch(url, { signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Menu source is unavailable.'); }
  const type = response.headers.get('content-type') || '';
  if (/application\/pdf|image\//i.test(type)) { await response.body?.cancel(); throw new Error('Open this PDF or image menu directly.'); }
  return { text: await boundedText(response), type, url: response.url || url };
}

export async function readRestaurantMenu(place: Place, signal: AbortSignal): Promise<ParsedMenu & { source: MenuSource }> {
  const queue = menuSources(place), tried = new Set<string>();
  while (queue.length && tried.size < 5) {
    signal.throwIfAborted();
    const source = queue.shift()!;
    if (tried.has(source.url)) continue;
    tried.add(source.url);
    try {
      const fetched = await fetchMenuSource(source.url, signal);
      const type = fetched.type, body = fetched.text, finalUrl = fetched.url;
      if (/application\/pdf|image\//i.test(type) || /\.pdf(?:$|[?#])/i.test(finalUrl)) continue;
      const discovered = source.discover ? discoverMenuLinks(body, finalUrl).filter(url => !tried.has(url)) : [];
      if (discovered.length) {
        queue.unshift(...discovered.map(url => ({ url, label: 'Discovered menu page' })));
        continue;
      }
      const text = feedText(body, type), parsed = parseMenu(text, detectLanguage(text));
      const menuEvidence = /(?:€|\$|£)|\b(menu|lunch|lounas|ruokalista|meny|starters|mains|burgers|salads|pääruoat|salaatit)\b/i.test(text);
      if (parsed.items.length && (menuEvidence || !source.discover)) return { ...parsed, source: { ...source, url: finalUrl } };
    } catch { signal.throwIfAborted(); }
  }
  throw new Error('I couldn’t read a menu from this restaurant. Its site may block browser access or use a PDF, image, or JavaScript menu. Try the source links.');
}
