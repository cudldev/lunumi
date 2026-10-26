import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const root = process.cwd();
const privateDir = path.resolve(root, 'data/private-menu-training');
const zipPath = path.join(privateDir, 'fndds-2021-2023.zip');
const extractDir = path.join(privateDir, 'fndds-source');
const inputPath = path.join(privateDir, 'fndds-source', 'surveyDownload.json');
const outputPath = path.join(privateDir, 'labels.jsonl');
const execFile = promisify(execFileCallback);
const dataUrl = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip';
const source = {
  name: 'USDA FoodData Central FNDDS 2021–2023',
  sourceUrl: 'https://fdc.nal.usda.gov/download-datasets/',
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  permissionBasis: 'explicit-license',
  approvedForModelRelease: true,
  commercialUseApproved: true,
  release: '2024-10-31',
};

async function ensureDataset() {
  try { await readFile(inputPath); return; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await mkdir(privateDir, { recursive: true });
  let archive;
  try { archive = await readFile(zipPath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (!archive) {
    const response = await fetch(dataUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`USDA dataset download failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 5_000_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('USDA download was not the expected small ZIP archive.');
    await writeFile(zipPath, bytes);
  }
  await mkdir(extractDir, { recursive: true });
  try { await execFile('tar', ['-xf', zipPath, '-C', extractDir]); }
  catch (error) { throw new Error(`Could not extract the USDA archive with tar: ${error.message}`); }
}

await ensureDataset();
let rawSource;
let data;
try {
  rawSource = await readFile(inputPath, 'utf8');
  data = JSON.parse(rawSource);
}
catch (error) {
  throw error;
}
if (!Array.isArray(data.SurveyFoods)) throw new Error('The selected file is not the expected USDA FNDDS surveyDownload.json.');

const examples = new Map();
function add(text, label, group) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length < 3 || normalized.length > 220) return;
  const key = `${label}\n${normalized.toLocaleLowerCase('en-US')}`;
  if (!examples.has(key)) examples.set(key, {
    schema: 1,
    language: 'en',
    text: normalized,
    label,
    group: String(group ?? key),
    source,
  });
}

for (const food of data.SurveyFoods) {
  const group = food.wweiaFoodCategory?.wweiaFoodCategoryCode ?? food.foodCode ?? food.fdcId;
  add(food.description, 'dish', group);
  add(food.wweiaFoodCategory?.wweiaFoodCategoryDescription, 'section', group);
  for (const portion of food.foodPortions ?? []) add(portion.portionDescription, 'other', group);
  for (const nutrient of food.foodNutrients ?? []) add(nutrient.nutrient?.name, 'other', group);
}

await mkdir(privateDir, { recursive: true });
await writeFile(outputPath, `${[...examples.values()].map(example => JSON.stringify(example)).join('\n')}\n`);
const counts = [...examples.values()].reduce((grouped, example) => {
  grouped[example.label] = (grouped[example.label] ?? 0) + 1;
  return grouped;
}, {});
const sourceDigest = createHash('sha256').update(rawSource).digest('hex');
await writeFile(path.join(privateDir, 'dataset-manifest.json'), `${JSON.stringify({
  ...source,
  fetchedAt: new Date().toISOString(),
  foodCount: data.SurveyFoods.length,
  labeledExampleCount: examples.size,
  exampleCountsByLabel: counts,
  sourceDigest,
  labelsPath: path.relative(root, outputPath).replaceAll(path.sep, '/'),
}, null, 2)}\n`);
console.log(`Prepared ${examples.size} CC0 English examples from ${data.SurveyFoods.length} USDA food records.`);
console.log(`Labels: ${path.relative(root, outputPath)} (Git-ignored). Source data and labels remain out of Git.`);
