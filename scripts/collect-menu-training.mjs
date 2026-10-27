import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFeed, parseMenuPage } from './menu-training-source.mjs';

const root = process.cwd();
const sourcePath = path.resolve(process.argv[2] ?? 'data/menu-training-sources.local.json');
const outputPath = path.resolve(process.argv[3] ?? 'data/private-menu-training/candidates.jsonl');
const privateDir = path.resolve(root, 'data/private-menu-training');
const maxBytes = 1_000_000;
const timeoutMs = 12_000;
const delayMs = 1_100;

if (outputPath !== privateDir && !outputPath.startsWith(`${privateDir}${path.sep}`)) {
  throw new Error(`Training data output must stay under ${path.relative(root, privateDir)} (this directory is Git-ignored).`);
}

function validateSource(source, index) {
  if (!source || typeof source !== 'object') throw new Error(`Source ${index + 1} must be an object.`);
  let url;
  try { url = new URL(source.url); } catch { throw new Error(`Source ${index + 1} has an invalid URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || /(?:^|\.)(localhost|local|internal|test|invalid|example)$/i.test(url.hostname)) {
    throw new Error(`Source ${index + 1} must use a public HTTPS URL.`);
  }
  const type = source.type ?? 'feed';
  if (!['feed', 'page'].includes(type)) throw new Error(`Source ${index + 1} type must be feed or page.`);
  if (!['fi', 'sv', 'en'].includes(source.language)) throw new Error(`Source ${index + 1} language must be fi, sv, or en.`);
  if (source.approvedForModelRelease !== true) throw new Error(`Source ${index + 1} is not approved for training and releasing model weights.`);
  if (source.commercialUseApproved !== true) throw new Error(`Source ${index + 1} is not approved for future commercial use.`);
  if (!source.license || !source.licenseUrl || !source.rightsReviewedAt || !source.rightsEvidenceUrl) {
    throw new Error(`Source ${index + 1} needs its license, license URL, review date, and evidence URL.`);
  }
  if (!['explicit-license', 'written-permission'].includes(source.permissionBasis)) {
    throw new Error(`Source ${index + 1} must use an explicit license or written permission; public availability alone is not enough.`);
  }
  return { ...source, type, url: url.toString() };
}

async function readBounded(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`Feed exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: 'error',
      headers: {
        Accept: source.type === 'page'
          ? 'text/html, application/xhtml+xml;q=0.9'
          : 'application/feed+json, application/json, application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9',
        'User-Agent': 'LunumiMenuTrainingCollector/1.0 (+https://github.com/cudldev/lunumi)',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    const body = await readBounded(response);
    const entries = source.type === 'page' ? parseMenuPage(body, contentType) : parseFeed(body, contentType);
    return entries.filter(item => item.text.length >= 8);
  } catch (error) {
    throw new Error(`${source.url}: ${error?.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : error?.message ?? String(error)}`);
  } finally { clearTimeout(timer); }
}

let manifest;
try { manifest = JSON.parse(await readFile(sourcePath, 'utf8')); }
catch (error) {
  if (error?.code === 'ENOENT') throw new Error(`Create ${path.relative(root, sourcePath)} using the schema in docs/menu-training.md. It is intentionally ignored by Git.`);
  throw error;
}
if (!Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error('The local source manifest needs a non-empty sources array.');
const sources = manifest.sources.map(validateSource);
if (sources.length > 50) throw new Error('Limit each collection run to 50 reviewed sources.');

let prior = [];
try { prior = (await readFile(outputPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
const recordsByHash = new Map(prior.map(record => [record.contentHash, record]));
let lastFetchAt = 0;
for (const [index, source] of sources.entries()) {
  const wait = Math.max(0, delayMs - (Date.now() - lastFetchAt));
  if (lastFetchAt && wait) await new Promise(resolve => setTimeout(resolve, wait));
  const items = await fetchSource(source);
  lastFetchAt = Date.now();
  for (const item of items) {
    const normalizedText = item.text.replace(/\s+/g, ' ').trim();
    const contentHash = createHash('sha256').update(`${source.url}\n${normalizedText}`).digest('hex');
    recordsByHash.set(contentHash, {
      schema: 1,
      sourceName: source.sourceName ?? new URL(source.url).hostname,
      sourceUrl: source.url,
      sourceRightsEvidenceUrl: source.rightsEvidenceUrl,
      license: source.license,
      licenseUrl: source.licenseUrl,
      permissionBasis: source.permissionBasis,
      rightsReviewedAt: source.rightsReviewedAt,
      sourceRightsEvidenceUrl: source.rightsEvidenceUrl,
      approvedForModelRelease: true,
      commercialUseApproved: true,
      language: source.language,
      fetchedAt: new Date().toISOString(),
      sourceItemId: item.id || null,
      title: item.title || null,
      publishedAt: item.publishedAt || null,
      text: item.text,
      contentHash,
      labels: null,
    });
  }
  console.log(`[${index + 1}/${sources.length}] ${source.sourceName ?? source.url}: ${items.length} feed items`);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${[...recordsByHash.values()].map(record => JSON.stringify(record)).join('\n')}\n`);
console.log(`Saved ${recordsByHash.size} private candidate records to ${path.relative(root, outputPath)} (Git-ignored).`);
