import { describe, expect, it } from 'vitest';
import { parseFeed, parseMenuPage } from './menu-training-source.mjs';

describe('licensed menu training source parsing', () => {
  it('extracts semantic Finnish menu blocks and removes unrelated page chrome', () => {
    const entries = parseMenuPage(`
      <html><body><nav><a>Ruokalista</a></nav><script>tracking()</script>
      <main><h2>Päivän lounas</h2><ul><li>Lohikeitto – 12,90 €</li><li>Kasvispasta</li></ul>
      <p>Ainesosat: lohi, peruna, kerma</p></main><footer>Privacy policy</footer></body></html>
    `, 'text/html');

    expect(entries.map(entry => entry.text)).toEqual([
      'Päivän lounas',
      'Lohikeitto – 12,90 €',
      'Kasvispasta',
      'Ainesosat: lohi, peruna, kerma',
    ]);
    expect(entries[0].title).toBe('Päivän lounas');
  });

  it('keeps JSON and RSS feed entries readable for the same labeled training format', () => {
    const json = parseFeed(JSON.stringify({ items: [{ id: '1', title: 'Salmon soup', content_text: 'With potatoes' }] }), 'application/feed+json');
    const xml = parseFeed('<rss><channel><item><title>Soup</title><description>Daily lunch</description></item></channel></rss>', 'application/rss+xml');

    expect(json[0].text).toBe('Salmon soup\nWith potatoes');
    expect(xml[0].text).toBe('Soup\nDaily lunch');
  });
});
