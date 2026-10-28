import { describe, expect, it } from 'vitest';
import { feedText, parseMenu } from './menu-data';

describe('parseMenu', () => {
  it('separates a Finnish section heading joined to its first dish', () => {
    const result = parseMenu(
      'KAMPANJAT Hot hani -kanafilehampurilainen\nHAMPURILAISET Kerroshampurilainen\nSALAATIT Kanasalaatti\nJUOMAT Kahvi',
      'fi',
    );

    expect(result.items.map(({ section, name }) => ({ section, name }))).toEqual([
      { section: 'KAMPANJAT', name: 'Hot hani -kanafilehampurilainen' },
      { section: 'HAMPURILAISET', name: 'Kerroshampurilainen' },
      { section: 'SALAATIT', name: 'Kanasalaatti' },
      { section: 'JUOMAT', name: 'Kahvi' },
    ]);
    expect(result.items[1].sourceText).toBe('HAMPURILAISET Kerroshampurilainen');
  });

  it('only labels dietary claims explicitly present in the item text', () => {
    const result = parseMenu('PÄÄRUOAT\nVEKE®-kasviskerroshampurilainen\nKasvisruoka falafelilla', 'fi');

    expect(result.items[0].diets).toEqual([]);
    expect(result.items[1].diets).toContain('Marked vegetarian');
  });

  it('attaches price and dietary-code rows to the preceding item', () => {
    const result = parseMenu(
      'Matcha\nMatcha Latte\n5.9€\nMochi Ice Cream\nStrawbry Mochi\nL. G. 4.8€',
      'en',
    );

    expect(result.items.map(({ section, name, price }) => ({ section, name, price }))).toEqual([
      { section: 'Matcha', name: 'Matcha Latte', price: '5.9€' },
      { section: 'Mochi Ice Cream', name: 'Strawbry Mochi', price: '4.8€' },
    ]);
    expect(result.items[1].diets).toEqual([]);
    expect(result.items[1].sourceText).toContain('L. G. 4.8€');
  });

  it('removes the displayed price from the menu item name', () => {
    const result = parseMenu('Coffee\nFilter coffee 3,6€', 'en');

    expect(result.items[0]).toMatchObject({ name: 'Filter coffee', price: '3,6€' });
  });

  it('uses only diet codes defined in the same menu source', () => {
    const result = parseMenu(
      'G = gluteeniton L = laktoositon V = vegaaninen\nPÄÄRUOAT\nKuhakeitto (L, G) 12,50€\nKasvisrisotto V 14€',
      'fi',
    );

    expect(result.items.map(({ name, diets }) => ({ name, diets }))).toEqual([
      { name: 'Kuhakeitto', diets: expect.arrayContaining(['Marked gluten-free', 'Marked lactose-free']) },
      { name: 'Kasvisrisotto', diets: ['Marked vegan'] },
    ]);

    const noLegend = parseMenu('PÄÄRUOAT\nKuhakeitto (L, G) 12,50€', 'fi');
    expect(noLegend.items[0].diets).toEqual([]);
    expect(noLegend.items[0].name).toContain('(L, G)');
  });

  it('understands Finnish code legends written with colons', () => {
    const result = parseMenu(
      'VEG: Kasvis V: Vegaani L: Laktoositon G: Gluteeniton\nPÄÄRUOAT\nKasvisrisotto VEG 14€\nKeitto V, G 12€',
      'fi',
    );

    expect(result.items[0].diets).toContain('Marked vegetarian');
    expect(result.items[1].diets).toEqual(expect.arrayContaining(['Marked vegan', 'Marked gluten-free']));
  });

  it('does not turn homepage marketing, contact details or menu links into dishes', () => {
    const result = parseMenu('Welcome to Test Kitchen\nMenu\nOur story\nWe serve pizza and pasta every day\nView menu\nGift card 50€\nOpening hours\nMonday\n12.00–22.00\n+358 50 1234567\nHelsinki\nSubscribe to our newsletter', 'en');
    expect(result.items).toEqual([]);
  });

  it('requires evidence for each item, even within a menu section', () => {
    const result = parseMenu('Mains\nHandcrafted with love\nEnjoy our chicken dishes\nVegan curry 12€\nGift cards 20€\nReservations\nChicken soup\nContact us', 'en');
    expect(result.items.map(item => item.name)).toEqual(['Vegan curry']);
  });

  it('keeps creative priced dishes and unpriced food names in recognized sections', () => {
    const result = parseMenu('Starters\nBurrata\nMains\nMidnight in Helsinki 24€\nSalmon soup', 'en');
    expect(result.items.map(item => item.name)).toEqual(['Burrata', 'Midnight in Helsinki', 'Salmon soup']);
  });

  it('does not attach a price across unrelated website text or another section', () => {
    const result = parseMenu('Mains\nSalmon soup\nHandcrafted with love\n40€\nDesserts\n5€\nChocolate cake 9€', 'en');
    expect(result.items.map(item => [item.name, item.price])).toEqual([['Salmon soup', ''], ['Chocolate cake', '9€']]);
  });

  it('does not promote conditional or negative dietary claims to dish labels', () => {
    const result = parseMenu('Mains\nCurry — Vegan option on request 14€\nNot vegan burger 16€\nVegan curry 12€', 'en');
    expect(result.items.map(item => item.diets)).toEqual([[], [], ['Marked vegan']]);
  });

  it('keeps Finnish and Swedish menu items while discarding page controls', () => {
    expect(parseMenu('PÄÄRUOAT\nLohikeitto 12,50€\nVaraa pöytä\nLahjakortti 30€\nYhteystiedot\nHelsinki', 'fi').items.map(item => item.name)).toEqual(['Lohikeitto']);
    expect(parseMenu('Huvudrätter\nLaxsoppa 13€\nBoka bord\nPresentkort 50€', 'sv').items.map(item => item.name)).toEqual(['Laxsoppa']);
  });

  it('handles small separate prices and creative names next to a menu price', () => {
    const result = parseMenu('Desserts\nMidnight in Helsinki\n9€\nChocolate cake\n2026', 'en');
    expect(result.items.map(item => [item.name, item.price])).toEqual([['Midnight in Helsinki', '9€'], ['Chocolate cake', '']]);
  });

  it('keeps structured feed descriptions with their item and never invents a currency', () => {
    const text = feedText(JSON.stringify({ items: [{ name: 'Vegan curry', description: 'Roasted vegetables and rice', price: 12.5 }] }), 'application/json');
    expect(parseMenu(text, 'en').items[0]).toMatchObject({ name: 'Vegan curry', description: 'Roasted vegetables and rice', price: '12.50', diets: ['Marked vegan'] });
  });
});

it('omits menu navigation and attaches a long priced description to its dish', () => {
  const parsed = parseMenu('Skip to content\nOur Menus\nMochi Donut\nMatcha Drinks\nSando\nCoffee & Others\nMatcha\nMatcha Latte\n5.9€\nSpecial\nStrawberry bun\nMochi donut with white chocolate cream and fresh strawberry filling - 6.2€\nGift Card', 'en');
  expect(parsed.items.map(item => item.name)).toEqual(['Matcha Latte', 'Strawberry bun']);
  expect(parsed.items[1]).toMatchObject({ price: '6.2€' });
  expect(parsed.items[1].description).toContain('strawberry filling');
});

it('does not turn negated source labels into dietary claims', () => {
  expect(parseMenu('Mains\nNot vegan curry 12€', 'en').items[0].diets).toEqual([]);
  expect(parseMenu('PÄÄRUOAT\nEi gluteeniton keitto 12€', 'fi').items[0].diets).toEqual([]);
  expect(parseMenu('Mains\nVegan curry, not gluten-free 12€', 'en').items[0].diets).toEqual(['Marked vegan']);
});
