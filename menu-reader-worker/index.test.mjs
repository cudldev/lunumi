import { describe, expect, it } from 'vitest';
import { handleRequest } from './index.mjs';

const origin = 'https://cudldev.github.io';

function menuRequest(path, url) {
  return new Request(`https://menu-reader.example${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

describe('menu reader asset endpoint', () => {
  it('returns bounded image bytes with app CORS headers for an approved restaurant host', async () => {
    const expected = new Uint8Array([137, 80, 78, 71]);
    const response = await handleRequest(
      menuRequest('/v1/menu-asset', 'https://restaurant.fi/menu.png'),
      { ALLOWED_MENU_HOSTS: 'restaurant.fi' },
      async () => new Response(expected, { headers: { 'Content-Type': 'image/png' } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...expected]);
  });

  it('rejects unapproved hosts and non-image assets', async () => {
    const unapproved = await handleRequest(
      menuRequest('/v1/menu-asset', 'https://other.fi/menu.png'),
      { ALLOWED_MENU_HOSTS: 'restaurant.fi' },
      async () => new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } }),
    );
    const unsupported = await handleRequest(
      menuRequest('/v1/menu-asset', 'https://restaurant.fi/menu.pdf'),
      { ALLOWED_MENU_HOSTS: 'restaurant.fi' },
      async () => new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'application/pdf' } }),
    );

    expect(unapproved.status).toBe(400);
    expect(unsupported.status).toBe(415);
  });
});
