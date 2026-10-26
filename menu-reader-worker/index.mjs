import allowedHosts from './allowed-hosts.mjs';

const MAX_REQUEST_BYTES = 4096;
const MAX_RESPONSE_BYTES = 500_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const APP_ORIGINS = new Set([
  'https://cudldev.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function jsonResponse(body, status, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  });
  if (origin && APP_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(message, status, origin) {
  return jsonResponse({ error: message }, status, origin);
}

async function readBounded(stream, maxBytes) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('The menu page is too large to read automatically. Open the source link instead.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validateTarget(value, hostSet) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The restaurant source URL is invalid.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || host.startsWith('[') || /(?:^|\.)(localhost|local|internal|test|invalid|example)$/i.test(host) || !hostSet.has(host)) {
    throw new Error('This source is not in Lunumi’s restaurant website list. Open it directly to view the menu.');
  }
  return url;
}

async function fetchMenuPage(url, hostSet, fetcher, signal) {
  let target = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetcher(target.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'text/html, text/plain, application/xhtml+xml, application/json, application/xml;q=0.9',
        'User-Agent': 'LunumiMenuReader/1.0 (+https://github.com/cudldev/lunumi)',
      },
      redirect: 'manual',
      signal,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, url: target };
    const location = response.headers.get('Location');
    if (!location || redirects === MAX_REDIRECTS) {
      throw new Error('The restaurant page redirected too many times. Open the source link instead.');
    }
    target = validateTarget(new URL(location, target).toString(), hostSet);
  }
  throw new Error('The restaurant page could not be reached. Open the source link instead.');
}

export async function handleRequest(request, env = {}, contextOrFetcher) {
  const origin = request.headers.get('Origin'); const fetcher = typeof contextOrFetcher === 'function' ? contextOrFetcher : fetch;
  if (request.method === 'OPTIONS') {
    if (!origin || !APP_ORIGINS.has(origin)) return errorResponse('This app origin is not allowed.', 403, null);
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    } });
  }
  if (!origin || !APP_ORIGINS.has(origin)) return errorResponse('This app origin is not allowed.', 403, null);
  if (new URL(request.url).pathname !== '/v1/menu') return errorResponse('Not found.', 404, origin);
  if (request.method !== 'POST') return errorResponse('Use POST to read a menu.', 405, origin);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return errorResponse('Send the menu source as JSON.', 415, origin);
  }
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return errorResponse('The request is too large.', 413, origin);

  let input;
  try {
    const body = new TextDecoder().decode(await readBounded(request.body, MAX_REQUEST_BYTES));
    input = JSON.parse(body);
  } catch {
    return errorResponse('The menu request is not valid JSON.', 400, origin);
  }
  if (typeof input?.url !== 'string' || input.url.length > 2048) {
    return errorResponse('A valid restaurant source URL is required.', 400, origin);
  }

  const hosts = env.ALLOWED_MENU_HOSTS ? new Set(env.ALLOWED_MENU_HOSTS.split(',').map(host => host.trim().toLowerCase()).filter(Boolean)) : allowedHosts;
  let target;
  try {
    target = validateTarget(input.url, hosts);
  } catch (error) {
    return errorResponse(error.message, 400, origin);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { response, url } = await fetchMenuPage(target, hosts, fetcher, controller.signal);
    if (!response.ok) return errorResponse(`The restaurant page returned an error (${response.status}).`, 502, origin);
    const contentType = response.headers.get('Content-Type') || '';
    if (/application\/pdf|image\//i.test(contentType) || /\.pdf(?:$|[?#])/i.test(url.toString())) {
      return errorResponse('This menu is a PDF or image. Open the source link to view it; automatic document reading is not available yet.', 415, origin);
    }
    if (contentType && !/^(text\/|application\/(json|xml|xhtml\+xml))/i.test(contentType)) {
      return errorResponse('This menu format cannot be read automatically yet. Open the source link instead.', 415, origin);
    }
    const bytes = await readBounded(response.body, MAX_RESPONSE_BYTES);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (!text.trim()) return errorResponse('The restaurant page did not contain readable text.', 422, origin);
    return jsonResponse({ text, contentType, sourceUrl: url.toString() }, 200, origin);
  } catch (error) {
    const message = controller.signal.aborted
      ? 'The restaurant page took too long to load. Open the source link instead.'
      : error instanceof Error ? error.message : 'The restaurant page could not be read. Open the source link instead.';
    return errorResponse(message, message.startsWith('The menu page is too large') ? 413 : 502, origin);
  } finally {
    clearTimeout(timeout);
  }
}

export default { fetch: handleRequest };
