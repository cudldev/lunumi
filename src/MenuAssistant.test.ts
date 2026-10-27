import { describe, expect, it } from 'vitest';
import { cleanMenuText, discoverMenuImages, discoverMenuLinks, hasMenuEvidence, parseMenu, schemaMenuLines, tabbedMenuLines } from './MenuAssistant';

describe('structured menu extraction', () => {
  it('rejects generic restaurant home-page copy as menu results while accepting menu evidence', () => {
    const homePage = [
      'DONUT', 'MOCHI', 'MATCHA', 'COFFEE', 'Love you so Mochi', 'Baking The Difference',
      'Mochi Donut', 'Mochi Ice Cream', 'Welcome toMOMOCHI',
      'There is nothing better than a friend unless it is a friend with mochi.',
      'Experience Us Everywhere', 'Catering', 'Online order', 'Workshops',
      'Made-to-Order Solutions', 'Forum Store', 'Mannerheimintie 20, 00100 Helsinki',
      '050 554 3300', 'Mon-Fri. 11-20Sat. 11-19Sun. 12-18',
    ].join('\n');
    const homepageItems = parseMenu(homePage, 'unknown', null).items;

    expect(homepageItems.length).toBeGreaterThan(0);
    expect(hasMenuEvidence(homePage, 'https://momochi.fi/', homepageItems)).toBe(false);

    const menuText = 'Lunch\nRoasted vegetable bowl';
    const menuItems = parseMenu(menuText, 'en', null).items;
    expect(hasMenuEvidence(menuText, 'https://restaurant.example/', menuItems)).toBe(true);
    expect(hasMenuEvidence('Roasted vegetable bowl', 'https://restaurant.example/menu', menuItems)).toBe(true);
  });

  it('reads Schema.org menu items, section, image, price, explicit diet, and allergen metadata', () => {
    const menu = {
      '@type': 'Menu',
      hasMenuSection: [{
        '@type': 'MenuSection',
        name: 'Lunch',
        hasMenuItem: [{
          '@type': 'MenuItem',
          name: 'Roasted vegetable bowl',
          description: 'Root vegetables with tahini dressing.',
          ingredients: ['root vegetables', 'tahini', 'lemon'],
          image: 'https://restaurant.example/images/bowl.jpg',
          suitableForDiet: 'https://schema.org/VeganDiet',
          offers: { '@type': 'Offer', price: '12.90', priceCurrency: 'EUR' },
          additionalProperty: [{ '@type': 'PropertyValue', name: 'Allergens', value: 'Sesame' }],
        }],
      }],
    };
    const fakeDocument = {
      querySelectorAll: () => [{ textContent: JSON.stringify(menu) }],
    } as unknown as Document;

    const lines = schemaMenuLines(fakeDocument, 'https://restaurant.example/menu');
    const parsed = parseMenu(lines.join('\n'), 'en', null);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      section: 'Lunch',
      name: 'Roasted vegetable bowl',
      description: 'Root vegetables with tahini dressing.',
      price: '12.90 EUR',
      imageUrl: 'https://restaurant.example/images/bowl.jpg',
      diets: ['Marked vegan'],
      allergenInfo: ['Sesame'],
      ingredients: ['root vegetables', 'tahini', 'lemon'],
    });
    expect(parsed.items[0].sourceText).toContain('VeganDiet');
  });

  it('ignores unsafe image hosts and retains supported menu text without inventing a currency', () => {
    const menu = {
      '@type': 'Menu',
      hasMenuItem: [{
        '@type': 'MenuItem',
        name: 'Fish soup',
        image: 'https://images.example/soup.jpg',
        offers: { price: '10.50' },
      }],
    };
    const fakeDocument = { querySelectorAll: () => [{ textContent: JSON.stringify(menu) }] } as unknown as Document;

    const parsed = parseMenu(schemaMenuLines(fakeDocument, 'https://restaurant.example/menu').join('\n'), 'en', null);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].price).toBe('10.50');
    expect(parsed.items[0].imageUrl).toBeUndefined();
  });

  it('recognizes Finnish menu sections even when language detection is uncertain', () => {
    const parsed = parseMenu('Hampurilaiset\nKanahampurilainen\nKampanjat\nLounasburgeri', 'unknown', null);

    expect(parsed.items.map(item => [item.section, item.name])).toEqual([
      ['Hampurilaiset', 'Kanahampurilainen'],
      ['Kampanjat', 'Lounasburgeri'],
    ]);
  });

  it('attaches separate explicit diet and allergen lines to the immediately preceding dish', () => {
    const parsed = parseMenu('Chicken soup\nGluten-free\nContains sesame', 'unknown', null);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      name: 'Chicken soup',
      diets: ['Marked gluten-free'],
      allergenInfo: ['Contains sesame'],
    });
    expect(parsed.items[0].sourceText).toContain('Gluten-free');
    expect(parsed.items[0].sourceText).toContain('Contains sesame');
    expect(parsed.notes).toHaveLength(0);
  });

  it('extracts explicitly labeled ingredients without inferring diet or allergen safety', () => {
    const parsed = parseMenu('Fish pie\nIngredients: cod, potatoes, milk', 'en', null);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].ingredients).toEqual(['cod, potatoes, milk']);
    expect(parsed.items[0].diets).toEqual([]);
    expect(parsed.items[0].allergenInfo).toEqual([]);
  });

  it('discovers likely same-site menu pages and ignores external and unrelated links', () => {
    const anchors = [
      { textContent: 'Lunch menu', getAttribute: (name: string) => name === 'href' ? '/lunch' : null },
      { textContent: 'Menu', getAttribute: (name: string) => name === 'href' ? '/menu' : null },
      { textContent: 'Menu', getAttribute: (name: string) => name === 'href' ? 'https://other.example/menu' : null },
      { textContent: 'Contact', getAttribute: (name: string) => name === 'href' ? '/contact' : null },
    ] as unknown as HTMLAnchorElement[];
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return { querySelectorAll: () => anchors } as unknown as Document; } } as typeof DOMParser;
    try {
      expect(discoverMenuLinks('<html><body></body></html>', 'https://restaurant.example/'))
        .toEqual(['https://restaurant.example/lunch', 'https://restaurant.example/menu']);
    } finally {
      globalThis.DOMParser = original;
    }
  });

  it('discovers menu images from same-site image links only', () => {
    const image = {
      textContent: '',
      closest: () => null,
      getAttribute: (name: string) => name === 'src' ? '/assets/lunch-menu.png' : name === 'alt' ? 'Lunch menu' : null,
    };
    const externalImage = {
      textContent: '',
      closest: () => null,
      getAttribute: (name: string) => name === 'src' ? 'https://other.example/menu.png' : name === 'alt' ? 'Menu' : null,
    };
    const anchor = {
      textContent: 'Lunch menu image',
      getAttribute: (name: string) => name === 'href' ? '/assets/daily-menu.jpg' : null,
    };
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return {
      querySelectorAll: (selector: string) => selector.startsWith('img') ? [image, externalImage] : [anchor],
    } as unknown as Document; } } as typeof DOMParser;
    try {
      expect(discoverMenuImages('<html><body></body></html>', 'https://restaurant.example/'))
        .toEqual(['https://restaurant.example/assets/daily-menu.jpg', 'https://restaurant.example/assets/lunch-menu.png']);
    } finally {
      globalThis.DOMParser = original;
    }
  });
});


it('separates a Finnish category prefix from the dish and preserves source evidence', () => {
  const parsed = parseMenu('HAMPURILAISET Kerroshampurilainen\nSALAATIT Kanasalaatti', 'unknown', null);
  expect(parsed.items.map(item => [item.section, item.name])).toEqual([
    ['HAMPURILAISET', 'Kerroshampurilainen'],
    ['SALAATIT', 'Kanasalaatti'],
  ]);
  expect(parsed.items[0].sourceText).toBe('HAMPURILAISET Kerroshampurilainen');
});

it('keeps Finnish lunch dishes and source dietary codes while dropping page metadata', () => {
  const pageText = [
    '020 123 4567', 'Ma – Pe 11.00 – 13.30', '19. – 23.10.2026',
    'Lounas – viikko 43', 'Maanantai Ma', 'Lounasbuffet', '13,70 €',
    'Pääruoaksi', 'Kasvispihvi kirjolohilisäkkeellä',
    'Allergeenit: Kala ja maito',
    'Ravintoarvot (100 g): 100 kcal energiaa', 'Hiilijalanjälki: 0.1 kg',
    'Ainesosat: Kasviksia, kirjolohta, kermaa', 'A, G, L, M',
    'Pääruoan kaveriksi', 'Paahdetut juurekset', 'G, L, VEG',
  ].join('\n');
  const parsed = parseMenu(pageText, 'fi', null);

  expect(parsed.items.map(item => [item.section, item.name])).toEqual([
    ['Pääruoaksi', 'Kasvispihvi kirjolohilisäkkeellä'],
    ['Pääruoan kaveriksi', 'Paahdetut juurekset'],
  ]);
  expect(parsed.items[0]).toMatchObject({
    allergenInfo: ['Allergeenit: Kala ja maito'],
    ingredients: ['Kasviksia, kirjolohta, kermaa'],
    dietaryInfo: ['A, G, L, M'],
  });
  expect(parsed.items[1].dietaryInfo).toEqual(['G, L, VEG']);
  expect(parsed.items[0].diets).toEqual([]);
  expect(parsed.items[0].sourceText).toContain('A, G, L, M');
  expect(parsed.notes).toContain('Lounasbuffet: 13,70 €');
});

it('extracts daily dishes from weekday menu blocks and expands only source-listed dietary codes', () => {
  type FakeNode = { nodeType: number; textContent: string; tagName: string; children: FakeNode[]; childNodes: FakeNode[]; nextElementSibling?: FakeNode; closest: () => null; matches: (selector: string) => boolean; querySelectorAll: (selector: string) => FakeNode[] };
  const node = (textContent: string, tagName = 'DIV', children: FakeNode[] = []): FakeNode => ({
    nodeType: 1, textContent, tagName, children, childNodes: children, closest: () => null,
    matches: (selector: string) => selector.split(',').some(tag => tag.trim().toUpperCase() === tagName),
    querySelectorAll: (selector: string) => selector === 'p,li,dt,dd,div,span' ? children : [],
  });
  const textNode = (text: string): FakeNode => ({
    nodeType: 3, textContent: text, tagName: '#text', children: [], childNodes: [], closest: () => null,
    matches: () => false, querySelectorAll: () => [],
  });
  const leaves = ['L', 'Laktoositon', 'G', 'Gluteeniton', 'VE', 'Vegaaninen', 'M', 'Maidoton', 'VS', 'Sis. valkosipulia']
    .map(text => node(text, 'SPAN'));
  const longDish = 'Draculan verenpunaiset pariloituja kotimaisia naudan ulkofile lehtipihvejä punaviini-BBQ-glaseerauksella (M+G), noidan salaperäistä maustevoita (L+G+VS) ja rapeita lohkoperunoita (L+G+VS)';
  const dayHeading = node('Tiistai 27.10.2026', 'H3');
  const ordinal = node('3', 'H3');
  const menuBlock = node(`Tom Yam -rapukeitto (M+G+VS)\nSiirappipaahdettuja bataattilohkoja ja tofua (VE+G)\n${longDish}`, 'P');
  menuBlock.childNodes = [textNode('Tom Yam -rapukeitto (M+G+VS)'), node('', 'BR'), textNode('Siirappipaahdettuja bataattilohkoja ja tofua (VE+G)'), node('', 'BR'), textNode(longDish)];
  const englishHeading = node('Tuesday 27.10.2026', 'H3');
  const englishOrdinal = node('3', 'H3');
  const englishBlock = node('Tom Yum shrimp soup (M+G+VS)', 'P');
  englishBlock.childNodes = [textNode('Tom Yum shrimp soup (M+G+VS)')];
  dayHeading.nextElementSibling = ordinal;
  ordinal.nextElementSibling = menuBlock;
  menuBlock.nextElementSibling = englishHeading;
  englishHeading.nextElementSibling = englishOrdinal;
  englishOrdinal.nextElementSibling = englishBlock;
  const main = {
    textContent: 'Lounas Tiistai 27.10.2026 Tom Yam -rapukeitto Gluteeniton Tuesday 27.10.2026 Tom Yum shrimp soup',
    querySelectorAll: (selector: string) => selector.startsWith('h1,h2,h3')
      ? [dayHeading, englishHeading]
      : selector === 'p,li,dt,dd,div,span' ? leaves : [],
  };
  const originalParser = globalThis.DOMParser;
  globalThis.DOMParser = class { parseFromString() { return {
    body: main,
    querySelector: (selector: string) => selector.includes('main') ? main : null,
    querySelectorAll: () => [],
  } as unknown as Document; } } as typeof DOMParser;
  let extracted: string;
  try {
    extracted = cleanMenuText('<html></html>', 'https://factorykamppi.com/lounas/');
  } finally {
    globalThis.DOMParser = originalParser;
  }
  const parsed = parseMenu(extracted, 'fi', null);

  expect(extracted).toContain('Tom Yam -rapukeitto (M+G+VS)');
  expect(extracted).not.toContain('Tom Yum shrimp soup');
  expect(parsed.items.map(item => [item.section, item.name])).toEqual([
    ['Tiistai 27.10.2026', 'Tom Yam -rapukeitto'],
    ['Tiistai 27.10.2026', 'Siirappipaahdettuja bataattilohkoja ja tofua'],
    ['Tiistai 27.10.2026', 'Draculan verenpunaiset pariloituja kotimaisia naudan ulkofile lehtipihvejä punaviini-BBQ-glaseerauksella, noidan salaperäistä maustevoita ja rapeita lohkoperunoita'],
  ]);
  expect(parsed.items[0]).toMatchObject({
    dietaryInfo: ['M+G+VS'],
    diets: ['Marked dairy-free', 'Marked gluten-free', 'Marked contains garlic'],
    sourceText: 'Tom Yam -rapukeitto (M+G+VS)',
  });
  expect(parsed.items[1].diets).toEqual(['Marked vegan', 'Marked gluten-free']);
  expect(parsed.items[2].sourceText).toBe(longDish);
  expect(parsed.items[2].dietaryInfo).toEqual(['M+G', 'L+G+VS']);
});

it('drops Finnish restaurant page status and upload-form text instead of showing it as dishes', () => {
  const pageText = [
    'Voimassa 26.10. – 1.11.',
    'Ei lounasta tälle päivälle',
    'Mennyt lounas',
    'Voit liittää enintään kolme tiedostoa (kuva tai PDF, max 10 Mt / tiedosto).',
    'Kiitos palautteestasi!',
    'Päivän lounas',
    'Kermainen lohikeitto',
  ].join('\n');

  const parsed = parseMenu(pageText, 'fi', null);

  expect(parsed.items.map(item => item.name)).toEqual(['Kermainen lohikeitto']);
  expect(parsed.items[0].section).toBe('Päivän lounas');
});

it('treats Finnish children-menu category labels as sections, not dishes', () => {
  const parsed = parseMenu('PÄÄRUOAT Lastenruoat', 'fi', null);

  expect(parsed.items).toEqual([]);
});

it('extracts only the selected menu tab and its dish details', () => {
  const element = (tagName: string, textContent: string, querySelector: (selector: string) => unknown = () => null, querySelectorAll: (selector: string) => unknown[] = () => []) => ({
    tagName, textContent, querySelector, querySelectorAll, id: '', getAttribute: (_name: string) => null as string | null,
  });
  const button = element('BUTTON', 'Roasted root bowl');
  const fields = ['A, G, VL, VEG', 'Allergeenit: Selleri', 'Ainesosat: Juureksia, selleriä']
    .map(text => element('P', text));
  const row = element('LI', 'Roasted root bowl A, G, VL, VEG', selector => selector.includes('button') ? button : null,
    selector => selector === 'p' || selector === 'p, span, div' ? fields : []);
  const itemList = element('UL', '', () => null, () => []);
  Object.defineProperty(itemList, 'children', { value: [row] });
  const title = element('DIV', 'Main dishes');
  const category = element('LI', '', selector => selector === ':scope > .option-title' ? title : selector === ':scope > ul' ? itemList : null);
  const visiblePanel = element('SECTION', '', () => null, selector => selector === 'li' ? [category] : []);
  Object.defineProperty(visiblePanel, 'id', { value: 'panel-Friday' });
  visiblePanel.getAttribute = name => name === 'aria-hidden' ? 'false' : null;
  const hiddenPanel = element('SECTION', '', () => null, () => []);
  Object.defineProperty(hiddenPanel, 'id', { value: 'panel-Monday' });
  hiddenPanel.getAttribute = name => name === 'aria-hidden' ? 'true' : null;
  const unrelatedSelectedTab = { getAttribute: (name: string) => name === 'aria-controls' ? 'cookie-consent' : name === 'aria-selected' ? 'true' : null };
  const selectedTab = { getAttribute: (name: string) => name === 'aria-controls' ? 'panel-Friday' : name === 'aria-selected' ? 'true' : null };
  const document = {
    querySelectorAll: (selector: string) => selector.includes('[id^="panel-"]') ? [hiddenPanel, visiblePanel] : selector.includes('[aria-controls]') ? [unrelatedSelectedTab, selectedTab] : [],
  } as unknown as Document;

  const parsed = parseMenu(tabbedMenuLines(document).join('\n'), 'en', null);
  expect(parsed.items).toHaveLength(1);
  expect(parsed.items[0]).toMatchObject({
    section: 'Main dishes',
    name: 'Roasted root bowl',
    dietaryInfo: ['A, G, VL, VEG'],
    ingredients: ['Juureksia, selleriä'],
    allergenInfo: ['Allergeenit: Selleri'],
  });
});
