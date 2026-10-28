import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMenuSource, matchingItems, menuSources, readRestaurantMenu, understand } from './chat-tools';
import { parseMenu } from './menu-data';
import type { Place } from './core';

const place: Place = { id: 'one', name: 'Test Kitchen', lat: 60, lon: 24, distance: 100, tags: { 'lunch:feed': 'https://example.test/lunch', 'menu:feed': 'https://example.test/menu', website: 'javascript:alert(1)' } };
afterEach(() => vi.unstubAllGlobals());

describe('chat task routing', () => {
  it('routes menu reading, item follow-ups, search, and navigation', () => {
    expect(understand('Show menu for Test Kitchen').kind).toBe('menu');
    expect(understand('List items')).toEqual({ kind: 'items', term: '' });
    expect(understand('Find vegan items')).toEqual({ kind: 'items', term: 'vegan' });
    expect(understand('Find Italian restaurants')).toEqual({ kind: 'places', term: 'italian' });
    expect(understand('Change location')).toEqual({ kind: 'navigate', destination: 'discover' });
    expect(understand('Open profile')).toEqual({ kind: 'navigate', destination: 'profile' });
    expect(understand('Is this safe for my allergies?').kind).toBe('safety');
  });

  it('filters dietary requests using explicit claims', () => {
    const menu = parseMenu('Mains\nVegan curry 12€\nVegetarian pasta 14€\nCarrot soup 9€', 'en');
    expect(matchingItems(menu, 'vegan').map(item => item.name)).toEqual(['Vegan curry']);
    expect(matchingItems(menu, 'carrot').map(item => item.name)).toEqual(['Carrot soup']);
    expect(matchingItems(menu, 'gluten-free')).toEqual([]);
    expect(matchingItems(menu)).toHaveLength(3);
  });

  it('prioritizes feeds, deduplicates URLs, and rejects unsafe links', () => {
    const sources = menuSources({ ...place, tags: { ...place.tags, 'website:menu': 'https://example.test/menu' } });
    expect(sources.map(source => source.url)).toEqual(['https://example.test/lunch', 'https://example.test/menu']);
  });
});

describe('menu tool', () => {
  it('falls through failed sources and returns source-backed entries', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(new Response('Mains\nVegan curry 12€', { headers: { 'content-type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await readRestaurantMenu(place, new AbortController().signal);
    expect(result.source.url).toBe('https://example.test/menu');
    expect(result.items[0]).toMatchObject({ name: 'Vegan curry', price: '12€', diets: ['Marked vegan'] });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('skips PDFs and reports unreadable sources honestly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PDF bytes', { headers: { 'content-type': 'application/pdf' } })));
    await expect(readRestaurantMenu(place, new AbortController().signal)).rejects.toThrow('couldn’t read a menu');
  });

  it('does not start requests after cancellation', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController(); controller.abort();
    await expect(readRestaurantMenu(place, controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe('internet menu reader', () => {
  it('sends only the source URL to the configured service and preserves the final source', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'Lunch\nSoup 12€', contentType: 'text/plain', sourceUrl: 'https://example.test/lunch/today' })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchMenuSource('https://example.test/lunch', new AbortController().signal, 'https://reader.example/v1/menu');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: 'https://example.test/lunch' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(result.url).toBe('https://example.test/lunch/today');
  });
  it('rejects invalid configuration and malformed proxy responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"text":"menu","contentType":"text/html","sourceUrl":"javascript:alert(1)"}')));
    await expect(fetchMenuSource('https://example.test', new AbortController().signal, 'http://untrusted.example/v1/menu')).rejects.toThrow('configuration');
    await expect(fetchMenuSource('https://example.test', new AbortController().signal, 'https://reader.example/v1/menu')).rejects.toThrow('Invalid menu-reader response');
  });
});

  it('rejects unrelated text even when a URL is explicitly tagged as a menu feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Welcome\nMenu\nOur story\nHandcrafted with love\nGift cards 50€', { headers: { 'content-type': 'text/plain' } })));
    await expect(readRestaurantMenu(place, new AbortController().signal)).rejects.toThrow('couldn’t read a menu');
  });
