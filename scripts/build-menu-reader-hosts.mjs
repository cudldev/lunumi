import { readFile, writeFile } from 'node:fs/promises';

const files = process.argv.slice(2).length ? process.argv.slice(2) : [
  'public/data/helsinki-metro.json',
  'public/data/restaurant-directory.json',
];
const keys = ['menuUrl', 'menuFeed', 'website', 'menu', 'menu:website', 'website:menu', 'lunch:website', 'website:lunch', 'lunch:feed', 'menu:feed'];
const hosts = new Set();

for (const file of files) {
  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }

  for (const place of data.places || []) {
    for (const key of keys) {
      const raw = place[key] ?? place.tags?.[key];
      if (typeof raw !== 'string') continue;
      try {
        const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.')) continue;
        if (/(?:^|\.)(localhost|local|internal|test|invalid|example)$/i.test(url.hostname)) continue;
        if (/^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.startsWith('[')) continue;
        hosts.add(url.hostname.toLowerCase().replace(/\.$/, ''));
      } catch {
        // Ignore malformed or non-URL dataset values.
      }
    }
  }
}

const output = new URL('../menu-reader-worker/allowed-hosts.mjs', import.meta.url);
await writeFile(output, `// Generated from restaurant menu and website URLs. Do not edit by hand.\nexport default new Set(${JSON.stringify([...hosts].sort(), null, 2)});\n`);
console.log(`Wrote ${hosts.size} allowed restaurant hosts to ${output.pathname}`);
