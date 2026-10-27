import { describe, expect, it } from 'vitest';
import enMenuClassifier from '../public/models/menu-line-classifier.json';
import fiMenuClassifier from '../public/models/menu-line-classifier-fi.json';
import type { MenuClassifier } from './menu-classifier';
import { accordionMenuLines, cleanMenuText, discoverMenuImages, discoverMenuLinks, formatPdfMenuRows, hasMenuEvidence, normalizePdfGlyphSpacing, parseMenu, schemaMenuLines, summarizeMenuItems, tabbedMenuLines } from './MenuAssistant';

describe('structured menu extraction', () => {
  it('extracts named products and prices from generic price-list tables', () => {
    const cell = (textContent: string, tagName: 'TH' | 'TD') => ({ textContent, tagName });
    let tableRows: Array<{ tagName: string; textContent: string; querySelectorAll: (selector: string) => ReturnType<typeof cell>[]; querySelector: (selector: string) => ReturnType<typeof cell> | null; closest: (selector: string) => unknown }> = [];
    const table = { querySelectorAll: (_selector: string) => tableRows };
    const row = (cells: ReturnType<typeof cell>[]) => ({
      tagName: 'TR',
      textContent: cells.map(item => item.textContent).join(' '),
      querySelectorAll: (selector: string) => selector === 'th,td' ? cells : [],
      querySelector: (selector: string) => selector === 'th' ? cells.find(item => item.tagName === 'TH') ?? null : null,
      closest: (selector: string) => selector === 'table' ? table : null,
    });
    const blocks = [
      { tagName: 'H1', textContent: 'Hinnasto' },
      { tagName: 'H2', textContent: 'Liekillä grillatut' },
      row([cell('Tuote', 'TH'), cell('Ateria', 'TH'), cell('Hampurilainen', 'TH')]),
      row([cell('Classic Beef Burger', 'TD'), cell('16,45 €', 'TD'), cell('12,95 €', 'TD')]),
      row([cell('Plant-Based Burger', 'TD'), cell('10,95 €', 'TD'), cell('7,45 €', 'TD')]),
    ];
    tableRows = blocks.filter(block => block.tagName === 'TR') as unknown as typeof tableRows;
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return {
      body: { textContent: '', querySelectorAll: () => blocks },
      querySelectorAll: () => [],
      querySelector: () => null,
    } as unknown as Document; } } as typeof DOMParser;
    let extracted: string;
    try {
      extracted = cleanMenuText('<html><body><table></table></body></html>', 'https://restaurant.example/hinnasto/');
    } finally {
      globalThis.DOMParser = original;
    }
    const parsed = parseMenu(extracted, 'fi', fiMenuClassifier as unknown as MenuClassifier);

    expect(parsed.items.map(item => item.name)).toEqual(['Classic Beef Burger', 'Plant-Based Burger']);
    expect(parsed.items.map(item => item.price)).toEqual(['16,45 €', '10,95 €']);
    expect(parsed.items[0].priceOptions).toEqual([
      { label: 'Ateria', value: '16,45 €' },
      { label: 'Hampurilainen', value: '12,95 €' },
    ]);
    expect(parsed.items[0].sourceText).toBe('Classic Beef Burger · 16,45 € · 12,95 €');
    expect(parsed.items.every(item => item.section === 'Liekillä grillatut')).toBe(true);
  });

  it('summarizes restaurant name, cuisine, and address from official structured metadata', () => {
    const jsonLd = {
      '@type': 'Restaurant', name: 'Example Bistro', description: 'A neighborhood restaurant serving seasonal food.',
      servesCuisine: ['Finnish', 'French'],
      address: { streetAddress: 'Example Street 2', postalCode: '00100', addressLocality: 'Helsinki', addressCountry: 'Finland' },
    };
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return {
      title: 'Example Bistro',
      body: { textContent: '', querySelectorAll: () => [] },
      querySelectorAll: (selector: string) => selector === 'script[type="application/ld+json"]' ? [{ textContent: JSON.stringify(jsonLd) }] : [],
      querySelector: () => null,
    } as unknown as Document; } } as typeof DOMParser;
    let extracted: string;
    try { extracted = cleanMenuText('<html><head></head><body></body></html>', 'https://restaurant.example/'); }
    finally { globalThis.DOMParser = original; }

    const parsed = parseMenu(extracted, 'en', null);
    expect(parsed.restaurantProfile).toEqual({
      name: 'Example Bistro', description: 'A neighborhood restaurant serving seasonal food.',
      cuisine: ['Finnish', 'French'], location: 'Example Street 2, 00100, Helsinki, Finland',
    });
    const menu = parseMenu('menu-section: Burgers\nmenu-schema-item: {"name":"House burger","section":"Burgers","price":"12 €","diets":[],"allergenInfo":[],"sourceText":"House burger 12 €"}\nmenu-section: Salads\nmenu-schema-item: {"name":"Garden salad","section":"Salads","price":"9 €","diets":[],"allergenInfo":[],"sourceText":"Garden salad 9 €"}', 'en', null);
    expect(summarizeMenuItems(menu.items)).toBe('2 menu items across Burgers (1), Salads (1).');
  });

  it('reads priced items from collapsed weekday accordions and ignores unrelated panels', () => {
    const panel = (rows: string[]) => ({
      textContent: rows.join(' '),
      children: rows.map(textContent => ({ textContent })),
      querySelectorAll: (selector: string) => selector === 'p,li,dt,dd,[itemprop="name"]' ? rows.map(textContent => ({ textContent })) : [],
    });
    const menuButton = {
      id: 'fl-accordion-lunch-button-1', textContent: 'Tiistai 27.10.', nextElementSibling: null,
      getAttribute: (_name: string) => null,
    };
    const unrelatedButton = {
      id: 'faq-button-0', textContent: 'Where to find us', nextElementSibling: null,
      getAttribute: (_name: string) => null,
    };
    const menuPanel = panel([
      'Roasted root vegetables with lemon-herb sauce 14,50 €',
      'Creamy mushroom soup with rye bread 12,50 €',
      'Chef tasting plate 19 €',
    ]);
    const unrelatedPanel = panel(['Eteläesplanadi 8', '00130 Helsinki']);
    const document = {
      querySelectorAll: (selector: string) => selector === 'button[aria-expanded],button[id*="-button-"]' ? [menuButton, unrelatedButton] : [],
      getElementById: (id: string) => id === 'fl-accordion-lunch-content-1' ? menuPanel : id === 'faq-content-0' ? unrelatedPanel : null,
    } as unknown as Document;

    const parsed = parseMenu(accordionMenuLines(document).join('\n'), 'fi', null);
    expect(parsed.items.map(item => item.name)).toEqual([
      'Roasted root vegetables with lemon-herb sauce',
      'Creamy mushroom soup with rye bread',
      'Chef tasting plate',
    ]);
  });

  it('restores PDF headings and attaches priced descriptions to their dish', () => {
    const lines = formatPdfMenuRows([
      [{ x: 273, text: 'P O K E' }, { x: 345, text: 'B O W L' }],
      [{ x: 183, text: 'C H I C K E N' }, { x: 243, text: 'P O K E' }, { x: 281, text: 'B O W L' }],
      [{ x: 183, text: 'Chicken, Rice, Carrots, Cucumber, Edamame, Seaweed, Salad // 12,50' }],
    ], 595);
    expect(lines[0]).toBe('menu-section: POKE BOWL');
    expect(lines[1]).toMatch(/^menu-schema-item: /);
    expect(parseMenu(lines.join('\n'), 'en', null).items[0]).toMatchObject({
      section: 'POKE BOWL',
      name: 'CHICKEN POKE BOWL',
      price: '12,50',
      description: 'Chicken, Rice, Carrots, Cucumber, Edamame, Seaweed, Salad',
    });
  });

  it('rejoins spaced PDF glyphs without changing ordinary menu text', () => {
    expect(normalizePdfGlyphSpacing('C H I C K E N P O K E B O W L')).toBe('CHICKENPOKEBOWL');
    expect(normalizePdfGlyphSpacing('D R I N K & F O O D')).toBe('DRINK & FOOD');
    expect(normalizePdfGlyphSpacing('R I C H I E ’ S')).toBe('RICHIE’S');
    expect(normalizePdfGlyphSpacing('Chicken, Rice, Carrots // 12,50')).toBe('Chicken, Rice, Carrots // 12,50');
  });

  it('discovers same-site menu PDFs while excluding unrelated documents and images', () => {
    const html = '<a href="/files/lunch-menu.pdf">Lunch menu</a><a href="/privacy.pdf">Privacy policy</a><a href="/lunch.jpg">Lunch menu image</a><a href="https://other.fi/menu.pdf">Menu</a>';
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return {
      querySelectorAll: () => [
        { textContent: 'Lunch menu', getAttribute: (key: string) => key === 'href' ? '/files/lunch-menu.pdf' : null },
        { textContent: 'Privacy policy', getAttribute: (key: string) => key === 'href' ? '/privacy.pdf' : null },
        { textContent: 'Lunch menu image', getAttribute: (key: string) => key === 'href' ? '/lunch.jpg' : null },
        { textContent: 'Menu', getAttribute: (key: string) => key === 'href' ? 'https://other.fi/menu.pdf' : null },
      ],
    } as unknown as Document; } } as typeof DOMParser;
    try {
      expect(discoverMenuLinks(html, 'https://restaurant.example/')).toEqual(['https://restaurant.example/files/lunch-menu.pdf']);
    } finally {
      globalThis.DOMParser = original;
    }
  });

  it('discovers a same-site price-list page from generic Finnish labels', () => {
    const html = '<a href="/tuotteet/">Tuotteet</a><a href="/hinnasto/">Hinnasto</a><a href="/privacy/">Privacy</a>';
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return {
      querySelectorAll: () => [
        { textContent: 'Tuotteet', getAttribute: (key: string) => key === 'href' ? '/tuotteet/' : null },
        { textContent: 'Hinnasto', getAttribute: (key: string) => key === 'href' ? '/hinnasto/' : null },
        { textContent: 'Privacy', getAttribute: (key: string) => key === 'href' ? '/privacy/' : null },
      ],
    } as unknown as Document; } } as typeof DOMParser;
    try {
      expect(discoverMenuLinks(html, 'https://restaurant.example/')).toContain('https://restaurant.example/hinnasto/');
    } finally {
      globalThis.DOMParser = original;
    }
  });

  it('cleans prices repeated in structured item names and attaches dotted codes to the dish', () => {
    const menu = {
      '@type': 'Menu',
      hasMenuItem: [
        { '@type': 'MenuItem', name: 'Berry tart with cream - 6.2€', price: '6.2€' },
        { '@type': 'MenuItem', name: 'Raspberry rice cake', price: '4.8€' },
        { '@type': 'MenuItem', name: 'L. G. 4.8€', price: '4.8€' },
        { '@type': 'MenuItem', name: 'Raspberry pastry -', price: '5.9€' },
      ],
    };
    const lines = schemaMenuLines({ querySelectorAll: () => [{ textContent: JSON.stringify(menu) }] } as unknown as Document);
    const parsed = parseMenu(lines.join('\n'), 'en', null);

    expect(parsed.items.map(item => [item.name, item.price])).toEqual([
      ['Berry tart with cream', '6.2€'],
      ['Raspberry rice cake', '4.8€'],
      ['Raspberry pastry', '5.9€'],
    ]);
    expect(parsed.items[0].sourceText).toContain('Berry tart with cream - 6.2€');
    expect(parsed.items[1].dietaryInfo).toEqual(['L. G.']);
  });

  it('preserves semantic menu sections and skips the category index below a menu title', () => {
    const block = (tagName: string, textContent: string) => ({ tagName, textContent });
    const blocks = [
      block('H1', 'Our Menus'),
      block('P', 'Pastries'),
      block('P', 'Frozen Desserts'),
      block('P', 'Tea Drinks'),
      block('P', 'Sandwiches'),
      block('P', 'Coffee & Others'),
      block('H2', 'Tea Drinks'),
      block('H4', 'Spiced Tea Latte'),
      block('P', '5.9€'),
      block('H2', 'Frozen Desserts'),
      block('H4', 'Raspberry Rice Cake'),
      block('P', '4.8€'),
      block('H1', 'Pastries'),
      block('H2', 'Coffee & Others'),
      block('H4', 'Filter coffee 3.6€ Double espresso 3.9€ Espresso macchiato 4.3€'),
    ];
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return {
      body: { textContent: '', querySelectorAll: () => blocks },
      querySelectorAll: () => [],
      querySelector: () => null,
    } as unknown as Document; } } as typeof DOMParser;
    let extracted: string;
    try {
      extracted = cleanMenuText('<html></html>', 'https://restaurant.example/menu/');
    } finally {
      globalThis.DOMParser = original;
    }
    const parsed = parseMenu(extracted, 'en', null);

    expect(extracted).toContain('menu-section: Tea Drinks');
    expect(extracted).toContain('menu-section: Frozen Desserts');
    expect(extracted).toContain('menu-section: Coffee & Others');
    expect(extracted).not.toContain('menu-section: Our Menus');
    expect(parsed.items.map(item => item.name)).not.toContain('Pastries');
    expect(parsed.items.map(item => item.name)).not.toContain('Tea Drinks');
    expect(parsed.items.map(item => item.name)).not.toContain('Sandwiches');
    expect(parsed.items.map(item => item.name)).not.toContain('Coffee & Others');
    expect(parsed.items.map(item => [item.section, item.name])).toEqual([
      ['Tea Drinks', 'Spiced Tea Latte'],
      ['Frozen Desserts', 'Raspberry Rice Cake'],
      ['Coffee & Others', 'Filter coffee'],
      ['Coffee & Others', 'Double espresso'],
      ['Coffee & Others', 'Espresso macchiato'],
    ]);
    expect(parsed.items.map(item => item.price)).toEqual(['5.9€', '4.8€', '3.6€', '3.9€', '4.3€']);
  });

  it('extracts dishes from a mixed lunch-and-dinner homepage without listing restaurant copy', () => {
    const block = (tagName: string, textContent: string) => ({ tagName, textContent });
    const blocks = [
      block('H2', 'Restaurant location'),
      block('H3', 'Lounas maanantaista perjantaihin klo 10–14'),
      block('H4', 'Lounaslista'),
      block('H5', 'Tiistai 27.10.Expand'),
      block('P', 'Paistettua kirjolohta ja perunaa 14,50 €'),
      block('P', 'Ravintola tarjoaa kiireiseen päivään sopivan lounaan.'),
      block('H3', 'À la carte dinner'),
      block('P', 'Valitse omat annoksesi alla olevista vaihtoehdoista.'),
      block('H4', 'Alkuruoat'),
      block('P', 'Roasted beet salad 14 €'),
      block('H2', 'Yksityistilaisuudet Albertinkadulla'),
      block('P', 'Tapahtumat suunnitellaan asiakkaan tarpeiden mukaan.'),
      block('H2', 'Tarinamme'),
      block('P', 'Hyvä ruoka tuo ihmiset yhteen.'),
      block('H2', 'Ravintolan arvot'),
      block('H3', 'Yhdenvertaisuus'),
      block('P', 'Kaikki ovat tervetulleita yhteiseen pöytään.'),
    ];
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return {
      body: { textContent: '', querySelectorAll: () => blocks },
      querySelectorAll: () => [],
      querySelector: () => null,
    } as unknown as Document; } } as typeof DOMParser;
    let extracted: string;
    try {
      extracted = cleanMenuText('<html></html>', 'https://restaurant.example/');
    } finally {
      globalThis.DOMParser = original;
    }

    const parsed = parseMenu(extracted, 'fi', null);
    expect(parsed.items.map(item => item.name)).toEqual([
      'Paistettua kirjolohta ja perunaa',
      'Roasted beet salad',
    ]);
    expect(parsed.items.some(item => /lounaslista|tiistai|tarinamme|arvot|yksityistilaisuudet|ravintola tarjoaa/i.test(item.name))).toBe(false);
  });

  it('attaches a dotted dietary-code price line to the preceding item', () => {
    const parsed = parseMenu('menu-section: Frozen Treats\nBerry Rice Cake\nL. G. 4.8€', 'en', null);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      name: 'Berry Rice Cake',
      price: '4.8€',
      dietaryInfo: ['L. G.'],
    });
    expect(parsed.items[0].sourceText).toContain('L. G. 4.8€');
  });

  it('keeps generic menu navigation labels out of the item list and attaches the printed dietary code', () => {
    const block = (tagName: string, textContent: string) => ({ tagName, textContent });
    const blocks = [
      block('H1', 'Our Menus'),
      block('P', 'Baked Goods'),
      block('P', 'Frozen Treats'),
      block('P', 'Tea Drinks'),
      block('P', 'Sandwiches'),
      block('P', 'Coffee & Others'),
      block('H2', 'Frozen Treats'),
      block('H4', 'Berry Rice Cake'),
      block('P', 'L. G. 4.8€'),
    ];
    const original = globalThis.DOMParser;
    globalThis.DOMParser = class { parseFromString() { return {
      body: { textContent: '', querySelectorAll: () => blocks },
      querySelectorAll: () => [],
      querySelector: () => null,
    } as unknown as Document; } } as typeof DOMParser;
    let extracted: string;
    try {
      extracted = cleanMenuText('<html></html>', 'https://restaurant.example/menu/');
    } finally {
      globalThis.DOMParser = original;
    }
    const parsed = parseMenu(extracted, 'en', null);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      section: 'Frozen Treats',
      name: 'Berry Rice Cake',
      price: '4.8€',
      dietaryInfo: ['L. G.'],
    });
    expect(parsed.items[0].sourceText).toContain('L. G. 4.8€');
  });

  it('keeps restaurant location, opening-hours, address, and story copy out of the menu items', () => {
    const parsed = parseMenu([
      'A good moment is a good meal.',
      'Example Bistro Ma-Pe 11-14 / La 16-23',
      'menu-section: Example Bistro',
      'Harbor Road 8',
      '00130 Helsinki',
      '+358 9 123 4567',
      'menu-section: Lunch Monday to Friday 11:00–14:00',
      'menu-section: Friday 27.10.',
      'Roasted root vegetables with lemon-herb sauce 14,50 €',
      'menu-section: Private events',
      'Our story',
      'menu-section: Our story',
      'We create a welcoming place to share good food.',
    ].join('\n'), 'fi', null);

    expect(parsed.items.map(item => item.name)).toEqual([
      'Roasted root vegetables with lemon-herb sauce',
    ]);
  });

  it('keeps priced foreign-language dishes when the page language model rejects them', () => {
    const fiClassifier = fiMenuClassifier as MenuClassifier;
    const enClassifier = enMenuClassifier as MenuClassifier;
    const line = 'Roasted salmon with herb potatoes 17 €';
    const parsedWithSecondary = parseMenu(line, 'fi', fiClassifier, {
      secondaryClassifiers: [enClassifier],
      mixedLanguage: true,
    });
    const parsedWhenSecondaryIsUnavailable = parseMenu(line, 'fi', fiClassifier, {
      mixedLanguage: true,
      missingSecondaryClassifier: true,
    });
    const unrelated = parseMenu('Päivän lounas julkaistaan aamulla', 'fi', fiClassifier, {
      secondaryClassifiers: [enClassifier],
      mixedLanguage: true,
    });

    expect(parsedWithSecondary.items.map(item => item.name)).toContain('Roasted salmon with herb potatoes');
    expect(parsedWhenSecondaryIsUnavailable.items.map(item => item.name)).toContain('Roasted salmon with herb potatoes');
    expect(unrelated.items).toHaveLength(0);
  });

  it('filters page noise from structured menu entries and keeps a menu item', () => {
    const structured = (name: string, section = '', price = '') => `menu-schema-item: ${JSON.stringify({
      name, section, description: '', price, diets: [], allergenInfo: [], sourceText: [name, price].filter(Boolean).join(' · '),
    })}`;
    const page = [
      structured('Example Bistro'),
      structured('Reserve a table'),
      structured('Purchase a gift card'),
      structured('Private events'),
      structured('Our values'),
      structured('Lihapullat ja perunamuusi', 'Pääruoat', '12 €'),
    ].join('\n');

    const parsed = parseMenu(page, 'fi', fiMenuClassifier as MenuClassifier);

    expect(parsed.items.map(item => item.name)).toEqual([
      'Lihapullat ja perunamuusi',
    ]);
  });

  it('does not trust bare Schema.org labels or cross-language category headings as dishes', () => {
    const structured = (name: string) => `menu-schema-item: ${JSON.stringify({
      name, section: '', description: '', price: '', diets: [], allergenInfo: [], sourceText: name,
    })}`;
    const page = ['Example Bistro', 'Example Bistro Downtown', 'Reserve a table', 'Our values', 'Starters', 'Mains', 'Desserts', 'Sparkling']
      .map(structured).join('\n');

    expect(parseMenu(page, 'fi', null).items).toEqual([]);
  });

  it('removes a trailing separator left before a compact menu price', () => {
    const parsed = parseMenu('Berry tart with cream - 4.8€', 'en', null);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      name: 'Berry tart with cream',
      price: '4.8€',
    });
  });

  it('rejects generic restaurant home-page copy as menu results while accepting menu evidence', () => {
    const homePage = [
      'BAKERY', 'PASTRIES', 'TEA', 'COFFEE', 'A little treat makes the day', 'Baking The Difference',
      'Fresh pastries', 'Frozen desserts', 'Welcome to Example Bistro',
      'A good meal is better when shared with friends.',
      'Experience Us Everywhere', 'Catering', 'Online order', 'Workshops',
      'Made-to-Order Solutions', 'Example Street 12, 00100 Helsinki',
      '+358 9 123 4567', 'Mon-Fri. 11-20 Sat. 11-19 Sun. 12-18',
    ].join('\n');
    const homepageItems = parseMenu(homePage, 'unknown', null).items;

    expect(homepageItems.length).toBeGreaterThan(0);
    expect(hasMenuEvidence(homePage, 'https://restaurant.example/', homepageItems)).toBe(false);

    const promotionOnly = [{
      section: 'Limited-time offer', name: 'Sandwich promotion', description: '', price: '', diets: [],
      allergenInfo: [], imageUrl: 'https://restaurant.example/promotion.jpg', sourceText: 'Sandwich promotion',
    }];
    expect(hasMenuEvidence('Promotion heading\nSandwich promotion', 'https://restaurant.example/', promotionOnly)).toBe(false);

    const menuText = 'Lunch\nRoasted vegetable bowl';
    const menuItems = parseMenu(menuText, 'en', null).items;
    expect(hasMenuEvidence(menuText, 'https://restaurant.example/', menuItems)).toBe(true);
    expect(hasMenuEvidence('Roasted vegetable bowl', 'https://restaurant.example/menu', menuItems)).toBe(true);
    expect(hasMenuEvidence('House burger 10,95 €', 'https://restaurant.example/prices/', menuItems)).toBe(true);
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

it('expands inline diet-code legends only when the same page defines them', () => {
  const parsed = parseMenu([
    'menu-section: Pääruoat',
    'G = Gluteeniton · L = Laktoositon · VEG: Kasvis · V: Vegaani',
    'Kuhakeitto (L, G)',
    'Kasvisrisotto (VEG)',
    'Vegaaninen keitto (V)',
  ].join('\n'), 'fi', null);

  expect(parsed.items.map(item => item.name)).toEqual([
    'Kuhakeitto',
    'Kasvisrisotto',
    'Vegaaninen keitto',
  ]);
  expect(parsed.items[0].diets).toEqual(expect.arrayContaining(['Marked gluten-free', 'Marked lactose-free']));
  expect(parsed.items[1].diets).toContain('Marked vegetarian');
  expect(parsed.items[2].diets).toContain('Marked vegan');

  const unexplained = parseMenu('menu-section: Pääruoat\nKuhakeitto (L, G)', 'fi', null);
  expect(unexplained.items[0].diets).toEqual([]);
  expect(unexplained.items[0].dietaryInfo).toEqual(['L+G']);
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

it('keeps a general Finnish allergen-help notice as a menu note, not a dish', () => {
  const parsed = parseMenu([
    'Päivän lounas',
    'Kermainen lohikeitto',
    'Henkilökuntamme auttaa mielellään allergeeneihin ja raaka-aineisiin liittyvissä kysymyksissä.',
  ].join('\n'), 'fi', null);

  expect(parsed.items.map(item => item.name)).toEqual(['Kermainen lohikeitto']);
  expect(parsed.notes).toContain('Henkilökuntamme auttaa mielellään allergeeneihin ja raaka-aineisiin liittyvissä kysymyksissä.');
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
