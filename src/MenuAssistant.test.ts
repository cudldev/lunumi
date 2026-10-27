import { describe, expect, it } from 'vitest';
import { parseMenu } from './menu-data';

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
    const result = parseMenu('VEKE®-kasviskerroshampurilainen\nKasvisruoka falafelilla', 'fi');

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
});
