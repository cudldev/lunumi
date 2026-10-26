import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyRestaurantLinkOverrides } from './build-osm-food-data.mjs';

async function apply(inputPath, outputPath, registryPath) {
  const input = path.resolve(inputPath ?? 'public/data/helsinki-metro.json');
  const output = path.resolve(outputPath ?? input);
  const registry = path.resolve(registryPath ?? 'data/restaurant-link-overrides.json');
  const dataset = JSON.parse(await readFile(input, 'utf8'));
  const overrides = JSON.parse(await readFile(registry, 'utf8'));
  applyRestaurantLinkOverrides(dataset, overrides);
  await writeFile(output, JSON.stringify(dataset));
  console.log(`Applied ${overrides.overrides.length} curated restaurant link override(s) to ${path.relative(process.cwd(), output)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  apply(process.argv[2], process.argv[3], process.argv[4]).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
