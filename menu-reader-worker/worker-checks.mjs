import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.mjs';

const origin = 'https://cudldev.github.io';
const sourceUrl = 'https://www.raflaamo.fi/fi/ravintola/helsinki/10-kerros';

function menuRequest(url = sourceUrl, requestOrigin = origin) {
  return new Request('https://menu-reader.example/v1/menu', {
    method: 'POST',
    headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

test('answers preflight for the Lunumi origin without credentials', async () => {
  const response = await handleRequest(new Request('https://menu-reader.example/v1/menu', {
    method: 'OPTIONS', headers: { Origin: origin },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('rejects unknown origins and targets without requesting them', async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return new Response('unexpected'); };
  const blockedOrigin = await handleRequest(menuRequest(sourceUrl, 'https://attacker.example'), {}, fetcher);
  const blockedHost = await handleRequest(menuRequest('https://example.com/menu'), {}, fetcher);
  const insecure = await handleRequest(menuRequest('http://www.raflaamo.fi/menu'), {}, fetcher);
  assert.equal(blockedOrigin.status, 403);
  assert.equal(blockedHost.status, 400);
  assert.equal(insecure.status, 400);
  assert.equal(calls, 0);
});

test('returns bounded HTML text for on-device parsing and does not cache it', async () => {
  const html = '<html><body><h1>Lunch menu</h1><p>Soup €12</p></body></html>';
  const fetcher = async (url, options) => {
    assert.equal(url, sourceUrl);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Cookie, undefined);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  };
  const response = await handleRequest(menuRequest(), {}, fetcher);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.text, html);
  assert.equal(result.contentType, 'text/html; charset=utf-8');
  assert.equal(result.sourceUrl, sourceUrl);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('revalidates redirects against the restaurant host list', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { Location: 'https://example.com/collect' } });
  };
  const response = await handleRequest(menuRequest(), {}, fetcher);
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
});

test('rejects oversized menu responses', async () => {
  const oversized = new Uint8Array(500_001);
  const fetcher = async () => new Response(oversized, { headers: { 'Content-Type': 'text/plain' } });
  const response = await handleRequest(menuRequest(), {}, fetcher);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/i);
});
