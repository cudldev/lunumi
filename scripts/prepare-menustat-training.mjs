import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { menuStatExamples, parseCsv } from './menu-training-csv.mjs';

const root = process.cwd();
const privateDir = path.resolve(root, 'data/private-menu-training');
const csvPath = path.join(privateDir, 'menustat-historical.csv');
const labelsPath = path.resolve(process.argv[2] ?? path.join(privateDir, 'labels.jsonl'));
const downloadUrl = 'https://data.cityofnewyork.us/api/v3/views/qgc5-ecnb/export.csv?accessType=DOWNLOAD';
const datasetUrl = 'https://data.cityofnewyork.us/Health/MenuStat/qgc5-ecnb';
const useTermsUrl = 'https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje';
const reuseEvidenceUrl = 'https://www.nyc.gov/opendata/get-started/FAQs';
const maxBytes = 50_000_000;

if (labelsPath !== privateDir && !labelsPath.startsWith(`${privateDir}${path.sep}`)) {
  throw new Error(`Training labels must stay under ${path.relative(root, privateDir)} (this directory is Git-ignored).`);
}

let csv;
try { csv = await readFile(csvPath); }
catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  const response = await fetch(downloadUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: 'text/csv', 'User-Agent': 'LunumiMenuTrainingCollector/1.0 (+https://github.com/cudldev/lunumi)' },
  });
  if (!response.ok) throw new Error(`NYC MenuStat download failed with HTTP ${response.status}.`);
  csv = Buffer.from(await response.arrayBuffer());
  if (csv.length > maxBytes) throw new Error(`NYC MenuStat download exceeds ${maxBytes} bytes.`);
  await mkdir(privateDir, { recursive: true });
  await writeFile(csvPath, csv);
}
if (csv.length > maxBytes) throw new Error(`NYC MenuStat CSV exceeds ${maxBytes} bytes.`);

const source = {
  name: 'NYC DOHMH MenuStat (Historical)',
  sourceUrl: downloadUrl,
  datasetUrl,
  license: 'NYC Open Data public-use terms (NYC states there are no restrictions on public data use)',
  licenseUrl: useTermsUrl,
  rightsEvidenceUrl: reuseEvidenceUrl,
  permissionBasis: 'open-data-terms',
  rightsReviewedAt: '2026-10-27',
  approvedForModelRelease: true,
  commercialUseApproved: true,
  reuseRequirements: [
    'Before distributing an application using NYC Open Data, notify the City and include the City disclaimer required by the portal terms.',
    'Credit NYC DOHMH MenuStat and preserve source and date metadata with released weights.',
  ],
};

let existingLines;
try { existingLines = (await readFile(labelsPath, 'utf8')).split(/\r?\n/).filter(Boolean); }
catch (error) {
  if (error?.code === 'ENOENT') throw new Error('Run `npm run model:prepare` first to create the CC0 English baseline and non-menu examples.');
  throw error;
}
const existing = existingLines.map((line, index) => {
  try { return JSON.parse(line); }
  catch { throw new Error(`Existing training label line ${index + 1} is invalid JSON.`); }
});
if (!existing.some(example => example.language === 'en' && example.label === 'other')) {
  throw new Error('The English baseline must contain other examples before adding MenuStat. Run `npm run model:prepare` first.');
}

const rows = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(csv));
const examples = menuStatExamples(rows, source);
const recordKey = example => [example.language, example.label, example.text.trim().toLocaleLowerCase('en-US'), example.group ?? '', example.source?.sourceUrl ?? example.sourceUrl ?? ''].join('\n');
const known = new Set(existing.map(recordKey));
const added = examples.filter(example => !known.has(recordKey(example)));
const merged = [...existing, ...added];
const labelsByClass = merged.filter(example => example.language === 'en').reduce((counts, example) => {
  counts[example.label] = (counts[example.label] ?? 0) + 1;
  return counts;
}, {});

await mkdir(path.dirname(labelsPath), { recursive: true });
await writeFile(labelsPath, `${merged.map(example => JSON.stringify(example)).join('\n')}\n`);
await writeFile(path.join(privateDir, 'menustat-manifest.json'), `${JSON.stringify({
  ...source,
  downloadedAt: new Date().toISOString(),
  datasetSha256: createHash('sha256').update(csv).digest('hex'),
  rows: rows.length,
  restaurants: new Set(rows.map(row => String(row.Restaurant_ID ?? '').trim()).filter(Boolean)).size,
  addedTrainingExamples: added.length,
  englishTrainingCounts: labelsByClass,
  labelsPath: path.relative(root, labelsPath).replaceAll(path.sep, '/'),
}, null, 2)}\n`);
console.log(`Added ${added.length} NYC MenuStat examples from ${rows.length} rows across ${new Set(rows.map(row => row.Restaurant_ID)).size} restaurants.`);
console.log(`English labels: ${JSON.stringify(labelsByClass)}.`);
console.log(`Labels and raw source remain in Git-ignored ${path.relative(root, privateDir)}.`);
