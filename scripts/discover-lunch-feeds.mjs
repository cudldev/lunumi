import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const inputPath = path.resolve(process.argv[2] ?? 'public/data/helsinki-metro.json');
const outputPath = path.resolve(process.argv[3] ?? 'data/lunch-feed-candidates.json');
const includeWebsites = process.argv.includes('--include-websites');
const delayMs = Number(process.env.LUNUMI_FEED_SCAN_DELAY_MS ?? 1100);
const timeoutMs = Number(process.env.LUNUMI_FEED_SCAN_TIMEOUT_MS ?? 10000);
const maxPageBytes = 1_000_000;

function normalizeHttpUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return result;
}

function discoverFeedLinks(html, pageUrl) {
  const feeds = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    const rel = (attr.rel ?? '').toLowerCase().split(/\s+/);
    const type = (attr.type ?? '').toLowerCase().split(';')[0].trim();
    if (!rel.includes('alternate') || !['application/rss+xml', 'application/atom+xml', 'application/feed+json'].includes(type)) continue;
    const url = normalizeHttpUrl(attr.href, pageUrl);
    if (url) feeds.push({ url, type, title: (attr.title ?? '').trim() || null, discoveredOn: pageUrl });
  }
  return feeds;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'user-agent': 'LunumiLocalFeedDiscovery/1.0 (+https://github.com/cudldev/lunumi)' },
      redirect: 'follow',
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) return { error: `Not HTML (${type || 'unknown content type'})` };
    const reader = response.body?.getReader();
    if (!reader) return { error: 'Empty response' };
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxPageBytes) {
        await reader.cancel();
        return { error: `Page exceeds ${maxPageBytes} bytes` };
      }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString('utf8');
    return { html, finalUrl: normalizeHttpUrl(response.url, url) ?? url };
  } catch (error) {
    const detail = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? error;
    return { error: error?.name === 'AbortError' ? `Timed out after ${timeoutMs} ms` : String(detail) };
  } finally {
    clearTimeout(timer);
  }
}

const dataset = JSON.parse(await readFile(inputPath, 'utf8'));
if (!Array.isArray(dataset.places)) throw new Error(`No places array in ${inputPath}`);

const urlKeys = includeWebsites
  ? ['menu:website', 'website:menu', 'lunch:website', 'website:lunch', 'menu', 'website', 'contact:website']
  : ['menu:website', 'website:menu', 'lunch:website', 'website:lunch', 'menu', 'lunch'];
const targetsByUrl = new Map();
for (const place of dataset.places) {
  if (place['lunch:feed']) continue;
  for (const key of urlKeys) {
    const url = normalizeHttpUrl(place[key]);
    if (!url) continue;
    if (!targetsByUrl.has(url)) targetsByUrl.set(url, []);
    targetsByUrl.get(url).push({ id: place.id, name: place.name, field: key });
  }
}

const seenHosts = new Set();
const output = [];
let lastRequestAt = 0;
for (const [url, places] of targetsByUrl) {
  const host = new URL(url).hostname.toLowerCase();
  if (seenHosts.has(host)) continue;
  seenHosts.add(host);
  const wait = Math.max(0, delayMs - (Date.now() - lastRequestAt));
  if (lastRequestAt && wait) await new Promise(resolve => setTimeout(resolve, wait));
  const fetched = await fetchPage(url);
  lastRequestAt = Date.now();
  const feeds = fetched.html ? discoverFeedLinks(fetched.html, fetched.finalUrl) : [];
  output.push({
    checkedUrl: url,
    host,
    restaurants: places,
    status: fetched.error ? 'check_failed' : feeds.length ? 'review_feed_candidates' : 'no_standard_feed_found',
    candidates: feeds,
    ...(fetched.error ? { error: fetched.error } : {}),
  });
  if (output.length % 10 === 0 || feeds.length) console.log(`Scanned ${output.length} unique hosts; ${feeds.length} feed candidate(s) found on ${host}.`);
}

const result = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  inputDataset: path.relative(process.cwd(), inputPath),
  note: 'Candidates are unverified. Check that a discovered feed is a restaurant lunch menu and that its use is allowed before adding it to the public dataset.',
  scannedHosts: output.length,
  candidateCount: output.reduce((sum, item) => sum + item.candidates.length, 0),
  results: output,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Scanned ${result.scannedHosts} unique hosts; found ${result.candidateCount} standard feed candidate(s).`);
console.log(`Review results in ${path.relative(process.cwd(), outputPath)}. The source dataset was not changed.`);
