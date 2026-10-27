import { useEffect, useState } from 'react';
import Dexie, { type Table } from 'dexie';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { classifyMenuLine, loadMenuClassifier, MENU_OTHER_FILTER_THRESHOLD, type MenuClassifier } from './menu-classifier';

type MenuItem = { section: string; name: string; description: string; price: string; diets: string[]; dietaryInfo?: string[]; allergenInfo: string[]; ingredients?: string[]; sourceText: string; imageUrl?: string };
type ParsedMenu = { items: MenuItem[]; notes: string[] };
type MenuLanguage = 'fi' | 'sv' | 'en' | 'unknown';
type CachedMenu = { sourceUrl: string; resolvedSourceUrl?: string; cachedAt: string; items: MenuItem[]; notes: string[]; language?: MenuLanguage; modelsUsed?: Array<Exclude<MenuLanguage, 'unknown'>> };
const MENU_CACHE_KEY = 'lunumi:menu-cache:v28';
const MENU_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MENU_CACHE_MAX_ENTRIES = 20;
const MENU_SOURCE_CACHE_STALE_MS = 7 * MENU_CACHE_TTL_MS;
const menuReaderUrl = import.meta.env.VITE_MENU_READER_URL?.trim();
type CachedMenuSource = { sourceUrl: string; resolvedSourceUrl: string; contentType: string; text: string; fetchedAt: number };
class MenuSourceCacheDatabase extends Dexie {
  sources!: Table<CachedMenuSource, string>;
  constructor() {
    super('lunumi-menu-source-cache');
    this.version(1).stores({ sources: 'sourceUrl,fetchedAt' });
  }
}
const menuSourceCache = new MenuSourceCacheDatabase();

type LanguageModule = { name: string; clues: RegExp[]; dietSignals: Array<[RegExp, string]>; headings: RegExp };
const languageModules: Record<Exclude<MenuLanguage, 'unknown'>, LanguageModule> = {
  fi: {
    name: 'Finnish',
    clues: [/\blounas\b/i, /\bmaanantai|tiistai|keskiviikko|torstai|perjantai\b/i, /\bkeitto|salaatti|kasvis\w*|gluteenittom\w*\b/i],
    dietSignals: [[/\bvegaan\w*\b/i, 'Marked vegan'], [/\bkasvisruok\w*\b/i, 'Marked vegetarian'], [/\bgluteeniton\b/i, 'Marked gluten-free'], [/\bmaidoton\b/i, 'Marked dairy-free'], [/\blaktoositon\b/i, 'Marked lactose-free'], [/\bhalal\b/i, 'Marked halal'], [/\bketo(?:geeninen)?\b/i, 'Marked keto']],
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
  fi: /^(?:alkuruoat|pääruoat?|pääruoaksi|pääruoan kaveriksi|jälkiruoat?|jälkiruoaksi|juomat|hampurilaiset|kasvistuotteet|salaatit|keitot|lisukkeet|lounas|päivän lounas|kampanjat|tortillat|ranskalaiset(?: & aterian lisukkeet)?|sormisyötävät|kastikkeet|pehmyt-jäätelöt|pirtelöt|maanantai|tiistai|keskiviikko|torstai|perjantai|ateriat|hampurilaisateriat|kanatuotteet|lastenateriat|lastenruoat|jälkiruoat ja juomat)$/i,
  sv: /^(?:förrätter|huvudrätter|efterrätter|drycker|burgare|sallader|soppor|tillbehör|dagens|måndag|tisdag|onsdag|torsdag|fredag)$/i,
  en: /^(?:starters?|appetizers?|mains?|main courses|burgers?|sandwiches|salads?|soups?|sides|desserts?|drinks|lunch|dinner|specials?|meals|kids'? meals|chicken|burgers? meals|monday|tuesday|wednesday|thursday|friday)$/i,
};

const allergenNotices: Record<Exclude<MenuLanguage, 'unknown'>, RegExp> = {
  fi: /^(?:\*?\s*(?:allerg(?:ia|iat|eenit|eeneja)\b|sisältää\b|saattaa sisältää\b)|.*(?:samassa öljyssä|emme takaa.*gluteenittomuutta)|.*henkilökuntamme auttaa.*allergeen)/i,
  sv: /^(?:allerg(?:i|ener)\b|innehåller\b|kan innehålla\b)/i,
  en: /^(?:allerg(?:en|ens)\b|contains\b|may contain\b)/i,
};

const standaloneDietLabels: Record<Exclude<MenuLanguage, 'unknown'>, RegExp> = {
  fi: /^(?:vegaaninen|vegaanista|kasvis|kasvisruoka|gluteeniton|maidoton|laktoositon|halal|keto(?:geeninen)?)$/i,
  sv: /^(?:vegansk|vegetarisk|glutenfri|mejerifri|laktosfri|halal|keto(?:genisk)?)$/i,
  en: /^(?:vegan|vegetarian|gluten[- ]free|dairy[- ]free|lactose[- ]free|halal|keto(?:genic)?)$/i,
};

const itemAllergenLines: Record<Exclude<MenuLanguage, 'unknown'>, RegExp> = {
  fi: /^(?:sisältää|saattaa sisältää|allergeenit?\s*[:\-])/i,
  sv: /^(?:innehåller|kan innehålla|allergener?\s*[:\-])/i,
  en: /^(?:contains|may contain|allergens?\s*[:\-])/i,
};

const ingredientLines: Record<Exclude<MenuLanguage, 'unknown'>, RegExp> = {
  fi: /^(?:ainesosat|ainesosa)\s*[:\-]\s*(.+)$/i,
  sv: /^(?:ingredienser|ingredienserna)\s*[:\-]\s*(.+)$/i,
  en: /^(?:ingredients?|made with)\s*[:\-]\s*(.+)$/i,
};

const dietaryCodeLine = /^(?:[A-ZÅÄÖ]{1,4}(?:\s*,\s*[A-ZÅÄÖ]{1,4}){1,8})$/i;
const nonMenuSectionHeading = /^(?:about(?: us| our restaurant)?|our story|our values|values|our locations|contact(?: us)?|opening hours|private events?\b.*|book(?: a table)?|gift cards?\b.*|shop|.*\b(?:arvot|values|värderingar|valeurs)\b.*|tasa-arvo|nautiskelu|avoimuus|vastuullisuus|tarinamme|yhteystiedot|aukioloajat|yksityistilais\w*\b.*|varaa pöytä|lahjakortit?\b.*|kauppaan|vår historia|våra värderingar|kontakt|öppettider|privata evenemang\b.*|boka bord|presentkort|notre histoire|nos valeurs|contactez-nous|horaires|événements privés\b.*|réserver une table|cartes cadeaux)$/i;
const nonMenuDetailLine = /^(?:ravintoarvot?\b|hiilijalanjälki\b|lue lisää ruokavaliomerkinnöistä\b|miltä maistui\b|huomioi, että raaka-aineet\b|ravintolapäällikkö\b|lounasbuffet\b|lounas\s*[–-]\s*viikko\s+\d+\b|(?:lounas\s+)?(?:maanantai|tiistai|keskiviikko|torstai|perjantai)\s+(?:ma|ti|ke|to|pe)\b|(?:ma|ti|ke|to|pe|la|su)\s*[–-]\s*(?:ma|ti|ke|to|pe|la|su)(?:\s+\d|$)|\d{1,2}\.\s*[–-]\s*\d{1,2}\.\d{1,2}\.\d{4}$|\d{1,2}[.,]\s*\d{1,2}[.,]\s*\d{4}\b|voimassa\s+\d{1,2}\.\s*\d{1,2}\.?\s*[–-]\s*\d{1,2}\.\s*\d{1,2}\.?$|(?:.*\b(?:ma|ti|ke|to|pe|la|su)\b.*)?\d{1,2}(?:[.:]\d{2})?\s*[-–]\s*\d{1,2}(?:[.:]\d{2})?.*\b(?:ma|ti|ke|to|pe|la|su)\b.*|(?:palvelemme osoitteessa|we are located at|our address\s*:|address\s*:|visit us at|vi finns på|vår adress\s*:)[^.!?]*|\d{5}\s+[\p{L}-]+|(?=.*\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|esplanadi|katu|tie|kuja|gata|väg)\b).*\s+\d{1,4}[a-z]?(?:\s*[,./-].*)?$|ei lounasta\s+(?:tälle|tana)\s+päivälle|mennyt lounas|voit liittää enintään\s+\d+\s+tiedostoa\b|kiitos palautteestasi!?$)/iu;

const nonMenuStatusLine = /^(?:voimassa\b|ei lounasta\s+(?:tälle|tana)\s+päivälle|mennyt lounas|voit liittää enintään\b|kiitos palautteestasi!?$)/i;

function languageClueScores(value: string): Array<{ language: Exclude<MenuLanguage, 'unknown'>; score: number }> {
  const sample = value.slice(0, 20_000);
  return (Object.entries(languageModules) as Array<[Exclude<MenuLanguage, 'unknown'>, LanguageModule]>)
    .map(([language, module]) => ({ language, score: module.clues.reduce((sum, clue) => sum + Number(clue.test(sample)), 0) }))
    .sort((a, b) => b.score - a.score);
}

function detectLanguage(value: string): MenuLanguage {
  const scores = languageClueScores(value);
  return scores[0]?.score && scores[0].score > (scores[1]?.score || 0) ? scores[0].language : 'unknown';
}

const MIXED_LANGUAGE_CLUE_THRESHOLD = 2;

function canLoadSecondaryMenuModels(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !connection?.saveData && connection?.effectiveType !== 'slow-2g' && connection?.effectiveType !== '2g';
}

type MenuClassifierOptions = {
  secondaryClassifiers?: MenuClassifier[];
  mixedLanguage?: boolean;
  missingSecondaryClassifier?: boolean;
};

function splitMenuNotice(value: string): string[] {
  const sentences = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(part => part.trim()).filter(Boolean) ?? [value];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    let chunk = '';
    for (const word of sentence.split(/\s+/)) {
      const next = chunk ? `${chunk} ${word}` : word;
      if (next.length > 220 && chunk) { chunks.push(chunk); chunk = word; }
      else chunk = next;
    }
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function safeMenuImage(value: string, sourceUrl?: string): string | undefined {
  try {
    const image = new URL(value, sourceUrl);
    const source = sourceUrl ? new URL(sourceUrl) : null;
    const sameSite = source && (image.hostname === source.hostname || image.hostname.endsWith(`.${source.hostname}`));
    const hesburgerCdn = source?.hostname.endsWith('hesburger.fi') && image.hostname === 'fi-www.hesburger.net';
    return image.protocol === 'https:' && !image.username && !image.password && !image.port && (sameSite || hesburgerCdn)
      ? image.href
      : undefined;
  } catch { return undefined; }
}

type StructuredMenuItem = { section?: string; name?: unknown; description?: unknown; image?: unknown; price?: unknown; suitableForDiet?: unknown; additionalProperty?: unknown; ingredients?: unknown };

export function schemaMenuLines(document: Document, sourceUrl?: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
  const dietLabels = (value: unknown): string[] => list(value).flatMap(entry => {
    const candidate = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? text((entry as Record<string, unknown>).name) || text((entry as Record<string, unknown>)['@id']) : '';
    const normalized = candidate.toLowerCase().replace(/[^a-z]/g, '');
    if (normalized.includes('vegandiet') || normalized === 'vegan') return ['Marked vegan'];
    if (normalized.includes('vegetariandiet') || normalized === 'vegetarian') return ['Marked vegetarian'];
    if (normalized.includes('glutenfreediet') || normalized === 'glutenfree') return ['Marked gluten-free'];
    if (normalized.includes('lowlactosediet') || normalized.includes('lactosefree')) return ['Marked lactose-free'];
    return [];
  });
  const emit = (entry: StructuredMenuItem, section: string) => {
    const sourceName = text(entry.name);
    if (!sourceName || sourceName.length > 160) return;
    const imageValue = list(entry.image).map(image => typeof image === 'string' ? image : image && typeof image === 'object' ? text((image as Record<string, unknown>).url) || text((image as Record<string, unknown>)['@id']) : '').find(Boolean) || '';
    const offers = list((entry as Record<string, unknown>).offers)[0];
    const offer = offers && typeof offers === 'object' ? offers as Record<string, unknown> : {};
    const rawPrice = text(entry.price) || text(offer.price) || text(offer.lowPrice);
    const currency = text(offer.priceCurrency);
    const embeddedPrice = sourceName.match(/\s*(?:[-–—|·:]\s*)?((?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£))\s*$/);
    const price = rawPrice && /^\d+(?:[.,]\d{1,2})?$/.test(rawPrice) && currency ? `${rawPrice} ${currency}` : rawPrice || embeddedPrice?.[1]?.trim().replace(/\s+/g, ' ') || '';
    const nameBeforeSeparator = embeddedPrice ? sourceName.slice(0, embeddedPrice.index).trim() : sourceName;
    const name = price ? nameBeforeSeparator.replace(/\s*[-–—|·:]\s*$/, '').trim() : nameBeforeSeparator;
    // Some restaurant JSON-LD marks allergen/dietary codes as MenuItems (for
    // example, `L. G. 4.8€`). Keep those as source text so parseMenu can attach
    // the code and price to the preceding dish instead of showing a fake item.
    if (/^(?:[A-ZÅÄÖ]\.\s*){1,8}$/i.test(name) && price) {
      result.push(`${name} ${price}`);
      return;
    }
    if (name.length < 3 || name.length > 120) return;
    const additional = list(entry.additionalProperty).flatMap(property => {
      if (!property || typeof property !== 'object') return [];
      const fields = property as Record<string, unknown>;
      const key = text(fields.name) || text(fields.propertyID);
      const value = text(fields.value);
      return /allergen|allerg/i.test(key) && value ? [value] : [];
    });
    const diets = dietLabels(entry.suitableForDiet);
    const ingredients = list(entry.ingredients).map(text).filter(Boolean).slice(0, 20);
    const item = {
      section,
      name,
      description: text(entry.description),
      price,
      imageUrl: safeMenuImage(text(entry.image) || imageValue, sourceUrl),
      diets,
      ingredients,
      allergenInfo: additional,
      sourceText: [sourceName, text(entry.description), rawPrice, list(entry.suitableForDiet).map(value => typeof value === 'string' ? value : value && typeof value === 'object' ? text((value as Record<string, unknown>).name) || text((value as Record<string, unknown>)['@id']) : '').filter(Boolean).join('; '), ...ingredients, ...additional].filter(Boolean).join(' · ').slice(0, 500),
    };
    const key = `${section}\n${name}`.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(`menu-schema-item: ${JSON.stringify(item)}`);
  };
  const walk = (value: unknown, section = '', inMenu = false, depth = 0): void => {
    if (depth > 12) return;
    if (Array.isArray(value)) { value.forEach(child => walk(child, section, inMenu, depth + 1)); return; }
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    const types = list(object['@type']).map(text).map(type => type.split('/').pop()?.toLowerCase() || '');
    const menu = inMenu || types.includes('menu');
    const nextSection = types.includes('menusection') ? text(object.name) || section : section;
    if (types.includes('menuitem') || (menu && types.includes('product'))) emit(object as StructuredMenuItem, nextSection);
    for (const [key, child] of Object.entries(object)) {
      if (key === 'hasMenuSection') list(child).forEach(item => walk(item, nextSection, true, depth + 1));
      else if (key === 'hasMenuItem') list(child).forEach(item => walk(item, nextSection, true, depth + 1));
      else if (key === '@graph' || key === 'mainEntity' || key === 'mainEntityOfPage') walk(child, nextSection, menu, depth + 1);
      else if (key !== 'hasMenuSection' && key !== 'hasMenuItem' && child && typeof child === 'object') walk(child, nextSection, menu, depth + 1);
    }
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(script.textContent || '')); } catch { /* Ignore malformed or unrelated JSON-LD blocks. */ }
  }
  return result;
}

export function tabbedMenuLines(document: Document): string[] {
  const panels = [...document.querySelectorAll<HTMLElement>('[id^="panel-"]')];
  const controls = [...document.querySelectorAll<HTMLElement>('[aria-controls]')];
  const controlledId = controls.find(control => control.getAttribute('aria-selected') === 'true'
    && panels.some(candidate => candidate.id === control.getAttribute('aria-controls')?.split(/\s+/)[0]))
    ?.getAttribute('aria-controls')?.split(/\s+/)[0];
  const panel = panels.find(candidate => candidate.id === controlledId)
    || panels.find(candidate => candidate.getAttribute('aria-hidden') === 'false')
    || panels.find(candidate => candidate.id === `panel-${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date())}`);
  if (!panel) return [];

  const sections = [...panel.querySelectorAll<HTMLElement>('li')]
    .filter(section => section.querySelector(':scope > .option-title') && section.querySelector(':scope > ul'));
  const items: string[] = [];
  for (const sectionNode of sections) {
    const section = sectionNode.querySelector(':scope > .option-title')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const list = sectionNode.querySelector(':scope > ul');
    if (!list) continue;
    for (const row of [...list.children]) {
      const button = row.querySelector('button.accordion__button, button[aria-expanded], button');
      const name = button?.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!name || name.length > 120) continue;

      const paragraphs = [...row.querySelectorAll('p')].map(node => node.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean);
      const textBlocks = [...row.querySelectorAll('p, span, div')].map(node => node.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean);
      const code = textBlocks.find(text => dietaryCodeLine.test(text)) || '';
      const ingredientsLine = paragraphs.find(text => /^ainesosat?\s*:?/i.test(text)) || '';
      const ingredients = ingredientsLine.replace(/^ainesosat?\s*:?\s*/i, '').trim();
      const allergenInfo = paragraphs.filter(text => /^allergeenit?\s*:?/i.test(text))
        .map(text => text.replace(/^allergeenit?\s*:?\s*/i, '').trim())
        .filter(Boolean).map(text => `Allergeenit: ${text}`);
      const item = {
        section,
        name,
        description: '',
        price: '',
        diets: [],
        dietaryInfo: code ? [code] : [],
        ingredients: ingredients ? [ingredients.slice(0, 240)] : [],
        allergenInfo,
        sourceText: [name, code, ingredientsLine, ...allergenInfo].filter(Boolean).join('\n').slice(0, 500),
      };
      items.push(`menu-schema-item: ${JSON.stringify(item)}`);
    }
  }
  return items;
}

export function accordionMenuLines(document: Document): string[] {
  const buttons = [...document.querySelectorAll<HTMLElement>('button[aria-expanded],button[id*="-button-"]')];
  const lines: string[] = [];
  for (const button of buttons) {
    const label = button.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!label || label.length > 100) continue;
    const generatedPanelId = button.id.match(/^(.*)-button-(\d+)$/)?.slice(1).join('-content-');
    const panelId = button.getAttribute('aria-controls') || generatedPanelId;
    const panel = (panelId && document.getElementById(panelId))
      || button.nextElementSibling as HTMLElement | null;
    if (!panel) continue;
    const readText = (node: Element) => node.textContent?.replace(/\s+/g, ' ').trim() || '';
    const semanticRows = [...panel.querySelectorAll('p,li,dt,dd,[itemprop="name"]')]
      .map(readText).filter(text => text.length > 2 && text.length <= 220);
    const directRows = [...panel.children].map(readText).filter(text => text.length > 2 && text.length <= 220);
    const text = panel.textContent?.replace(/\s+/g, ' ').trim() || '';
    const rows = semanticRows.length ? semanticRows : directRows.length ? directRows : text.length <= 220 ? [text] : [];
    const hasPrices = rows.some(row => /(?:\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)|(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?)/.test(row));
    const menuLabel = /^(?:maanantai|tiistai|keskiviikko|torstai|perjantai|måndag|tisdag|onsdag|torsdag|fredag|monday|tuesday|wednesday|thursday|friday|menu|meny|juomat|drinks|lounas|lunch|dinner|à la carte)\b/i.test(label);
    if (!rows.length || (!hasPrices && !menuLabel)) continue;
    lines.push(`menu-section: ${label}`, ...rows);
  }
  return lines;
}

export function cleanMenuText(value: string, sourceUrl?: string): string {
  if (!value.includes('<')) return value;
  const document = new DOMParser().parseFromString(value, 'text/html');
  const structuredItems = schemaMenuLines(document, sourceUrl);
  const tabbedItems = tabbedMenuLines(document);
  if (tabbedItems.length) return [...structuredItems, ...tabbedItems].join('\n');
  const accordionItems = accordionMenuLines(document);
  if (accordionItems.length) return [...structuredItems, ...accordionItems].join('\n');
  document.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach(node => node.remove());
  const productSections = [...document.querySelectorAll('.category')].map(category => {
    const heading = category.querySelector('h1,h2,h3,h4')?.textContent?.trim() || '';
    const products = [...category.querySelectorAll('a.product-item')].map(product => {
      const name = product.querySelector('.text,[itemprop="name"]')?.textContent?.trim()
        || product.getAttribute('aria-label')?.trim()
        || product.textContent?.replace(/\s+/g, ' ').trim()
        || '';
      const image = product.querySelector('img')?.getAttribute('src')
        || product.querySelector('img')?.getAttribute('data-src')
        || '';
      const imageUrl = safeMenuImage(image, sourceUrl);
      return [imageUrl ? `menu-image: ${imageUrl}` : '', name].filter(Boolean).join('\n');
    }).filter(Boolean);
    const notices = [...category.querySelectorAll('p')].map(note => note.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean);
    return [heading, ...products, ...notices].filter(Boolean).join('\n');
  }).filter(Boolean);
  if (productSections.length) return [...structuredItems, ...productSections].join('\n');

  // Many lunch sites put each daily menu in ordinary divs after a weekday heading.
  // Extract those groups before generic page text so navigation and form copy cannot
  // become menu items just because the URL contains "lounas".
  const contentRoot = document.querySelector('main,[role="main"],#primary,.site-main') || document.body;
  const dayHeading = (node: Element) => /^(?:maanantai|tiistai|keskiviikko|torstai|perjantai|måndag|tisdag|onsdag|torsdag|fredag|monday|tuesday|wednesday|thursday|friday)\s+\d{1,2}[./]\d{1,2}[./]\d{4}$/i
    .test((node.textContent || '').replace(/\s+/g, ' ').trim());
  const weekdayHeadings = [...contentRoot.querySelectorAll('h1,h2,h3,h4,h5')].filter(dayHeading);
  if (weekdayHeadings.length) {
    const sampleLanguage = detectLanguage(contentRoot.textContent || '');
    const weekdayLanguage = (node: Element): MenuLanguage => {
      const text = (node.textContent || '').trim().toLocaleLowerCase();
      if (/^(?:maanantai|tiistai|keskiviikko|torstai|perjantai)\b/.test(text)) return 'fi';
      if (/^(?:måndag|tisdag|onsdag|torsdag|fredag)\b/.test(text)) return 'sv';
      if (/^(?:monday|tuesday|wednesday|thursday|friday)\b/.test(text)) return 'en';
      return 'unknown';
    };
    const preferredLanguage = sampleLanguage === 'unknown' ? weekdayLanguage(weekdayHeadings[0]) : sampleLanguage;
    const selectedDays = preferredLanguage === 'unknown'
      ? weekdayHeadings
      : weekdayHeadings.filter(node => weekdayLanguage(node) === preferredLanguage);
    const dayLines: string[] = [];
    const legendLabels: Array<[RegExp, string]> = [
      [/laktoositon|lactose[- ]free/i, 'Marked lactose-free'],
      [/vähälaktoosinen|low[- ]lactose/i, 'Marked low-lactose'],
      [/gluteeniton|gluten[- ]free/i, 'Marked gluten-free'],
      [/vegaaninen|vegan/i, 'Marked vegan'],
      [/maidoton|dairy[- ]free/i, 'Marked dairy-free'],
      [/sis\.\s*valkosipulia|contains garlic/i, 'Marked contains garlic'],
    ];
    const contentLeaves = [...contentRoot.querySelectorAll('p,li,dt,dd,div,span')]
      .filter(node => node.children.length === 0)
      .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim());
    for (let index = 0; index < contentLeaves.length - 1; index++) {
      const code = contentLeaves[index].match(/^(?:VL|VE|VS|L|G|M)$/i)?.[0].toLocaleUpperCase();
      const label = contentLeaves[index + 1];
      if (code && legendLabels.some(([pattern]) => pattern.test(label))) dayLines.push(`menu-diet-legend: ${code}=${label}`);
    }
    for (const heading of selectedDays) {
      const day = (heading.textContent || '').replace(/\s+/g, ' ').trim();
      dayLines.push(`menu-section: ${day}`);
      let sibling = heading.nextElementSibling;
      while (sibling && !dayHeading(sibling)) {
        if (!/^H[1-6]$/.test(sibling.tagName)) {
          const readable = (node: Element) => (node.textContent || '').replace(/\s+/g, ' ').trim();
          const rowSelector = 'p,li,dt,dd,[itemprop="name"]';
          const semanticRows = [
            ...(sibling.matches(rowSelector) ? [sibling] : []),
            ...sibling.querySelectorAll(rowSelector),
          ]
            .filter(node => {
              const text = readable(node);
              return text.length > 2 && text.length <= 220 && !node.closest('a,button,form,[role="navigation"]');
            });
          const directRows = [...sibling.children]
            .filter(node => {
              const text = readable(node);
              return text.length > 2 && text.length <= 220 && !/^H[1-6]$/.test(node.tagName)
                && !node.closest('a,button,form,[role="navigation"]');
            });
          const leafBlocks = [...sibling.querySelectorAll('p,li,dt,dd,div,span')]
            .filter(node => node.children.length === 0 && !node.closest('a,button,form,[role="navigation"]'));
          const candidates = semanticRows.length ? semanticRows : directRows.length ? directRows : leafBlocks.length ? leafBlocks : [sibling];
          const readableLines = (node: Element): string[] => {
            const result: string[] = [];
            let line = '';
            const flush = () => {
              const text = line.replace(/\s+/g, ' ').trim();
              if (text) result.push(text);
              line = '';
            };
            const visit = (child: Node) => {
              if (child.nodeType === 3) { line += child.textContent || ''; return; }
              if (child.nodeType !== 1) return;
              const element = child as Element;
              if (/^(?:A|BUTTON|FORM|NAV|SCRIPT|STYLE|SVG)$/.test(element.tagName)) return;
              if (element.tagName === 'BR') { flush(); return; }
              for (const descendant of child.childNodes) visit(descendant);
            };
            for (const child of node.childNodes) visit(child);
            flush();
            return result.length ? result : [readable(node)];
          };
          for (const candidate of candidates) {
            for (const text of readableLines(candidate)) {
              if (text.length > 2 && text.length <= 220 && !dayLines.includes(text)) dayLines.push(text);
            }
          }
        }
        sibling = sibling.nextElementSibling;
      }
    }
    if (dayLines.some(line => !line.startsWith('menu-section:'))) {
      return [...structuredItems, ...dayLines].join('\n');
    }
  }

  // DOMParser creates a detached document where innerText can collapse the whole page.
  // Keep semantic content blocks on separate lines for the local item parser.
  const blockNodes = [...document.body.querySelectorAll('h1,h2,h3,h4,h5,p,li,dt,dd,[itemprop="name"],[itemprop="description"]')];
  const blockText = (node: Element) => node.textContent?.replace(/\s+/g, ' ').trim() || '';
  const menuTitleIndex = blockNodes.findIndex(node => /^H[1-3]$/.test(node.tagName)
    && /(?:^|\b)(?:menus?|lunch|lounas\w*|meny|ruokalista|tuotteet|a\s+la\s+carte)(?:\b|$)/i.test(blockText(node)));
  const firstSectionIndex = menuTitleIndex < 0 ? -1 : blockNodes.findIndex((node, index) => index > menuTitleIndex
    && /^H[1-3]$/.test(node.tagName));
  const sectionRegionHasMenuPrices = firstSectionIndex > menuTitleIndex
    && blockNodes.slice(menuTitleIndex + 1, firstSectionIndex).some(node => /(?:\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)|(?:€|\$|£)\s?\d+)/.test(blockText(node)));
  const compactPriceToken = /(?:\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)|(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?)/g;
  const blocks = blockNodes.flatMap((node, index) => {
    const text = blockText(node);
    if (text.length <= 1) return [];
    // Menu pages often put a table-of-contents list below the page title. Skip
    // those links/labels and keep the actual semantic section headings instead.
    if (index === menuTitleIndex || (firstSectionIndex > menuTitleIndex && !sectionRegionHasMenuPrices && index > menuTitleIndex && index < firstSectionIndex)) return [];
    if (/^H[1-2]$/.test(node.tagName)) return [`menu-section: ${text}`];
    if (menuTitleIndex >= 0 && index > menuTitleIndex && /^H[1-3]$/.test(node.tagName)) return [`menu-section: ${text}`];
    if (/^H[4-6]$/.test(node.tagName)) {
      const prices = [...text.matchAll(compactPriceToken)];
      if (prices.length >= 3) {
        const rows: string[] = [];
        let start = 0;
        for (const price of prices) {
          const end = (price.index ?? 0) + price[0].length;
          const row = text.slice(start, end).trim();
          if (row && row.replace(compactPriceToken, '').trim()) rows.push(row);
          start = end;
        }
        if (rows.length === prices.length) return rows;
      }
    }
    return [text];
  });
  return [...structuredItems, ...(blocks.length ? blocks : [document.body.textContent?.replace(/\s+/g, ' ').trim() || ''])].filter(Boolean).join('\n');
}

function feedText(value: string, contentType: string, sourceUrl?: string): string {
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
  return cleanMenuText(value, sourceUrl);
}

const menuLinkClues = [
  /\bmenu(?:s)?\b|\blunch\b|\bfood\b|\bdining\b/i,
  /\blounas\w*\b|\bruokalista\w*\b|\bpäivän lounas\b|\btuotteet\b/i,
  /\bmeny\b|\bdagens\b|\blunchmeny\b|\bmat\b/i,
];

export function discoverMenuLinks(value: string, sourceUrl: string): string[] {
  if (!value.includes('<')) return [];
  let source: URL;
  try { source = new URL(sourceUrl); } catch { return []; }
  if (source.protocol !== 'https:') return [];
  const document = new DOMParser().parseFromString(value, 'text/html');
  const candidates = new Map<string, number>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const label = [anchor.textContent, anchor.getAttribute('aria-label'), anchor.getAttribute('title')].filter(Boolean).join(' ');
    const href = anchor.getAttribute('href') || '';
    const combined = `${label} ${href}`;
    const matches = menuLinkClues.filter(clue => clue.test(combined)).length;
    if (!matches) continue;
    try {
      const url = new URL(href, source);
      url.hash = '';
      const isPdf = /\.pdf$/i.test(url.pathname);
      if (url.protocol !== 'https:' || url.origin !== source.origin || url.username || url.password || url.href === source.href
        || (!isPdf && /\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url.pathname))) continue;
      const score = matches * 2 + (menuLinkClues.some(clue => clue.test(url.pathname)) ? 1 : 0) + (label.trim().length ? 1 : 0);
      candidates.set(url.href, Math.max(candidates.get(url.href) ?? 0, score));
    } catch { /* Ignore malformed and external links. */ }
  }
  return [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([url]) => url);
}

export function discoverMenuImages(value: string, sourceUrl: string): string[] {
  if (!value.includes('<')) return [];
  let source: URL;
  try { source = new URL(sourceUrl); } catch { return []; }
  const document = new DOMParser().parseFromString(value, 'text/html');
  const candidates = new Map<string, number>();
  const add = (rawUrl: string, hint: string) => {
    if (!menuLinkClues.some(clue => clue.test(hint))) return;
    try {
      const url = new URL(rawUrl, source);
      url.hash = '';
      if (url.protocol !== 'https:' || url.origin !== source.origin || url.username || url.password
        || !/\.(?:jpe?g|png|webp|bmp|tiff|gif)(?:$|\?)/i.test(url.pathname)) return;
      candidates.set(url.href, Math.max(candidates.get(url.href) ?? 0, hint.length));
    } catch { /* Ignore external and malformed links. */ }
  };
  for (const image of document.querySelectorAll<HTMLImageElement>('img[src],img[data-src]')) {
    const parentLabel = image.closest('a')?.textContent || '';
    const hint = [image.getAttribute('alt'), image.getAttribute('title'), image.getAttribute('class'), image.getAttribute('src'), parentLabel].filter(Boolean).join(' ');
    add(image.getAttribute('src') || image.getAttribute('data-src') || '', hint);
  }
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = anchor.getAttribute('href') || '';
    const hint = [anchor.textContent, anchor.getAttribute('title'), href].filter(Boolean).join(' ');
    add(href, hint);
  }
  return [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([url]) => url);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Menu search cancelled.'));
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(new Error('Menu search cancelled.')); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }, error => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}

async function requestMenuAsset(assetUrl: string, signal: AbortSignal): Promise<Blob> {
  let response: Response;
  if (menuReaderUrl) {
    const endpoint = new URL(menuReaderUrl, window.location.href);
    if (!endpoint.pathname.endsWith('/v1/menu')) throw new Error('The menu reader asset endpoint is not configured.');
    endpoint.pathname = endpoint.pathname.replace(/\/v1\/menu$/, '/v1/menu-asset');
    response = await fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: assetUrl }),
      signal,
      credentials: 'omit',
    });
  } else {
    response = await fetch(assetUrl, { signal, credentials: 'omit' });
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || `The menu asset could not be fetched (${response.status}).`);
  }
  const type = response.headers.get('Content-Type')?.split(';')[0].toLowerCase() || '';
  const isImage = /^image\/(?:jpeg|png|webp|bmp|tiff|gif)$/.test(type);
  const isPdf = type === 'application/pdf';
  if (!isImage && !isPdf) throw new Error('The linked menu asset format is not supported.');
  const blob = await response.blob();
  const maxBytes = isPdf ? 5_000_000 : 3_000_000;
  if (!blob.size || blob.size > maxBytes) throw new Error(`The menu ${isPdf ? 'PDF' : 'image'} is empty or larger than ${isPdf ? '5' : '3'} MB.`);
  return blob;
}

export function normalizePdfGlyphSpacing(value: string): string {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const normalized: string[] = [];
  for (let index = 0; index < tokens.length;) {
    if (tokens[index].length === 1 && /[\p{L}\p{N}]/u.test(tokens[index])) {
      const glyphs: string[] = [];
      while (index < tokens.length && tokens[index].length === 1 && /[\p{L}\p{N}]/u.test(tokens[index])) {
        glyphs.push(tokens[index]);
        index += 1;
      }
      normalized.push(glyphs.length > 1 ? glyphs.join('') : glyphs[0]);
    } else {
      normalized.push(tokens[index]);
      index += 1;
    }
  }
  return normalized.join(' ')
    .replace(/(\d)\s+([.,])\s+(\d)/g, '$1$2$3')
    .replace(/\s+([’'])\s*/g, '$1');
}

export function formatPdfMenuRows(rows: Array<Array<{ x: number; text: string }>>, pageWidth: number): string[] {
  const lines: string[] = [];
  let section = '';
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const text = sorted.map(part => normalizePdfGlyphSpacing(part.text)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const left = sorted[0]?.x ?? 0;
    const isCenteredHeading = left >= pageWidth * 0.4 && text.length <= 60
      && text === text.toLocaleUpperCase() && !/\d+[.,]\d{1,2}/.test(text);
    if (isCenteredHeading) {
      section = text;
      lines.push(`menu-section: ${section}`);
      continue;
    }
    const price = text.match(/(?:€|\$|£)?\s*\d+[.,]\d{1,2}\s*(?:€|\$|£)?\s*$/)?.[0].trim() || '';
    const isPricedDescription = text.length >= 35 && (text.match(/,/g) || []).length >= 2 && Boolean(price);
    const previous = lines.at(-1);
    if (isPricedDescription && previous && !previous.startsWith('menu-section:') && !/\d+[.,]\d{1,2}/.test(previous)) {
      const description = text.slice(0, text.length - price.length).replace(/\s*\/\/+\s*$/, '').trim();
      const item = { section, name: previous, description, price, diets: [], dietaryInfo: [], allergenInfo: [], sourceText: `${previous} · ${text}` };
      lines[lines.length - 1] = `menu-schema-item: ${JSON.stringify(item)}`;
    } else {
      lines.push(text);
    }
  }
  return lines;
}

async function extractMenuPdf(pdf: Blob, signal: AbortSignal): Promise<string> {
  if (pdf.type !== 'application/pdf' || pdf.size > 5_000_000) throw new Error('This menu PDF is not supported or is larger than 5 MB.');
  const pdfjsUrl = new URL('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs');
  const pdfjsWorkerUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
  const pdfjs = await import(/* @vite-ignore */ pdfjsUrl.href);
  pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
  if (signal.aborted) throw new Error('Menu search cancelled.');
  const task = pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()), isEvalSupported: false, useWasm: false });
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
  try {
    if (document.numPages > 20) throw new Error('This menu PDF has more than 20 pages; open the source to view it.');
    const pages: string[] = [];
    let charCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (signal.aborted) throw new Error('Menu search cancelled.');
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const rows = new Map<number, Array<{ x: number; text: string }>>();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const transform = item.transform;
        const y = Math.round(transform[5] / 2) * 2;
        const row = rows.get(y) || [];
        row.push({ x: transform[4], text: normalizePdfGlyphSpacing(item.str) });
        rows.set(y, row);
      }
      const pageWidth = Math.abs(page.view[2] - page.view[0]);
      const pageText = formatPdfMenuRows([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row), pageWidth).join('\n');
      charCount += pageText.length;
      if (charCount > 120_000) throw new Error('This menu PDF contains too much text to read automatically.');
      pages.push(pageText);
      page.cleanup();
    }
    const text = pages.join('\n');
    if (!text.trim()) throw new Error('This PDF has no selectable text. Open the source link to view it.');
    return text;
  } finally {
    await task.destroy();
  }
}

async function recognizeMenuImage(image: Blob, language: MenuLanguage, signal: AbortSignal): Promise<string> {
  const languageCode = language === 'fi' ? 'fin' : language === 'sv' ? 'swe' : 'eng';
  const bitmap = await createImageBitmap(image);
  if (signal.aborted) {
    bitmap.close();
    throw new Error('Menu search cancelled.');
  }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the menu image for local OCR.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const { createWorker } = await import('tesseract.js');
  const workerRequest = createWorker(languageCode, 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    langPath: 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@87416418657359cb625c412a48b6e1d6d41c29bd',
    cacheMethod: 'write',
    gzip: false,
  }).then(async worker => {
    if (signal.aborted) {
      await worker.terminate();
      throw new Error('Menu search cancelled.');
    }
    return worker;
  });
  const worker = await abortable(workerRequest, signal);
  let terminated = false;
  const terminate = async () => {
    if (terminated) return;
    terminated = true;
    await worker.terminate();
  };
  const cancelOcr = () => { void terminate(); };
  if (signal.aborted) {
    await terminate();
    throw new Error('Menu search cancelled.');
  }
  signal.addEventListener('abort', cancelOcr, { once: true });
  try {
    const result = await worker.recognize(canvas, { rotateAuto: true }, { text: true });
    return result.data.text.trim().slice(0, 100_000);
  } finally {
    signal.removeEventListener('abort', cancelOcr);
    await terminate();
  }
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

export function parseMenu(value: string, language: MenuLanguage, classifier: MenuClassifier | null, classifierOptions: MenuClassifierOptions = {}): ParsedMenu {
  const lines = cleanMenuText(value).split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found: MenuItem[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const dietaryLegend = new Map<string, string>();
  const legendLabels: Array<[RegExp, string]> = [
    [/laktoositon|lactose[- ]free|laktosfri/i, 'Marked lactose-free'],
    [/vähälaktoosinen|low[- ]lactose/i, 'Marked low-lactose'],
    [/gluteeniton|gluten[- ]free|glutenfri/i, 'Marked gluten-free'],
    [/vegaan\w*|vegan|vegansk/i, 'Marked vegan'],
    [/kasvis(?:ruoka)?|vegetarian|vegetarisk/i, 'Marked vegetarian'],
    [/maidoton|dairy[- ]free|mejerifri/i, 'Marked dairy-free'],
    [/sis\.\s*valkosipulia|contains garlic/i, 'Marked contains garlic'],
  ];
  const inlineLegendLines = new Set<string>();
  const inlineDefinition = /\b([A-ZÅÄÖ]{1,4})\s*[:=]\s*(gluteeniton|gluten[- ]free|glutenfri|laktoositon|lactose[- ]free|laktosfri|vähälaktoosinen|low[- ]lactose|vegaan\w*|vegan|vegansk|kasvis(?:ruoka)?|vegetarian|vegetarisk|maidoton|dairy[- ]free|mejerifri|sis\.\s*valkosipulia|contains garlic)\b/gi;
  for (const line of lines) {
    const definitions = [...line.matchAll(inlineDefinition)];
    for (const definition of definitions) {
      const mapping = legendLabels.find(([pattern]) => pattern.test(definition[2]));
      if (mapping) dietaryLegend.set(definition[1].toLocaleUpperCase(), mapping[1]);
    }
    if (definitions.length && !/\d/.test(line)) inlineLegendLines.add(line);
    const explicitLegend = line.match(/^menu-diet-legend:\s*([A-ZÅÄÖ]{1,4})=(.+)$/i);
    if (explicitLegend) {
      const mapping = legendLabels.find(([pattern]) => pattern.test(explicitLegend[2]));
      if (mapping) dietaryLegend.set(explicitLegend[1].toLocaleUpperCase(), mapping[1]);
    }
  }
  for (let index = 0; index < lines.length - 1; index++) {
    const code = lines[index].trim().match(/^(?:VL|VE|VS|L|G|M)$/i)?.[0].toLocaleUpperCase();
    if (!code) continue;
    const label = lines[index + 1].trim();
    const mapping = legendLabels.find(([pattern]) => pattern.test(label));
    if (mapping) dietaryLegend.set(code, mapping[1]);
  }
  const mappedCodeSuffix = (line: string) => {
    const match = line.match(/\s+([A-ZÅÄÖ]{1,4}(?:\s*[+,/]\s*[A-ZÅÄÖ]{1,4})*)$/);
    if (!match) return null;
    const codes = match[1].split(/[+,/]/).map(code => code.trim().toLocaleUpperCase()).filter(Boolean);
    return codes.length && codes.every(code => dietaryLegend.has(code)) ? match : null;
  };
  const inlineCodes = (line: string) => {
    const parenthetical = [...line.matchAll(/\(([^()]*)\)/g)].flatMap(match => {
      const codes = match[1].match(/[A-ZÅÄÖ]{1,4}(?=\s*(?:[+,/)]|$))/g) || [];
      return codes.length ? [codes.join('+')] : [];
    });
    const suffix = mappedCodeSuffix(line.replace(pricePattern, ''));
    return suffix ? [...parenthetical, suffix[1].split(/[+,/]/).map(code => code.trim()).join('+')] : parenthetical;
  };
  const modules = language === 'unknown' ? Object.values(languageModules) : [languageModules[language]];
  const activeLanguage = language === 'unknown' ? 'en' : language;
  const pricePattern = /(?:^|\s)(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)/;
  const isDietLine = (line: string) => modules.some(module => module.dietSignals.some(([pattern]) => pattern.test(line)));
  const standaloneDiets = (line: string) => (language === 'unknown'
    ? Object.entries(standaloneDietLabels)
    : [[language, standaloneDietLabels[language]] as const])
    .filter(([, pattern]) => pattern.test(line))
    .flatMap(([key]) => languageModules[key as Exclude<MenuLanguage, 'unknown'>].dietSignals
      .filter(([pattern]) => pattern.test(line)).map(([, label]) => label));
  const isSectionPrefix = (line: string) => line === line.toLocaleUpperCase() && (language === 'unknown' ? Object.values(sectionHeadings).some(headings => headings.test(line)) : sectionHeadings[activeLanguage].test(line)); const isSection = (line: string) => (language === 'unknown'
    ? Object.values(sectionHeadings).some(headings => headings.test(line))
    : sectionHeadings[activeLanguage].test(line)) || modules.some(module => module.headings.test(line));
  const isMenuTitleHeading = (line: string) => /\b(?:lounaslista|ruokalista|lunch menu|dinner menu|menu|meny|à la carte|a la carte)\b/i.test(line)
    || /\blounas\b.*\b(?:maanantaista|perjantaihin|kello)\b/i.test(line);
  const isWeekdayHeading = (line: string) => /^(?:maanantai|tiistai|keskiviikko|torstai|perjantai|måndag|tisdag|onsdag|torsdag|fredag|monday|tuesday|wednesday|thursday|friday)\s+\d{1,2}(?:[./]\d{1,2})?(?:[./]\d{2,4})?(?:\s*\.?\s*(?:laajenna|expand|show|more))?$/i.test(line);
  const isAllergenNotice = (line: string) => (language === 'unknown' ? Object.values(allergenNotices) : [allergenNotices[language]]).some(pattern => pattern.test(line));
  let section = '';
  let skippingNonMenuSection = false;
  let pendingImageUrl: string | undefined;
  let pendingMenuPriceLabel = '';
  for (const originalLine of lines) { let line = originalLine;
    if (inlineLegendLines.has(originalLine)) continue;
    if (line.startsWith('menu-section:')) {
      const heading = line.slice('menu-section:'.length).trim();
      if (nonMenuSectionHeading.test(heading)) {
        section = '';
        skippingNonMenuSection = true;
      } else if (skippingNonMenuSection && (isSection(heading) || isMenuTitleHeading(heading) || isWeekdayHeading(heading))) {
        section = heading;
        skippingNonMenuSection = false;
      } else if (!skippingNonMenuSection) {
        section = heading;
      }
      continue;
    }
    if (line.startsWith('menu-diet-legend:')) continue;
    const structured = line.match(/^menu-schema-item:\s*(\{.*\})$/i);
    if (structured) {
      try {
        const item = JSON.parse(structured[1]) as Partial<MenuItem>;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (name.length >= 3 && name.length <= 120 && !seen.has(name.toLocaleLowerCase())) {
          seen.add(name.toLocaleLowerCase());
          found.push({
            section: typeof item.section === 'string' ? item.section : '',
            name,
            description: typeof item.description === 'string' ? item.description.slice(0, 240) : '',
            price: typeof item.price === 'string' ? item.price : '',
            diets: Array.isArray(item.diets) ? item.diets.filter((diet): diet is string => typeof diet === 'string') : [],
            dietaryInfo: Array.isArray(item.dietaryInfo) ? item.dietaryInfo.filter((info): info is string => typeof info === 'string') : [],
            ingredients: Array.isArray(item.ingredients) ? item.ingredients.filter((ingredient): ingredient is string => typeof ingredient === 'string').slice(0, 20) : [],
            allergenInfo: Array.isArray(item.allergenInfo) ? item.allergenInfo.filter((info): info is string => typeof info === 'string') : [],
            sourceText: typeof item.sourceText === 'string' ? item.sourceText.slice(0, 500) : [name, item.description, item.price].filter((part): part is string => typeof part === 'string' && Boolean(part)).join(' · '),
            imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : undefined,
          });
        }
      } catch { /* Ignore malformed structured menu entries and continue with visible text. */ }
      if (found.length >= 100) break;
      continue;
    }
    const image = line.match(/^menu-image:\s*(https:\/\/\S+)$/i);
    if (image) { pendingImageUrl = image[1]; continue; }
    if (line.length < 3) continue;
    if (nonMenuSectionHeading.test(line)) {
      section = '';
      skippingNonMenuSection = true;
      continue;
    }
    if (skippingNonMenuSection) {
      if (isSection(line) || isMenuTitleHeading(line) || isWeekdayHeading(line)) {
        section = line;
        skippingNonMenuSection = false;
        continue;
      }
      continue;
    }
    if (isMenuTitleHeading(line) || isWeekdayHeading(line)) { section = line; continue; }
    if (isSection(line)) { section = line; continue; } for (let end = line.indexOf(" "); end > 0; end = line.indexOf(" ", end + 1)) { const prefix = line.slice(0, end); if (isSectionPrefix(prefix)) { section = prefix; line = line.slice(end + 1).trim(); break; } } if (line.length < 3) continue; if (isSection(line)) { section = line; continue; }
    if (/^(?:maanantai|tiistai|keskiviikko|torstai|perjantai|monday|tuesday|wednesday|thursday|friday)\s+\d{1,2}[./]\d{1,2}[./]\d{4}$/i.test(line)
      || nonMenuDetailLine.test(line) || nonMenuStatusLine.test(line) || /^\+?\d[\d\s().-]{7,}$/.test(line) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) {
      if (/^lounasbuffet\b/i.test(line)) pendingMenuPriceLabel = line;
      continue;
    }
    const dottedCodePrice = line.match(/^((?:[A-ZÅÄÖ]\.\s*){1,8})((?:\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)|(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?))$/i);
    if (dottedCodePrice) {
      const last = found[found.length - 1];
      if (last && last.section === section) {
        const code = dottedCodePrice[1].replace(/\s+/g, ' ').trim();
        last.dietaryInfo = [...new Set([...(last.dietaryInfo ?? []), code])];
        if (!last.price) last.price = dottedCodePrice[2].trim().replace(/\s+/g, ' ');
        last.sourceText = `${last.sourceText}\n${line}`.slice(0, 500);
      }
      continue;
    }
    if (pricePattern.test(line) && line.replace(pricePattern, '').replace(/[\s€$£]/g, '') === '') {
      const last = found[found.length - 1];
      if (last && last.section === section && !last.price) last.price = line.trim();
      else if (pendingMenuPriceLabel && notes.length < 30) notes.push(`${pendingMenuPriceLabel}: ${line.trim()}`);
      pendingMenuPriceLabel = '';
      continue;
    }
    if (dietaryCodeLine.test(line)) {
      const last = found[found.length - 1];
      if (last && last.section === section) {
        last.dietaryInfo = [...new Set([...(last.dietaryInfo ?? []), line])];
        last.sourceText = `${last.sourceText}\n${line}`.slice(0, 500);
      }
      continue;
    }
    const lineDiets = standaloneDiets(line);
    if (lineDiets.length) {
      const last = found[found.length - 1];
      if (last && last.section === section) {
        last.diets = [...new Set([...last.diets, ...lineDiets])];
        last.sourceText = `${last.sourceText}\n${line}`.slice(0, 500);
      }
      continue;
    }
    const ingredientPatterns = language === 'unknown' ? Object.values(ingredientLines) : [ingredientLines[language]];
    const ingredientMatch = ingredientPatterns.map(pattern => line.match(pattern)).find(match => match?.[1]?.trim());
    if (ingredientMatch) {
      const last = found[found.length - 1];
      if (last && last.section === section) {
        last.ingredients = [...new Set([...(last.ingredients ?? []), ingredientMatch[1].trim().slice(0, 240)])].slice(0, 20);
        last.sourceText = `${last.sourceText}\n${line}`.slice(0, 500);
      } else if (notes.length < 30) notes.push(line.slice(0, 220));
      continue;
    }
    const hasAllergenInfo = isAllergenNotice(line);
    if (hasAllergenInfo && !pricePattern.test(line)) {
      const itemPatterns = language === 'unknown' ? Object.values(itemAllergenLines) : [itemAllergenLines[language]];
      const isItemAllergen = itemPatterns.some(pattern => pattern.test(line));
      const last = found[found.length - 1];
      if (isItemAllergen && last && last.section === section && line.length <= 160) {
        last.allergenInfo = [...new Set([...last.allergenInfo, line])].slice(0, 10);
        last.sourceText = `${last.sourceText}\n${line}`.slice(0, 500);
        continue;
      }
      for (const note of splitMenuNotice(line)) {
        if (notes.length >= 30) break;
        if (!notes.includes(note)) notes.push(note);
      }
      continue;
    }
    if (line.length > 220 || /^https?:\/\//i.test(line)) continue;
    const lineDietCodes = inlineCodes(line);
    const menuLine = line.replace(/\(([^()]*)\)/g, (whole, value: string) => inlineCodes(`(${value})`).length ? '' : whole)
      .replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
    const price = line.match(pricePattern);
    const parts = menuLine.split(/\s+[·|—–]\s+|\s{2,}/);
    const name = (parts[0] || menuLine)
      .replace(/\s*(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?\s*$/, '')
      .replace(/\s+\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)\s*$/, '')
      .replace(/\s*[-–—|·:]\s*$/, '')
      .trim();
    if (!price && !lineDietCodes.length && /[.!?]$/.test(name) && name.split(/\s+/).length >= 4) continue;
    if (name.length < 3 || name.length > 220) continue;
    if (/^(all prices|please inform|we cannot|may contain|allergen information)/i.test(name)) continue;
    if (language !== 'unknown' && classifier) {
      const prediction = classifyMenuLine(name, classifier);
      if (prediction?.label === 'other' && prediction.confidence >= MENU_OTHER_FILTER_THRESHOLD) {
        const last = found[found.length - 1];
        const looksLikeDescription = last && last.section === section && line.length >= 35 && line.length <= 180 && !pricePattern.test(line) && !isDietLine(line) && /[.!,:;]/.test(line);
        const recognizedAsForeignDish = (classifierOptions.secondaryClassifiers ?? []).some(secondary => {
          if (secondary.language === classifier.language) return false;
          const secondaryPrediction = classifyMenuLine(name, secondary);
          return secondaryPrediction?.label === 'dish' && secondaryPrediction.confidence >= MENU_OTHER_FILTER_THRESHOLD;
        });
        const keepUnresolvedPricedLine = classifierOptions.mixedLanguage && Boolean(price)
          && classifierOptions.missingSecondaryClassifier;
        if (!recognizedAsForeignDish && !keepUnresolvedPricedLine) {
          if (looksLikeDescription) {
            last.description = [last.description, line].filter(Boolean).join(' ').slice(0, 240);
            last.sourceText = `${last.sourceText}\n${line}`.slice(0, 500);
          }
          continue;
        }
        if (looksLikeDescription) {
          last.description = [last.description, line].filter(Boolean).join(' ').slice(0, 240);
          last.sourceText = `${last.sourceText}\n${line}`.slice(0, 500);
          continue;
        }
      }
    }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) { pendingImageUrl = undefined; continue; }
    seen.add(key);
    const diets = [...new Set([
      ...modules.flatMap(module => module.dietSignals.filter(([pattern]) => pattern.test(line)).map(([, label]) => label)),
      ...lineDietCodes.flatMap(codes => codes.split(/[+,/]/).map(code => dietaryLegend.get(code.toLocaleUpperCase())).filter((label): label is string => Boolean(label))),
    ])];
    const priceText = price?.[0]?.trim().replace(/\s+/g, ' ') || '';
    const description = parts.slice(1).join(' · ').replace(pricePattern, '').trim();
    found.push({ section, name, description, price: priceText, diets, dietaryInfo: [...new Set(lineDietCodes)], allergenInfo: hasAllergenInfo ? [line] : [], sourceText: originalLine, imageUrl: pendingImageUrl });
    pendingImageUrl = undefined;
    if (found.length >= 100) break;
  }
  return { items: found, notes };
}

export function hasMenuEvidence(sourceText: string, sourceUrl: string, items: MenuItem[]): boolean {
  if (!items.length) return false;
  if (/^menu-schema-item:\s*\{/im.test(sourceText)) return true;
  try {
    const pathname = new URL(sourceUrl).pathname;
    if (/(?:^|[\/_.-])(?:menus?|lunch|lounas|ruokalista|ruokalistat|meny|dagens)(?:$|[\/_.-])/i.test(pathname)) return true;
  } catch { /* Without a valid source URL, require page-level evidence below. */ }
  const hasMenuHeading = sourceText.split(/\r?\n/).some(line =>
    /^(?:menu|food menu|lunch|lounas|ruokalista|ruokalistat|meny|dagens)$/i.test(line.trim()));
  const hasItemDetails = items.some(item => Boolean(item.section || item.price || item.imageUrl
    || item.ingredients?.length || item.diets.length || item.allergenInfo.length));
  return hasMenuHeading || hasItemDetails;
}

function validCachedMenu(value: unknown): value is CachedMenu {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CachedMenu>;
  return typeof entry.sourceUrl === 'string' && entry.sourceUrl.length <= 2048
    && (entry.resolvedSourceUrl === undefined || (typeof entry.resolvedSourceUrl === 'string' && entry.resolvedSourceUrl.length <= 2048))
    && typeof entry.cachedAt === 'string' && Number.isFinite(Date.parse(entry.cachedAt))
    && (entry.language === undefined || ['fi', 'sv', 'en', 'unknown'].includes(entry.language))
    && (entry.modelsUsed === undefined || (Array.isArray(entry.modelsUsed) && entry.modelsUsed.every(model => ['fi', 'sv', 'en'].includes(model))))
    && Array.isArray(entry.items) && entry.items.length <= 100
    && Array.isArray(entry.notes) && entry.notes.length <= 30 && entry.notes.every(note => typeof note === 'string' && note.length <= 220)
    && entry.items.every(item => Boolean(item) && typeof item.name === 'string' && item.name.length <= 220
      && typeof item.section === 'string' && item.section.length <= 80
      && typeof item.description === 'string' && item.description.length <= 240
      && typeof item.price === 'string' && item.price.length <= 30
      && typeof item.sourceText === 'string' && item.sourceText.length <= 500
      && (item.dietaryInfo === undefined || (Array.isArray(item.dietaryInfo) && item.dietaryInfo.length <= 10 && item.dietaryInfo.every(info => typeof info === 'string' && info.length <= 80)))
      && (item.ingredients === undefined || (Array.isArray(item.ingredients) && item.ingredients.length <= 20 && item.ingredients.every(ingredient => typeof ingredient === 'string' && ingredient.length <= 240)))
      && (item.imageUrl === undefined || (typeof item.imageUrl === 'string' && item.imageUrl.length <= 2048 && /^https:\/\//i.test(item.imageUrl)))
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

function writeCachedMenu(sourceUrl: string, resolvedSourceUrl: string, menu: ParsedMenu, language: MenuLanguage, modelsUsed: Array<Exclude<MenuLanguage, 'unknown'>>): string | null {
  const cachedAt = new Date().toISOString();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || '[]');
    const now = Date.now();
    const recent = Array.isArray(parsed) ? parsed.filter((candidate): candidate is CachedMenu => {
      if (!validCachedMenu(candidate)) return false;
      const age = now - Date.parse(candidate.cachedAt);
      return age >= 0 && age < MENU_CACHE_TTL_MS && candidate.sourceUrl !== sourceUrl;
    }) : [];
    const next: CachedMenu[] = [{ sourceUrl, resolvedSourceUrl, cachedAt, ...menu, language, modelsUsed }, ...recent].slice(0, MENU_CACHE_MAX_ENTRIES);
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(next));
    return cachedAt;
  } catch {
    return null;
  }
}

async function readCachedMenuSource(sourceUrl: string): Promise<CachedMenuSource | null> {
  try {
    const cached = await menuSourceCache.sources.get(sourceUrl);
    if (!cached || cached.text.length > 500_000 || !Number.isFinite(cached.fetchedAt)) return null;
    const age = Date.now() - cached.fetchedAt;
    return age >= 0 && age < MENU_SOURCE_CACHE_STALE_MS ? cached : null;
  } catch {
    return null;
  }
}

async function saveCachedMenuSource(entry: CachedMenuSource): Promise<void> {
  try {
    await menuSourceCache.sources.put(entry);
    await menuSourceCache.sources.where('fetchedAt').below(Date.now() - MENU_SOURCE_CACHE_STALE_MS).delete();
  } catch { /* menu remains available for this session when browser storage is full or blocked */ }
}

async function requestMenuSource(sourceUrl: string, signal: AbortSignal): Promise<CachedMenuSource> {
  const parsedUrl = new URL(sourceUrl);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('Only public HTTPS menu pages can be read automatically.');
  }

  let text: string;
  let contentType: string;
  let resolvedSourceUrl = parsedUrl.href;
  if (/\.pdf$/i.test(parsedUrl.pathname)) {
    const pdf = await requestMenuAsset(parsedUrl.href, signal);
    contentType = 'application/pdf';
    text = await extractMenuPdf(pdf, signal);
  } else if (menuReaderUrl) {
    const response = await fetch(menuReaderUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: parsedUrl.href }),
      signal,
      credentials: 'omit',
    });
    const result = await response.json() as { text?: string; contentType?: string; sourceUrl?: string; error?: string };
    if (!response.ok) throw new Error(result.error || `The menu reader could not fetch this page (${response.status}).`);
    text = (result.text || '').slice(0, 500_000);
    contentType = result.contentType || '';
    resolvedSourceUrl = result.sourceUrl || parsedUrl.href;
  } else {
    const response = await fetch(parsedUrl.href, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`The menu page could not be fetched (${response.status}).`);
    contentType = response.headers.get('content-type') || '';
    resolvedSourceUrl = response.url || parsedUrl.href;
    text = await readMenuResponse(response);
  }

  if (/application\/pdf|image\//i.test(contentType) || /\.pdf(?:$|[?#])/i.test(resolvedSourceUrl)) {
    throw new Error('This menu is an unsupported PDF or image. Open the source link instead.');
  }
  if (!/text\/|json|xml|html/i.test(contentType) && contentType) {
    throw new Error('This menu format cannot be read automatically yet.');
  }
  if (!text.trim()) throw new Error('The restaurant page did not contain readable text.');
  const entry = { sourceUrl: parsedUrl.href, resolvedSourceUrl, contentType, text, fetchedAt: Date.now() };
  await saveCachedMenuSource(entry);
  return entry;
}

async function loadMenuSource(sourceUrl: string, signal: AbortSignal): Promise<CachedMenuSource & { refreshError?: string }> {
  const cached = await readCachedMenuSource(sourceUrl);
  try {
    return await requestMenuSource(sourceUrl, signal);
  } catch (cause) {
    if (signal.aborted) throw cause;
    if (cached) {
      return { ...cached, refreshError: cause instanceof Error ? cause.message : 'The menu refresh failed.' };
    }
    throw cause;
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
  const [modelsUsed, setModelsUsed] = useState<Array<Exclude<MenuLanguage, 'unknown'>>>([]);
  const [ocrUsed, setOcrUsed] = useState(false);
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
    setModelsUsed([]);
    setOcrUsed(false);
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
      setModelsUsed(cached.modelsUsed ?? []);
      setVerifiedSourceUrl(cached.resolvedSourceUrl ?? menuUrl);
      setBusy(false);
      return () => controller.abort();
    }
    setBusy(true);

    async function loadMenu() {
      try {
        timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
        const interpret = async (candidate: CachedMenuSource) => {
          const readable = feedText(candidate.text, candidate.contentType, candidate.resolvedSourceUrl);
          const detectedLanguage = detectLanguage(readable);
          const secondaryLanguages = detectedLanguage === 'unknown' ? [] : languageClueScores(readable)
            .filter(score => score.language !== detectedLanguage && score.score >= MIXED_LANGUAGE_CLUE_THRESHOLD)
            .map(score => score.language);
          let classifier: MenuClassifier | null = null;
          if (detectedLanguage !== 'unknown') {
            try { classifier = await loadMenuClassifier(detectedLanguage); } catch { /* keep rule-based extraction if language weights are not available */ }
          }
          const secondaryClassifiers: MenuClassifier[] = [];
          if (classifier && secondaryLanguages.length && canLoadSecondaryMenuModels()) {
            const loadedSecondary = await Promise.all(secondaryLanguages.map(language => loadMenuClassifier(language).catch(() => null)));
            secondaryClassifiers.push(...loadedSecondary.filter((model): model is MenuClassifier => Boolean(model)));
          }
          const classifierOptions: MenuClassifierOptions = {
            secondaryClassifiers,
            mixedLanguage: secondaryLanguages.length > 0,
            missingSecondaryClassifier: secondaryClassifiers.length < secondaryLanguages.length,
          };
          const modelsUsed = [...new Set([
            ...(classifier ? [classifier.language as Exclude<MenuLanguage, 'unknown'>] : []),
            ...secondaryClassifiers.map(model => model.language as Exclude<MenuLanguage, 'unknown'>),
          ])];
          return { detectedLanguage, classifier, modelsUsed, extracted: parseMenu(readable, detectedLanguage, classifier, classifierOptions) };
        };
        const hasMenu = (candidate: CachedMenuSource, result: Awaited<ReturnType<typeof interpret>>) =>
          hasMenuEvidence(candidate.text, candidate.resolvedSourceUrl, result.extracted.items);
        let source: CachedMenuSource & { refreshError?: string };
        let interpreted: Awaited<ReturnType<typeof interpret>>;
        let didUseOcr = false;
        try {
          source = await loadMenuSource(menuUrl, controller.signal);
          interpreted = await interpret(source);
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
          if (!/\.(?:jpe?g|png|webp|bmp|tiff|gif)(?:$|[?#])/i.test(menuUrl)) throw cause;
          const image = await requestMenuAsset(menuUrl, controller.signal);
          const languageHint = detectLanguage(menuUrl);
          const text = await recognizeMenuImage(image, languageHint, controller.signal);
          source = { sourceUrl: menuUrl, resolvedSourceUrl: menuUrl, contentType: 'text/plain', text, fetchedAt: Date.now() };
          interpreted = await interpret(source);
          didUseOcr = interpreted.extracted.items.length > 0;
        }
        if (!hasMenu(source, interpreted)) {
          for (const candidateUrl of discoverMenuLinks(source.text, source.resolvedSourceUrl)) {
            if (controller.signal.aborted) break;
            try {
              const candidate = await loadMenuSource(candidateUrl, controller.signal);
              const candidateResult = await interpret(candidate);
              if (hasMenu(candidate, candidateResult)) {
                source = candidate;
                interpreted = candidateResult;
                break;
              }
            } catch { if (controller.signal.aborted) throw new Error('Menu search cancelled.'); }
          }
        }
        let ocrFailure = '';
        if (!hasMenu(source, interpreted)) {
          const sourceLanguage = interpreted.detectedLanguage;
          for (const imageUrl of discoverMenuImages(source.text, source.resolvedSourceUrl)) {
            if (controller.signal.aborted) break;
            try {
              const image = await requestMenuAsset(imageUrl, controller.signal);
              const text = await recognizeMenuImage(image, sourceLanguage, controller.signal);
              if (!text) continue;
              const imageSource: CachedMenuSource = {
                sourceUrl: imageUrl,
                resolvedSourceUrl: imageUrl,
                contentType: 'text/plain',
                text,
                fetchedAt: Date.now(),
              };
              const imageResult = await interpret(imageSource);
              if (imageResult.extracted.items.length) {
                source = imageSource;
                interpreted = imageResult;
                didUseOcr = true;
                break;
              }
            } catch (cause) {
              if (controller.signal.aborted) throw new Error('Menu search cancelled.');
              ocrFailure = cause instanceof Error ? cause.message : 'Local OCR could not read this menu image.';
            }
          }
        }
        const { detectedLanguage, extracted } = interpreted;
        if (!didUseOcr && !hasMenu(source, interpreted)) throw new Error(ocrFailure || 'No verifiable menu items were found on the restaurant page.');
        if (!controller.signal.aborted) {
          setItems(extracted.items);
          setNotes(extracted.notes);
          setLanguage(detectedLanguage);
          setModelsUsed(interpreted.modelsUsed);
          setOcrUsed(didUseOcr);
          setVerifiedSourceUrl(source.resolvedSourceUrl);
          setCachedAt(source.refreshError
            ? new Date(source.fetchedAt).toISOString()
            : writeCachedMenu(menuUrl, source.resolvedSourceUrl, extracted, detectedLanguage, interpreted.modelsUsed));
          if (source.refreshError) setError(`Showing the menu saved on this device from ${new Date(source.fetchedAt).toLocaleString()}; refresh failed: ${source.refreshError}`);
        }
      } catch (cause) {
        if (timedOut) {
          setError('The menu service took too long to respond.');
        } else if (!controller.signal.aborted) {
          const message = cause instanceof Error ? cause.message : 'The menu could not be read.';
          setError(/failed to fetch|networkerror|load failed/i.test(message)
            ? 'Lunumi could not reach the menu source or reader service; the restaurant may block automated requests or its site may be outside the approved list. Open the source to view the menu.'
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
        {item.imageUrl && <img className="menu-assistant-item-image" src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <div>{item.section && <span className="menu-assistant-section">{item.section}</span>}<strong>{item.name}</strong>{item.description && <span>{item.description}</span>}{item.ingredients?.length ? <span>Ingredients: {item.ingredients.join(', ')}</span> : null}{item.price && <span>{item.price}</span>}
          {item.allergenInfo.map((note, noteIndex) => <span className="menu-assistant-allergen" key={`${note}-${noteIndex}`}>{note}</span>)}{item.dietaryInfo?.map((info, infoIndex) => <span className="menu-assistant-allergen" key={`dietary-info-${infoIndex}`}>Dietary codes as listed: {info}</span>)}
          <details className="menu-assistant-evidence"><summary>Source text</summary><span>{item.sourceText}</span></details>
        </div>
        <div className="menu-assistant-diets">{item.diets.length ? item.diets.map(diet => <span key={diet}>{diet}</span>) : <span>Dietary details not stated</span>}</div>
      </li>)}</ul>
      {cachedAt && <p className="menu-assistant-note">Saved on this device · Updated {new Date(cachedAt).toLocaleString()}</p>}
      {error && <p className="menu-assistant-note" role="status">{error}</p>}
      <p className="menu-assistant-note">Menu text is read and interpreted on this device. Missing ingredients and allergens are unknown; verify with the restaurant, especially for allergies.</p>
      {ocrUsed && <p className="menu-assistant-note">Text was recognized from the linked menu image on this device; OCR can make mistakes. Check the source image.</p>}
      {language !== 'unknown' && <p className="menu-assistant-note">Detected language: {languageModules[language].name}.</p>}
      {modelsUsed.includes('en') && <p className="menu-assistant-note">English line filter uses a small local model trained from <a href="https://fdc.nal.usda.gov/download-datasets/" target="_blank" rel="noopener noreferrer">USDA FoodData Central public-domain data (CC0)</a> and <a href="https://github.com/cudldev/lunumi" target="_blank" rel="noopener noreferrer">Lunumi-authored synthetic CC0 examples</a>.</p>}
      {modelsUsed.some(model => model === 'fi' || model === 'sv') && <p className="menu-assistant-note">Finnish and Swedish line filters use Fineli food names (CC BY 4.0), synthetic menu-line combinations, and CC0 page-noise examples. <a href="https://fineli.fi/fineli/fi/avoin-data" target="_blank" rel="noopener noreferrer">Fineli open data</a> is provided by THL.</p>}
    </> : !busy && <div className="menu-assistant-empty" role="status"><strong>Menu not available</strong><span>{error || 'No menu items could be read from this restaurant page.'}</span></div>}
    {(verifiedSourceUrl || sourceUrl) && <a className="menu-assistant-source" href={verifiedSourceUrl || sourceUrl || undefined} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>View source and verify menu</a>}
  </section>;
}
