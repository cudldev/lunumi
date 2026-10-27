export type MenuItem = {
  section: string;
  name: string;
  description: string;
  price: string;
  diets: string[];
  allergenInfo: string[];
  sourceText: string;
};
export type ParsedMenu = { items: MenuItem[]; notes: string[] };
type MenuLanguage = 'fi' | 'sv' | 'en' | 'unknown';
export type MenuSource = { url: string; label: string; discover?: boolean };

type LanguageModule = { name: string; clues: RegExp[]; dietSignals: Array<[RegExp, string]>; headings: RegExp };

// Keep per-language extraction rules isolated so they can later be replaced by trained models.
const languageModules: Record<Exclude<MenuLanguage, 'unknown'>, LanguageModule> = {
  fi: {
    name: 'Finnish',
    clues: [/\blounas\b/i, /\bmaanantai|tiistai|keskiviikko|torstai|perjantai\b/i, /\bkeitto|salaatti|kasvisruoka|gluteeniton\b/i],
    dietSignals: [
      [/\bvegaan\w*\b/i, 'Marked vegan'], [/\bkasvis(?:ruoka)?\b/i, 'Marked vegetarian'],
      [/\bgluteeniton\b/i, 'Marked gluten-free'], [/\bmaidoton\b/i, 'Marked dairy-free'],
      [/\blaktoositon\b/i, 'Marked lactose-free'], [/\bhalal\b/i, 'Marked halal'], [/\bketo(?:geeninen)?\b/i, 'Marked keto'],
    ],
    headings: /^(?:lounas|ruokalista|ruokalistat|jälkiruoat?|juomat|allergeenit|maanantai|tiistai|keskiviikko|torstai|perjantai)$/i,
  },
  sv: {
    name: 'Swedish',
    clues: [/\bdagens\b/i, /\bmåndag|tisdag|onsdag|torsdag|fredag\b/i, /\bsallad|soppa|kyckling|glutenfri\b/i],
    dietSignals: [
      [/\bvegansk\w*\b/i, 'Marked vegan'], [/\bvegetarisk\w*\b/i, 'Marked vegetarian'],
      [/\bglutenfri\w*\b/i, 'Marked gluten-free'], [/\bmejerifri\w*\b/i, 'Marked dairy-free'],
      [/\blaktosfri\w*\b/i, 'Marked lactose-free'], [/\bhalal\b/i, 'Marked halal'], [/\bketo(?:genisk)?\b/i, 'Marked keto'],
    ],
    headings: /^(?:lunch|meny|dagens|förrätter|huvudrätter|efterrätter|drycker|allergener|måndag|tisdag|onsdag|torsdag|fredag)$/i,
  },
  en: {
    name: 'English',
    clues: [/\bmonday|tuesday|wednesday|thursday|friday\b/i, /\blunch|menu|allergens\b/i, /\bsalad|soup|chicken|gluten[- ]free\b/i],
    dietSignals: [
      [/\bvegan\b/i, 'Marked vegan'], [/\bvegetarian\b/i, 'Marked vegetarian'],
      [/\bgluten[- ]free\b/i, 'Marked gluten-free'], [/\bdairy[- ]free\b/i, 'Marked dairy-free'],
      [/\blactose[- ]free\b/i, 'Marked lactose-free'], [/\bhalal\b/i, 'Marked halal'], [/\bketo(?:genic)?\b/i, 'Marked keto'],
    ],
    headings: /^(?:menu|food|drinks|desserts?|starters?|mains?|lunch|dinner|allergens?|monday|tuesday|wednesday|thursday|friday)$/i,
  },
};

const sectionHeadings: Record<Exclude<MenuLanguage, 'unknown'>, RegExp> = {
  fi: /^(?:alkuruoat|pääruoat|jälkiruoat?|juomat|hampurilaiset|kasvistuotteet|salaatit|keitot|lisukkeet|lounas|päivän lounas|maanantai|tiistai|keskiviikko|torstai|perjantai)$/i,
  sv: /^(?:förrätter|huvudrätter|efterrätter|drycker|burgare|sallader|soppor|tillbehör|dagens|måndag|tisdag|onsdag|torsdag|fredag)$/i,
  en: /^(?:starters?|appetizers?|mains?|main courses|burgers?|sandwiches|salads?|soups?|sides|desserts?|drinks|lunch|dinner|specials?|monday|tuesday|wednesday|thursday|friday)$/i,
};

// Some restaurant sites render a category heading and its first dish in one
// text node (for example, "HAMPURILAISET Kerroshampurilainen").
const sectionLabels: Record<Exclude<MenuLanguage, 'unknown'>, string[]> = {
  fi: ['päivän lounas', 'pehmyt-jäätelöt', 'sormisyötävät', 'kasvistuotteet', 'alkuruoat', 'pääruoat', 'jälkiruoat', 'hampurilaiset', 'ranskalaiset', 'tortillat', 'kastikkeet', 'pirtelöt', 'salaatit', 'keitot', 'lisukkeet', 'kampanjat', 'juomat', 'lounas', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai'],
  sv: ['huvudrätter', 'förrätter', 'efterrätter', 'drycker', 'sallader', 'soppor', 'tillbehör', 'burgare', 'dagens', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag'],
  en: ['main courses', 'appetizers', 'starters', 'sandwiches', 'burgers', 'salads', 'soups', 'desserts', 'drinks', 'sides', 'specials', 'lunch', 'dinner', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
};

const allergenClues: Record<Exclude<MenuLanguage, 'unknown'>, RegExp> = {
  fi: /^(?:allerg(?:ia|iat|eenit|eeneja)\b|sisältää\b|saattaa sisältää\b)/i,
  sv: /^(?:allerg(?:i|ener)\b|innehåller\b|kan innehålla\b)/i,
  en: /^(?:allerg(?:en|ens)\b|contains\b|may contain\b)/i,
};

export function detectLanguage(value: string): MenuLanguage {
  const sample = value.slice(0, 20_000);
  const scores = (Object.entries(languageModules) as Array<[Exclude<MenuLanguage, 'unknown'>, LanguageModule]>)
    .map(([language, module]) => ({ language, score: module.clues.reduce((score, clue) => score + Number(clue.test(sample)), 0) }))
    .sort((a, b) => b.score - a.score);
  return scores[0]?.score && scores[0].score > (scores[1]?.score || 0) ? scores[0].language : 'unknown';
}

function cleanMenuText(value: string): string {
  if (!value.includes('<')) return value;
  const document = new DOMParser().parseFromString(value, 'text/html');
  document.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach(node => node.remove());
  document.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  document.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,section,article').forEach(node => node.append('\n'));
  return document.body.textContent || '';
}

export function feedText(value: string, contentType: string): string {
  if (/json/i.test(contentType) || /^\s*[\[{]/.test(value)) {
    try {
      const data = JSON.parse(value) as { items?: unknown[]; [key: string]: unknown };
      const items = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
      return items.map(item => {
        if (!item || typeof item !== 'object') return '';
        const fields = item as Record<string, unknown>;
        return ['title', 'name', 'description', 'summary', 'content_text', 'content_html', 'price']
          .map(key => fields[key]).filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
          .map(String).join(' · ');
      }).filter(Boolean).join('\n');
    } catch { /* fall through to HTML/text extraction */ }
  }
  if (/xml|rss|atom/i.test(contentType) || /<(?:rss|feed|channel|item|entry)\b/i.test(value)) {
    const doc = new DOMParser().parseFromString(value, 'application/xml');
    const entries = [...doc.querySelectorAll('item, entry')];
    if (entries.length) return entries.map(entry => {
      const values = ['title', 'description', 'summary', 'content', 'encoded', 'price']
        .map(tag => entry.getElementsByTagName(tag).item(0)?.textContent?.trim())
        .filter((part): part is string => Boolean(part));
      return values.join(' · ');
    }).join('\n');
  }
  return cleanMenuText(value);
}

const menuClues = /\b(lounas|lunch|ruokalista|ruokalistat|menu|meny|dagens|lunchmenu|food menu)\b/i;

export function discoverMenuLinks(html: string, pageUrl: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const page = new URL(pageUrl);
  return [...doc.querySelectorAll('a[href]')]
    .map(anchor => {
      const href = anchor.getAttribute('href') || '';
      const label = `${anchor.textContent || ''} ${href}`.replace(/\s+/g, ' ').trim();
      let url: URL;
      try { url = new URL(href, page); } catch { return null; }
      if (url.protocol !== 'https:' || !(url.hostname === page.hostname || url.hostname.endsWith(`.${page.hostname}`)) || !menuClues.test(label)) return null;
      const score = /lounas|lunch|ruokalista|dagens/i.test(label) ? 2 : 1;
      return { url: url.toString(), score };
    })
    .filter((candidate): candidate is { url: string; score: number } => candidate !== null)
    .sort((a, b) => b.score - a.score)
    .map(candidate => candidate.url)
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 4);
}

export function parseMenu(value: string, language: MenuLanguage): ParsedMenu {
  const lines = cleanMenuText(value).split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found: MenuItem[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const modules = language === 'unknown' ? Object.values(languageModules) : [languageModules[language]];
  const activeLanguage = language === 'unknown' ? 'en' : language;
  let section = '';
  const isAllergenLine = (line: string) => (language === 'unknown' ? Object.values(allergenClues) : [allergenClues[language]]).some(pattern => pattern.test(line));
  const pricePattern = /(?:^|\s)(?:€|\$|£)\s?\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£)/;
  const priceOnlyPattern = /^(?:(?:[A-Z]{1,4}\.\s*|[A-Z]{1,2}\s+){1,4})?(?:(?:€|\$|£)\s*)?\d+(?:[.,]\d{1,2})?\s*(?:€|\$|£)?$/i;
  const isSection = (line: string) => /^(?:coffee|matcha|mochi ice cream)$/i.test(line) || sectionHeadings[activeLanguage].test(line)
    || modules.some(module => module.headings.test(line))
    || sectionLabels[activeLanguage].some(label => label.toLocaleLowerCase() === line.toLocaleLowerCase());
  const codeDefinitionPattern = /\b([A-Z]{1,4})\s*[:=]\s*(gluteeniton|gluten[- ]free|glutenfri|laktoositon|lactose[- ]free|laktosfri|maidoton|dairy[- ]free|mejerifri|vegaan\w*|vegan|vegansk|vegetarian|kasvis(?:ruoka)?)\b/gi;
  const dietCodes = new Map<string, string>();
  for (const line of lines) {
    for (const match of line.matchAll(codeDefinitionPattern)) {
      const term = match[2];
      const label = modules.flatMap(module => module.dietSignals)
        .find(([pattern]) => pattern.test(term))?.[1];
      if (label) dietCodes.set(match[1].toLocaleUpperCase(), label);
    }
  }
  for (const sourceLine of lines) {
    let line = sourceLine;
    if (/^(?:home|about(?: us)?|contact(?: us)?|privacy(?: policy)?|cookies?|accept all|reject all|book(?: a table)?|reservations?|sign in|subscribe|follow us|copyright.*|all rights reserved.*)$/i.test(line)) continue;
    if (line.length < 3 || line.length > 220 || /^https?:\/\//i.test(line)) continue;
    if (isSection(line)) { section = line; continue; }
    const prefixedSection = sectionLabels[activeLanguage]
      .find(label => line.toLocaleLowerCase().startsWith(`${label} `));
    if (prefixedSection) {
      section = line.slice(0, prefixedSection.length).trim();
      line = line.slice(prefixedSection.length).trim();
    }
    if (line.length < 3) continue;
    if (codeDefinitionPattern.test(line) && !pricePattern.test(line)) {
      codeDefinitionPattern.lastIndex = 0;
      continue;
    }
    codeDefinitionPattern.lastIndex = 0;
    const linePrice = line.match(pricePattern)?.[0]?.trim().replace(/\s+/g, ' ') || '';
    if (priceOnlyPattern.test(line)) {
      const last = found[found.length - 1];
      if (last && last.section === section) {
        if (!last.price) last.price = linePrice;
        last.sourceText = `${last.sourceText}\n${sourceLine}`;
        const codedDiets = [...line.matchAll(/\b([A-Z]{1,4})\.?/g)]
          .map(match => dietCodes.get(match[1].toLocaleUpperCase()))
          .filter((label): label is string => Boolean(label));
        last.diets = [...new Set([...last.diets, ...codedDiets])];
      }
      continue;
    }
    const hasAllergenInfo = isAllergenLine(line);
    if (hasAllergenInfo && !pricePattern.test(line)) {
      notes.push(line);
      continue;
    }
    const price = line.match(pricePattern);
    let itemLine = linePrice ? line.replace(linePrice, '').trim() : line;
    const codeDiets: string[] = [];
    const collectCodes = (value: string) => {
      const codes = value.split(/[\s,/]+/).map(code => code.trim().toLocaleUpperCase()).filter(Boolean);
      if (!codes.length || codes.some(code => !dietCodes.has(code))) return false;
      codeDiets.push(...codes.map(code => dietCodes.get(code)!));
      return true;
    };
    let parentheticalCode = itemLine.match(/\(([^()]*)\)\s*$/);
    while (parentheticalCode && collectCodes(parentheticalCode[1])) {
      itemLine = itemLine.slice(0, parentheticalCode.index).trim();
      parentheticalCode = itemLine.match(/\(([^()]*)\)\s*$/);
    }
    const codeSuffix = itemLine.match(/(?:^|\s)((?:[A-Z]{1,4}\s*(?:[,/]\s*[A-Z]{1,4}\s*)+)|(?:[A-Z]{1,4}))$/i);
    if (codeSuffix && collectCodes(codeSuffix[1])) itemLine = itemLine.slice(0, codeSuffix.index).trim();
    const parts = itemLine.split(/\s+[·|—–]\s+|\s{2,}/);
    const name = (parts[0] || itemLine).trim();
    if (name.length < 3 || name.length > 90) continue;
    if (/^(all prices|please inform|we cannot|may contain|allergen information)/i.test(name)) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const diets = [...new Set([...modules.flatMap(module => module.dietSignals.filter(([pattern]) => pattern.test(line)).map(([, label]) => label)), ...codeDiets])];
    const priceText = price?.[0]?.trim().replace(/\s+/g, ' ') || '';
    const description = parts.slice(1).join(' · ').replace(pricePattern, '').trim();
    found.push({ section, name, description, price: priceText, diets, allergenInfo: hasAllergenInfo ? [line] : [], sourceText: sourceLine });
    if (found.length >= 100) break;
  }
  return { items: found, notes };
}

