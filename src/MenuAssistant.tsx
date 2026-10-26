import { useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { classifyMenuLine, loadMenuClassifier, type MenuClassifier } from './menu-classifier';

type MenuItem = { section: string; name: string; description: string; price: string; diets: string[]; allergenInfo: string[]; sourceText: string };
type ParsedMenu = { items: MenuItem[]; notes: string[] };
type MenuLanguage = 'fi' | 'sv' | 'en' | 'unknown';
type CachedMenu = { sourceUrl: string; resolvedSourceUrl?: string; cachedAt: string; items: MenuItem[]; notes: string[]; language?: MenuLanguage };
const MENU_CACHE_KEY = 'lunumi:menu-cache:v3';
const MENU_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MENU_CACHE_MAX_ENTRIES = 20;

type LanguageModule = { name: string; clues: RegExp[]; dietSignals: Array<[RegExp, string]>; headings: RegExp };
const languageModules: Record<Exclude<MenuLanguage, 'unknown'>, LanguageModule> = {
  fi: {
    name: 'Finnish',
    clues: [/\blounas\b/i, /\bmaanantai|tiistai|keskiviikko|torstai|perjantai\b/i, /\bkeitto|salaatti|kasvisruoka|gluteeniton\b/i],
    dietSignals: [[/\bvegaan\w*\b/i, 'Marked vegan'], [/\bkasvisruoka\b/i, 'Marked vegetarian'], [/\bgluteeniton\b/i, 'Marked gluten-free'], [/\bmaidoton\b/i, 'Marked dairy-free'], [/\blaktoositon\b/i, 'Marked lactose-free'], [/\bhalal\b/i, 'Marked halal'], [/\bketo(?:geeninen)?\b/i, 'Marked keto']],
    headings: /^(?:lounas|ruokalista|ruokalistat|jälkiruoat?|juomat|allergeenit|maanantai|tiistai|keskiviikko|torstai|perjantai)$/i,
  },
  sv: {
    name: 'Swedish',
    clues: [/\bdagens\b/i, /\bmåndag|tisdag|onsdag|torsdag|fredag\b/i, /\bsallad|soppa|kyckling|glutenfri\b/i],
    dietSignals: [[/\bvegansk\w*\b/i, 'Marked vegan'], [/\bvegetarisk\w*\b/i, 'Marked vegetarian'], [/\bglutenfri\w*\b/i, 'Marked gluten-free'], [/\bmejerifri\w*\b/i, 'Marked dairy-free'], [/\blaktosfri\w*\b/i, 'Marked lactose-free'], [/\bhalal\b/i, 'Marked halal'], [/\bketo(?:genisk)?\b/i, 'Marked keto']],
    headings: /^(?:lunch|meny|dagens|förrätter|huvudrätter|efterrätter|drycker|allergener|måndag|tisdag|onsdag|torsdag|fredag)$/i,
  },
  en: {
    name: 'English',
    clues: [/\bmonday|tuesday|wednesday|thursday|friday\b/i, /\blunch|menu|allergens\b/i, /\bsalad|soup|chicken|gluten[- ]free\b/i],
    dietSignals: [[/\bvegan\b/i, 'Marked vegan'], [/\bvegetarian\b/i, 'Marked vegetarian'], [/\bgluten[- ]free\b/i, 'Marked gluten-free'], [/\bdairy[- ]free\b/i, 'Marked dairy-free'], [/\blactose[- ]free\b/i, 'Marked lactose-free'], [/\bhalal\b/i, 'Marked halal'], [/\bketo(?:genic)?\b/i, 'Marked keto']],
    headings: /^(?:menu|food|drinks|desserts?|starters?|mains?|lunch|dinner|allergens?|monday|tuesday|wednesday|thursday|friday)$/i,
  },
};

const sectionHeadings: Record<Exclude<MenuLanguage, 'unknown'>, RegExp> = {
  fi: /^(?:alkuruoat|pääruoat|jälkiruoat?|juomat|hampurilaiset|kasvistuotteet|salaatit|keitot|lisukkeet|lounas|päivän lounas|maanantai|tiistai|keskiviikko|torstai|perjantai)$/i,
  sv: /^(?:förrätter|huvudrätter|efterrätter|drycker|burgare|sallader|soppor|tillbehör|dagens|måndag|tisdag|onsdag|torsdag|fredag)$/i,
  en: /^(?:starters?|appetizers?|mains?|main courses|burgers?|sandwiches|salads?|soups?|sides|desserts?|drinks|lunch|dinner|specials?|monday|tuesday|wednesday|thursday|friday)$/i,
};

const allergenNotices: Record<Exclude<MenuLanguage, 'unknown'>, RegExp> = {
  fi: /^(?:allerg(?:ia|iat|eenit|eeneja)\b|sisältää\b|saattaa sisältää\b)/i,
  sv: /^(?:allerg(?:i|ener)\b|innehåller\b|kan innehålla\b)/i,
  en: /^(?:allerg(?:en|ens)\b|contains\b|may contain\b)/i,
};

function detectLanguage(value: string): MenuLanguage {
  const sample = value.slice(0, 20_000);
  const scores = (Object.entries(languageModules) as Array<[Exclude<MenuLanguage, 'unknown'>, LanguageModule]>)
    .map(([language, module]) => ({ language, score: module.clues.reduce((sum, clue) => sum + Number(clue.test(sample)), 0) }))
    .sort((a, b) => b.score - a.score);
  return scores[0]?.score && scores[0].score > (scores[1]?.score || 0) ? scores[0].language : 'unknown';
}

function cleanMenuText(value: string): string {
  if (!value.includes('<')) return value;
  const document = new DOMParser().parseFromString(value, 'text/html');
  document.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach(node => node.remove());
  return document.body.innerText || document.body.textContent || '';
}

function feedText(value: string, contentType: string): string {
  if (/json/i.test(contentType) || /^\s*[\[{]/.test(value)) {
    try {
      const data = JSON.parse(value) as { items?: unknown[]; [key: string]: unknown };
      const entries = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
      return entries.map(item => {
        if (!item || typeof item !== 'object') return '';
        const fields = item as Record<string, unknown>;
        return ['title', 'name', 'description', 'summary', 'content_text', 'content_html', 'price']
          .map(key => fields[key]).filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
          .map(String).join(' · ');
      }).filter(Boolean).join('\n');
    } catch { /* try the HTML/text fallback */ }
  }
  if (/xml|rss|atom/i.test(contentType) || /<(?:rss|feed|channel|item|entry)\b/i.test(value)) {
    const document = new DOMParser().parseFromString(value, 'application/xml');
    const entries = [...document.querySelectorAll('item, entry')];
    if (entries.length) return entries.map(entry => ['title', 'description', 'summary', 'content', 'encoded', 'price']
      .map(tag => entry.getElementsByTagName(tag).item(0)?.textContent?.trim()).filter(Boolean).join(' · ')).join('\n');
  }
  return cleanMenuText(value);
}

async function readMenuResponse(response: Response): Promise<string> {
  const limit = 500_000;
  if (!response.body) return (await response.text()).slice(0, limit);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('This menu page is too large to read automatically.');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseMenu(value: string, language: MenuLanguage, classifier: MenuClassifier | null): ParsedMenu {
  const lines = cleanMenuText(value).split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found: MenuItem[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const modules = language === 'unknown' ? Object.values(languageModules) : [languageModules[language]];
  const activeLanguage = language === 'unknown' ? 'en' : language;
  const pricePattern = /(?:^|\s)(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)/;
  const isDietLine = (line: string) => modules.some(module => module.dietSignals.some(([pattern]) => pattern.test(line)));
  const isSection = (line: string) => sectionHeadings[activeLanguage].test(line) || modules.some(module => module.headings.test(line));
  const isAllergenNotice = (line: string) => (language === 'unknown' ? Object.values(allergenNotices) : [allergenNotices[language]]).some(pattern => pattern.test(line));
  let section = '';
  for (const line of lines) {
    if (line.length < 3 || line.length > 220 || /^https?:\/\//i.test(line)) continue;
    if (isSection(line)) { section = line; continue; }
    const hasAllergenInfo = isAllergenNotice(line);
    if (hasAllergenInfo && !pricePattern.test(line)) { if (notes.length < 30 && !notes.includes(line)) notes.push(line); continue; }
    const price = line.match(pricePattern);
    const parts = line.split(/\s+[·|—–]\s+|\s{2,}/);
    const name = (parts[0] || line).replace(/\s+(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?.*$/, '').trim();
    if (name.length < 3 || name.length > 90) continue;
    if (/^(all prices|please inform|we cannot|may contain|allergen information)/i.test(name)) continue;
    if (language === 'en' && classifier) {
      const prediction = classifyMenuLine(name, classifier);
      if (prediction?.label === 'other' && prediction.confidence >= 0.9) {
        const last = found[found.length - 1];
        const looksLikeDescription = last && last.section === section && line.length >= 35 && line.length <= 180 && !pricePattern.test(line) && !isDietLine(line) && /[.!,:;]/.test(line);
        if (looksLikeDescription) {
          last.description = [last.description, line].filter(Boolean).join(' ').slice(0, 240);
          last.sourceText = `${last.sourceText}\n${line}`.slice(0, 500);
        }
        continue;
      }
    }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const diets = [...new Set(modules.flatMap(module => module.dietSignals.filter(([pattern]) => pattern.test(line)).map(([, label]) => label)))];
    const priceText = price?.[0]?.trim().replace(/\s+/g, ' ') || '';
    const description = parts.slice(1).join(' · ').replace(pricePattern, '').trim();
    found.push({ section, name, description, price: priceText, diets, allergenInfo: hasAllergenInfo ? [line] : [], sourceText: line });
    if (found.length >= 100) break;
  }
  return { items: found, notes };
}

function validCachedMenu(value: unknown): value is CachedMenu {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CachedMenu>;
  return typeof entry.sourceUrl === 'string' && entry.sourceUrl.length <= 2048
    && (entry.resolvedSourceUrl === undefined || (typeof entry.resolvedSourceUrl === 'string' && entry.resolvedSourceUrl.length <= 2048))
    && typeof entry.cachedAt === 'string' && Number.isFinite(Date.parse(entry.cachedAt))
    && (entry.language === undefined || ['fi', 'sv', 'en', 'unknown'].includes(entry.language))
    && Array.isArray(entry.items) && entry.items.length <= 100
    && Array.isArray(entry.notes) && entry.notes.length <= 30 && entry.notes.every(note => typeof note === 'string' && note.length <= 220)
    && entry.items.every(item => Boolean(item) && typeof item.name === 'string' && item.name.length <= 90
      && typeof item.section === 'string' && item.section.length <= 80
      && typeof item.description === 'string' && item.description.length <= 240
      && typeof item.price === 'string' && item.price.length <= 30
      && typeof item.sourceText === 'string' && item.sourceText.length <= 500
      && Array.isArray(item.allergenInfo) && item.allergenInfo.length <= 10 && item.allergenInfo.every(note => typeof note === 'string' && note.length <= 220)
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

function writeCachedMenu(sourceUrl: string, resolvedSourceUrl: string, menu: ParsedMenu, language: MenuLanguage): string | null {
  const cachedAt = new Date().toISOString();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || '[]');
    const now = Date.now();
    const recent = Array.isArray(parsed) ? parsed.filter((candidate): candidate is CachedMenu => {
      if (!validCachedMenu(candidate)) return false;
      const age = now - Date.parse(candidate.cachedAt);
      return age >= 0 && age < MENU_CACHE_TTL_MS && candidate.sourceUrl !== sourceUrl;
    }) : [];
    const next: CachedMenu[] = [{ sourceUrl, resolvedSourceUrl, cachedAt, ...menu, language }, ...recent].slice(0, MENU_CACHE_MAX_ENTRIES);
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(next));
    return cachedAt;
  } catch {
    return null;
  }
}

type Props = { restaurantName: string; sourceUrl?: string | null };

export default function MenuAssistant({ restaurantName, sourceUrl }: Props) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(Boolean(sourceUrl));
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [language, setLanguage] = useState<MenuLanguage>('unknown');
  const [modelUsed, setModelUsed] = useState(false);
  const [verifiedSourceUrl, setVerifiedSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timeout: number | undefined;
    let timedOut = false;
    setItems([]);
    setNotes([]);
    setError('');
    setCachedAt(null);
    setLanguage('unknown');
    setModelUsed(false);
    setVerifiedSourceUrl(null);
    if (!sourceUrl) {
      setBusy(false);
      setError('No menu source is listed for this restaurant.');
      return () => controller.abort();
    }
    const menuUrl = sourceUrl;

    const cached = readCachedMenu(menuUrl);
    if (cached) {
      setItems(cached.items);
      setNotes(cached.notes);
      setCachedAt(cached.cachedAt);
      setLanguage(cached.language ?? 'unknown');
      setVerifiedSourceUrl(cached.resolvedSourceUrl ?? menuUrl);
      setBusy(false);
      return () => controller.abort();
    }
    setBusy(true);

    async function loadMenu() {
      try {
        const parsedUrl = new URL(menuUrl);
        if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
          throw new Error('Only public HTTPS menu pages can be read automatically.');
        }
        timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
        const response = await fetch(parsedUrl.href, {
          signal: controller.signal,
          credentials: 'omit',
        });
        if (!response.ok) throw new Error(`The menu page could not be fetched (${response.status}).`);
        const contentType = response.headers.get('content-type') || '';
        if (/application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(menuUrl)) {
          throw new Error('This menu is a PDF and cannot be read automatically yet.');
        }
        if (!/text\/|json|xml|html/i.test(contentType) && contentType) {
          throw new Error('This menu format cannot be read automatically yet.');
        }
        const body = await readMenuResponse(response);
        const readable = feedText(body, contentType);
        const detectedLanguage = detectLanguage(readable);
        let classifier: MenuClassifier | null = null;
        if (detectedLanguage === 'en') {
          try { classifier = await loadMenuClassifier(); } catch { /* keep rule-based extraction if model weights fail to load */ }
        }
        const extracted = parseMenu(readable, detectedLanguage, classifier);
        if (!extracted.items.length) throw new Error('No readable menu items were found on the restaurant page.');
        if (!controller.signal.aborted) {
          setItems(extracted.items);
          setNotes(extracted.notes);
          setLanguage(detectedLanguage);
          setModelUsed(Boolean(classifier));
          setVerifiedSourceUrl(response.url || menuUrl);
          setCachedAt(writeCachedMenu(menuUrl, response.url || menuUrl, extracted, detectedLanguage));
        }
      } catch (cause) {
        if (timedOut) {
          setError('The menu service took too long to respond.');
        } else if (!controller.signal.aborted) {
          const message = cause instanceof Error ? cause.message : 'The menu could not be read.';
          setError(/failed to fetch|networkerror|load failed/i.test(message)
            ? 'This restaurant page could not be read by the browser. It may block cross-site access (CORS); open the source to view the menu.'
            : message);
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
      {notes.length > 0 && <aside className="menu-assistant-menu-notes"><strong>Menu information</strong>{notes.map((note, index) => <p key={`${note}-${index}`}>{note}</p>)}</aside>}
      <ul className="menu-assistant-results" aria-live="polite">{items.map((item, index) => <li key={`${item.name}-${index}`}>
        <div>{item.section && <span className="menu-assistant-section">{item.section}</span>}<strong>{item.name}</strong>{item.description && <span>{item.description}</span>}{item.price && <span>{item.price}</span>}
          {item.allergenInfo.map((note, noteIndex) => <span className="menu-assistant-allergen" key={`${note}-${noteIndex}`}>{note}</span>)}
          <details className="menu-assistant-evidence"><summary>Source text</summary><span>{item.sourceText}</span></details>
        </div>
        <div className="menu-assistant-diets">{item.diets.length ? item.diets.map(diet => <span key={diet}>{diet}</span>) : <span>Dietary details not stated</span>}</div>
      </li>)}</ul>
      <p className="menu-assistant-note">Menu text is read and interpreted on this device. Missing ingredients and allergens are unknown; verify with the restaurant, especially for allergies.</p>
      {language !== 'unknown' && <p className="menu-assistant-note">Detected language: {languageModules[language].name}.</p>}
      {modelUsed && <p className="menu-assistant-note">English line filter uses a small local model trained from <a href="https://fdc.nal.usda.gov/download-datasets/" target="_blank" rel="noopener noreferrer">USDA FoodData Central public-domain data (CC0)</a>.</p>}
    </> : !busy && <div className="menu-assistant-empty" role="status"><strong>Menu not available</strong><span>{error || 'No menu items could be read from this restaurant page.'}</span></div>}
    {(verifiedSourceUrl || sourceUrl) && <a className="menu-assistant-source" href={verifiedSourceUrl || sourceUrl || undefined} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>View source and verify menu</a>}
  </section>;
}
