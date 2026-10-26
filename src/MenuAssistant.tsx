import { useMemo, useState } from 'react';
import { ExternalLink, LoaderCircle, Sparkles } from 'lucide-react';

type MenuItem = { name: string; details: string; diets: string[] };

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

type Props = { restaurantName: string; sourceUrl?: string | null };
const menuReaderUrl = import.meta.env.VITE_MENU_READER_URL?.trim();

export default function MenuAssistant({ restaurantName, sourceUrl }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const items = useMemo(() => parseMenu(text), [text]);

  async function readMenu() {
    if (!sourceUrl || busy) return;
    setBusy(true);
    setError('');
    setText('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      if (!menuReaderUrl) throw new Error('Menu reading is not connected for this deployment yet. Please open the restaurant source link.');
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
        throw new Error('This menu is a PDF. Open the source link to view it; automatic PDF reading is not available yet.');
      }
      if (!/text\/|json|xml|html/i.test(contentType) && contentType) {
        throw new Error('This menu format cannot be read automatically yet.');
      }
      const body = (result.text || '').slice(0, 500_000);
      const extracted = parseMenu(body);
      if (!extracted.length) throw new Error('The page loaded, but Lunumi could not identify menu entries on it.');
      setText(body);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The menu could not be read.';
      setError(controller.signal.aborted ? 'The menu service took too long to respond. Open the restaurant source link instead.' : /failed to fetch|networkerror|load failed/i.test(message) ? 'Lunumi could not reach its menu service. Open the source link to view the menu.' : message);
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  return <section className="menu-assistant" aria-label={`Local menu assistant for ${restaurantName}`}>
    <div className="menu-assistant-heading"><Sparkles size={17}/><div><strong>Menu helper</strong><span>Reads available menu text on this device</span></div></div>
    {sourceUrl ? <a className="menu-assistant-source" href={sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>Restaurant menu or website</a> : <p className="menu-assistant-note">No menu source link is listed for this restaurant yet.</p>}
    <button type="button" className="button menu-assistant-read" onClick={() => void readMenu()} disabled={!sourceUrl || busy}>{busy ? <><LoaderCircle size={16} className="menu-assistant-spinner"/>Reading menu…</> : <><Sparkles size={16}/>Read menu</>}</button>
    {error && <p className="menu-assistant-error" role="status">{error}{sourceUrl && <> <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open restaurant menu</a>.</>}</p>}
    {text && <div className="menu-assistant-results" aria-live="polite">
      <div className="menu-assistant-result-heading"><strong>{items.length} menu entries found</strong><button type="button" className="text-button" onClick={() => { setText(''); setError(''); }}>Clear</button></div>
      {items.length > 0 && <ul>{items.map((item, index) => <li key={`${item.name}-${index}`}><div><strong>{item.name}</strong>{item.details && <span>{item.details}</span>}</div><div className="menu-assistant-diets">{item.diets.length ? item.diets.map(diet => <span key={diet}>{diet}</span>) : <span>Dietary details not stated</span>}</div></li>)}</ul>}
      <p className="menu-assistant-note">Best-effort reading of the linked page. Missing ingredients and allergens are unknown; verify with the restaurant, especially for allergies.</p>
      {sourceUrl && <a className="menu-assistant-source" href={sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>Verify on the restaurant’s page</a>}
    </div>}
  </section>;
}
