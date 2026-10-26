import { useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';

type MenuItem = { name: string; details: string; diets: string[] };
type CachedMenu = { sourceUrl: string; cachedAt: string; items: MenuItem[] };
const MENU_CACHE_KEY = 'lunumi:menu-cache:v1';
const MENU_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MENU_CACHE_MAX_ENTRIES = 20;

const dietSignals: Array<[RegExp, string]> = [
  [/\bvegan\b/i, 'Marked vegan'],
  [/\bvegetarian\b/i, 'Marked vegetarian'],
  [/\bgluten[- ]free\b/i, 'Marked gluten-free'],
  [/\bdairy[- ]free\b/i, 'Marked dairy-free'],
  [/\bhalal\b/i, 'Marked halal'],
  [/\bketo(?:genic)?\b/i, 'Marked keto'],
];

function cleanMenuText(value: string): string {
  if (!value.includes('<')) return value;
  const document = new DOMParser().parseFromString(value, 'text/html');
  document.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach(node => node.remove());
  return document.body.innerText || document.body.textContent || '';
}

function parseMenu(value: string): MenuItem[] {
  const lines = cleanMenuText(value).split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found: MenuItem[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.length < 3 || line.length > 220 || /^https?:\/\//i.test(line)) continue;
    const price = line.match(/(?:^|\s)(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)/);
    const parts = line.split(/\s+[·|—–]\s+|\s{2,}/);
    const name = (parts[0] || line).replace(/\s+(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?.*$/, '').trim();
    if (name.length < 3 || name.length > 90 || /^(menu|food|drinks|desserts?|starters?|mains?|lunch|dinner|allergens?)$/i.test(name)) continue;
    if (/^(all prices|please inform|we cannot|may contain|allergen information)/i.test(name)) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const diets = dietSignals.filter(([pattern]) => pattern.test(line)).map(([, label]) => label);
    const details = [parts.slice(1).join(' · '), price?.[0]?.trim()].filter(Boolean).join(' · ');
    found.push({ name, details, diets });
    if (found.length >= 100) break;
  }
  return found;
}

function validCachedMenu(value: unknown): value is CachedMenu {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CachedMenu>;
  return typeof entry.sourceUrl === 'string' && entry.sourceUrl.length <= 2048
    && typeof entry.cachedAt === 'string' && Number.isFinite(Date.parse(entry.cachedAt))
    && Array.isArray(entry.items) && entry.items.length <= 100
    && entry.items.every(item => Boolean(item) && typeof item.name === 'string' && item.name.length <= 90
      && typeof item.details === 'string' && item.details.length <= 240
      && Array.isArray(item.diets) && item.diets.every(diet => typeof diet === 'string' && diet.length <= 40));
}

function readCachedMenu(sourceUrl: string): CachedMenu | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || '[]');
    if (!Array.isArray(parsed)) return null;
    const entry = parsed.find((candidate): candidate is CachedMenu => validCachedMenu(candidate) && candidate.sourceUrl === sourceUrl);
    if (!entry) return null;
    const age = Date.now() - Date.parse(entry.cachedAt);
    return age >= 0 && age < MENU_CACHE_TTL_MS ? entry : null;
  } catch {
    return null;
  }
}

function writeCachedMenu(sourceUrl: string, items: MenuItem[]): string | null {
  const cachedAt = new Date().toISOString();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || '[]');
    const now = Date.now();
    const recent = Array.isArray(parsed) ? parsed.filter((candidate): candidate is CachedMenu => {
      if (!validCachedMenu(candidate)) return false;
      const age = now - Date.parse(candidate.cachedAt);
      return age >= 0 && age < MENU_CACHE_TTL_MS && candidate.sourceUrl !== sourceUrl;
    }) : [];
    const next: CachedMenu[] = [{ sourceUrl, cachedAt, items }, ...recent].slice(0, MENU_CACHE_MAX_ENTRIES);
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(next));
    return cachedAt;
  } catch {
    return null;
  }
}

type Props = { restaurantName: string; sourceUrl?: string | null };
const menuReaderUrl = import.meta.env.VITE_MENU_READER_URL?.trim();

export default function MenuAssistant({ restaurantName, sourceUrl }: Props) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [busy, setBusy] = useState(Boolean(sourceUrl));
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timeout: number | undefined;
    let timedOut = false;
    setItems([]);
    setError('');
    setCachedAt(null);
    if (!sourceUrl) {
      setBusy(false);
      setError('No menu source is listed for this restaurant.');
      return () => controller.abort();
    }

    const cached = readCachedMenu(sourceUrl);
    if (cached) {
      setItems(cached.items);
      setCachedAt(cached.cachedAt);
      setBusy(false);
      return () => controller.abort();
    }
    setBusy(true);

    async function loadMenu() {
      try {
        if (!menuReaderUrl) throw new Error('Menu reading is not connected for this deployment yet.');
        timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
        const response = await fetch(menuReaderUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: sourceUrl }),
          signal: controller.signal,
          credentials: 'omit',
        });
        const result = await response.json() as { text?: string; contentType?: string; error?: string };
        if (!response.ok) throw new Error(result.error || `The menu could not be fetched (${response.status}).`);
        const contentType = result.contentType || '';
        if (/application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(sourceUrl)) {
          throw new Error('This menu is a PDF and cannot be read automatically yet.');
        }
        if (!/text\/|json|xml|html/i.test(contentType) && contentType) {
          throw new Error('This menu format cannot be read automatically yet.');
        }
        const body = (result.text || '').slice(0, 500_000);
        const extracted = parseMenu(body);
        if (!extracted.length) throw new Error('No readable menu items were found on the restaurant page.');
        if (!controller.signal.aborted) {
          setItems(extracted);
          setCachedAt(writeCachedMenu(sourceUrl, extracted));
        }
      } catch (cause) {
        if (timedOut) {
          setError('The menu service took too long to respond.');
        } else if (!controller.signal.aborted) {
          const message = cause instanceof Error ? cause.message : 'The menu could not be read.';
          setError(/failed to fetch|networkerror|load failed/i.test(message) ? 'Lunumi could not reach its menu service.' : message);
        }
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
        if (!controller.signal.aborted || timedOut) setBusy(false);
      }
    }

    void loadMenu();
    return () => {
      controller.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [sourceUrl]);

  return <section className="menu-assistant" aria-label={`Local menu assistant for ${restaurantName}`}>
    <div className="menu-assistant-heading"><div><strong>Menu</strong><span>{busy ? <><LoaderCircle size={13} className="menu-assistant-spinner"/> Loading items…</> : items.length ? `${items.length} items${cachedAt ? ' · saved on this device' : ''}` : 'Items from the restaurant’s own page'}</span></div></div>
    {items.length > 0 ? <>
      <ul className="menu-assistant-results" aria-live="polite">{items.map((item, index) => <li key={`${item.name}-${index}`}><div><strong>{item.name}</strong>{item.details && <span>{item.details}</span>}</div><div className="menu-assistant-diets">{item.diets.length ? item.diets.map(diet => <span key={diet}>{diet}</span>) : <span>Dietary details not stated</span>}</div></li>)}</ul>
      <p className="menu-assistant-note">Menu text is read and interpreted on this device. Missing ingredients and allergens are unknown; verify with the restaurant, especially for allergies.</p>
    </> : !busy && <div className="menu-assistant-empty" role="status"><strong>Menu not available</strong><span>{error || 'No menu items could be read from this restaurant page.'}</span></div>}
    {sourceUrl && <a className="menu-assistant-source" href={sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>View source and verify menu</a>}
  </section>;
}
