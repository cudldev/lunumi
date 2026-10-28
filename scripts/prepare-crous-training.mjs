import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './menu-training-csv.mjs';

const root = process.cwd();
const dataDir = path.resolve(root, 'data/private-menu-training');
const csvPath = path.resolve(root, process.argv[2] ?? path.join(dataDir, 'menus-du-crous.csv'));
const datasetUpdatedAt = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const labelsPath = path.join(dataDir, 'crous-labels.jsonl');
const manifestPath = path.join(dataDir, 'crous-manifest.json');
const source = {
  name: 'CROUStillant — Menus du CROUS',
  sourceUrl: 'https://www.data.gouv.fr/datasets/menus-du-crous',
  license: 'Licence Ouverte / Open Licence 2.0',
  licenseUrl: 'https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf',
  rightsEvidenceUrl: 'https://www.data.gouv.fr/datasets/menus-du-crous',
  permissionBasis: 'explicit-license',
  approvedForModelRelease: true,
  commercialUseApproved: true,
  attribution: 'CROUStillant (Paul Bayfield), data.gouv.fr; dataset release date recorded in crous-manifest.json',
};

const csv = await readFile(csvPath, 'utf8');
const records = parseCsv(csv).map(record => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value ?? '')])));
const required = ['restaurant_id', 'plat_libelle', 'categorie_type', 'repas_type'];
if (required.some(field => !(field in (records[0] ?? {})))) {
  throw new Error(`CROUS CSV is missing required columns: ${required.join(', ')}.`);
}
const menuDates = records.map(row => row.menu_date).filter(Boolean).sort();
if (!menuDates.length) throw new Error('No menu_date values found in the CROUS CSV.');
const labeled = [];
for (const row of records) {
  const text = row.plat_libelle.trim().replace(/\s+/g, ' ');
  if (!text) continue;
  const group = `crous-restaurant-${row.restaurant_id || 'unknown'}`;
  labeled.push({ schema: 1, language: 'fr', text, label: 'dish', group, source: { ...source, release: datasetUpdatedAt } });
  const category = row.categorie_type.trim().replace(/\s+/g, ' ');
  if (category) labeled.push({ schema: 1, language: 'fr', text: category, label: 'section', group, source: { ...source, release: datasetUpdatedAt } });
  const meal = row.repas_type.trim().replace(/\s+/g, ' ');
  if (meal) labeled.push({ schema: 1, language: 'fr', text: meal, label: 'other', group, source: { ...source, release: datasetUpdatedAt } });
}
const unique = new Map();
for (const item of labeled) unique.set(`${item.group}\0${item.label}\0${item.text.toLocaleLowerCase('fr')}`, item);
const output = [...unique.values()];
await mkdir(dataDir, { recursive: true });
await writeFile(labelsPath, `${output.map(item => JSON.stringify(item)).join('\n')}\n`);
await writeFile(manifestPath, `${JSON.stringify({
  ...source,
  release: datasetUpdatedAt,
  menuDateRange: { first: menuDates[0], latest: menuDates.at(-1) },
  fetchedAt: new Date().toISOString(),
  sourceSha256: createHash('sha256').update(csv).digest('hex'),
  sourceRows: records.length,
  restaurantGroups: new Set(records.map(row => row.restaurant_id).filter(Boolean)).size,
  labeledExampleCount: output.length,
  exampleCountsByLabel: Object.fromEntries(['dish', 'other'].map(label => [label, output.filter(item => item.label === label).length])),
  labelsPath: path.relative(root, labelsPath).replaceAll(path.sep, '/'),
}, null, 2)}\n`);
console.log(`Prepared ${output.length} French examples from ${records.length} menu rows across ${new Set(records.map(row => row.restaurant_id).filter(Boolean)).size} restaurant groups.`);
console.log(`Dataset update date: ${datasetUpdatedAt}; menu dates ${menuDates[0]} to ${menuDates.at(-1)}; raw CSV and annotations remain under Git-ignored ${path.relative(root, dataDir)}.`);
