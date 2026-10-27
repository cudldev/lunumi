import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './menu-training-csv.mjs';

const root = process.cwd();
const privateDir = path.resolve(root, 'data/private-menu-training');
const csvPath = path.resolve(process.argv[2] ?? path.join(privateDir, 'menus-du-crous.csv'));
const datasetUpdatedAt = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const outputPath = path.join(privateDir, 'crous-instruct.jsonl');
const manifestPath = path.join(privateDir, 'crous-instruct-manifest.json');
const source = {
  name: 'CROUStillant — Menus du CROUS',
  sourceUrl: 'https://www.data.gouv.fr/datasets/menus-du-crous',
  license: 'Licence Ouverte / Open Licence 2.0',
  licenseUrl: 'https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf',
  rightsEvidenceUrl: 'https://www.data.gouv.fr/datasets/menus-du-crous',
  permissionBasis: 'explicit-license',
  approvedForModelRelease: true,
  commercialUseApproved: true,
  attribution: 'CROUStillant (Paul Bayfield), data.gouv.fr',
  resourceUpdatedAt: datasetUpdatedAt,
};

const csv = await readFile(csvPath, 'utf8');
const records = parseCsv(csv).map(record => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value ?? '').trim()])));
const required = ['menu_id', 'menu_date', 'repas_id', 'repas_type', 'categorie_type', 'plat_libelle', 'restaurant_id'];
if (!records.length || required.some(field => !(field in records[0]))) {
  throw new Error(`CROUS CSV must include: ${required.join(', ')}.`);
}

const menus = new Map();
for (const row of records) {
  const dish = row.plat_libelle.replace(/\s+/g, ' ').trim();
  const restaurant = row.restaurant_id.trim();
  if (!dish || !restaurant) continue;
  const key = [restaurant, row.menu_date, row.repas_id || row.repas_type].join('\t');
  const menu = menus.get(key) ?? {
    restaurant,
    menuDate: row.menu_date,
    meal: row.repas_type || 'repas',
    sections: new Map(),
  };
  const section = row.categorie_type.replace(/\s+/g, ' ').trim() || 'Autres';
  const sectionDishes = menu.sections.get(section) ?? new Map();
  sectionDishes.set(dish.toLocaleLowerCase('fr'), dish);
  menu.sections.set(section, sectionDishes);
  menus.set(key, menu);
}

function validationGroup(restaurantId) {
  return Number.parseInt(createHash('sha256').update(restaurantId).digest('hex').slice(0, 8), 16) % 5 === 0;
}

function renderInput(menu, variant) {
  const lines = [];
  if (variant === 0) {
    lines.push(`Repas : ${menu.meal}`);
    for (const [section, dishes] of menu.sections) lines.push('', section, ...[...dishes.values()].map(dish => `• ${dish}`));
  } else if (variant === 1) {
    lines.push(menu.meal.toLocaleUpperCase('fr'));
    for (const [section, dishes] of menu.sections) lines.push(`${section} : ${[...dishes.values()].join(' ; ')}`);
  } else {
    lines.push(`Menu ${menu.meal.toLocaleLowerCase('fr')}`, ...[...menu.sections].flatMap(([section, dishes]) =>
      [`[${section}]`, ...[...dishes.values()].map(dish => `- ${dish}`)],
    ));
  }
  return lines.join('\n');
}

function expectedOutput(menu) {
  const items = [...menu.sections].flatMap(([section, dishes]) => [...dishes.values()].map(name => ({
    name,
    section,
    sourceText: name,
  })));
  const examples = items.slice(0, 4).map(item => item.name);
  const suffix = items.length > examples.length ? ', entre autres' : '';
  const summary = `${menu.meal} : ${items.length} plats${examples.length ? `, dont ${examples.join(', ')}${suffix}` : ''}.`;
  return JSON.stringify({ meal: menu.meal, summary, items });
}

const examples = [];
for (const menu of menus.values()) {
  const items = [...menu.sections.values()].reduce((count, dishes) => count + dishes.size, 0);
  if (items < 2) continue;
  const split = validationGroup(menu.restaurant) ? 'validation' : 'train';
  const target = expectedOutput(menu);
  for (let variant = 0; variant < 3; variant += 1) {
    examples.push({
      schema: 1,
      task: 'extract_and_summarize_menu',
      language: 'fr',
      split,
      group: `crous-restaurant-${menu.restaurant}`,
      messages: [
        {
          role: 'system',
          content: 'Lis ce menu en français. Retourne uniquement un JSON avec meal, summary et items. Garde les noms et sections tels qu’écrits. Chaque item doit inclure name, section et sourceText; sourceText doit citer exactement le nom du plat. Ne devine jamais ingrédients, prix, allergènes ou régimes. Le résumé doit seulement reprendre le repas, le nombre de plats et quelques noms du menu.',
        },
        { role: 'user', content: renderInput(menu, variant) },
        { role: 'assistant', content: target },
      ],
      source: { ...source, menuDate: menu.menuDate },
    });
  }
}

if (!examples.some(example => example.split === 'train') || !examples.some(example => example.split === 'validation')) {
  throw new Error('CROUS data did not produce both restaurant-separated training and validation examples.');
}
const eligibleRestaurants = new Set(examples.map(example => example.group));
const validationRestaurants = new Set(examples.filter(example => example.split === 'validation').map(example => example.group));
await mkdir(privateDir, { recursive: true });
await writeFile(outputPath, `${examples.map(example => JSON.stringify(example)).join('\n')}\n`);
await writeFile(manifestPath, `${JSON.stringify({
  ...source,
  fetchedAt: new Date().toISOString(),
  sourceSha256: createHash('sha256').update(csv).digest('hex'),
  sourceRows: records.length,
  menuGroups: menus.size,
  restaurantGroups: new Set([...menus.values()].map(menu => menu.restaurant)).size,
  exampleCount: examples.length,
  trainingCount: examples.filter(example => example.split === 'train').length,
  validationCount: examples.filter(example => example.split === 'validation').length,
  eligibleRestaurantCount: eligibleRestaurants.size,
  validationRestaurantCount: validationRestaurants.size,
  validationRestaurantFraction: validationRestaurants.size / eligibleRestaurants.size,
  outputPath: path.relative(root, outputPath).replaceAll(path.sep, '/'),
  note: 'Assistant targets are deterministically generated from source menu rows. Variants change only menu-line formatting; validation is separated by restaurant ID.',
}, null, 2)}\n`);
console.log(`Prepared ${examples.length} French instruction examples from ${menus.size} restaurant-meal groups across ${new Set([...menus.values()].map(menu => menu.restaurant)).size} restaurants.`);
console.log(`Training: ${examples.filter(example => example.split === 'train').length}; validation: ${examples.filter(example => example.split === 'validation').length} examples from ${validationRestaurants.size}/${eligibleRestaurants.size} eligible held-out restaurants.`);
console.log(`Private instruction data: ${path.relative(root, outputPath)}.`);
