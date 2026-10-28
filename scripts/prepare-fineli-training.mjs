import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const root = process.cwd();
const privateDir = path.resolve(root, 'data/private-menu-training');
const zipPath = path.join(privateDir, 'fineli-open-data.zip');
let extractDir;
const outputPath = path.join(privateDir, 'fineli-labels.jsonl');
const sourceUrl = 'https://fineli.fi/fineli/fi/avoin-data';
const archiveUrl = 'https://fineli.fi/fineli/content/file/47';
const licenseUrl = 'https://creativecommons.org/licenses/by/4.0/';
const execFile = promisify(execFileCallback);
const refresh = process.argv.includes('--refresh');

const syntheticNoise = {
  fi: [
    ['navigation', ['Etusivu', 'Yhteystiedot', 'Aukioloajat', 'Varaa pöytä', 'Löydä ravintola']],
    ['page', ['Lisätietoja ravintolasta', 'Tietoa palveluistamme', 'Seuraa meitä sosiaalisessa mediassa', 'Tilaa uutiskirje', 'Tervetuloa ravintolaan']],
    ['instructions', ['Katso sijainti kartalta', 'Siirry etusivulle', 'Valitse kieli', 'Avaa yhteystiedot', 'Lue lisää ravintolasta']],
    ['notices', ['Tarkista ajantasaiset tiedot ravintolasta', 'Kysy allergeeneista henkilökunnalta', 'Hinnat sisältävät arvonlisäveron', 'Menu päivitetään viikoittain', 'Tervetuloa uudelleen']],
    ['opening-hours', ['Avoinna maanantaista perjantaihin kello 10–18', 'Keittiö sulkeutuu puoli tuntia ennen sulkemisaikaa', 'Poikkeavat aukioloajat löydät tältä sivulta', 'Ravintola on suljettu sunnuntaisin', 'Palvelemme lounasaikaan arkisin']],
    ['contact', ['Osoite: Esimerkkikatu 1', 'Puhelin: 000 000 0000', 'Lähetä meille sähköpostia', 'Yhteydenottolomakkeella saat meihin yhteyden', 'Löydät meidät kaupungin keskustasta', '00100 Helsinki', '12345 Esimerkkikaupunki', 'Osoite: Esimerkkikatu 12, 00100 Helsinki', 'FI-00100 Helsinki', 'Postinumero 12345, Esimerkkikaupunki']],
    ['reservations', ['Varaa pöytä helposti verkossa', 'Lounaalle emme ota pöytävarauksia', 'Vahvista varauksesi sähköpostitse', 'Kysy vapaita pöytiä henkilökunnalta', 'Muuta varaustasi varauslinkistä']],
    ['events', ['Järjestä yksityistilaisuus ravintolassamme', 'Juhlamenut suunnitellaan seurueen toiveiden mukaan', 'Pyydä tarjous tapahtumaasi varten', 'Tilamme sopivat myös kokouksiin', 'Ota yhteyttä ryhmävarauksista']],
    ['story', ['Tutustu ravintolamme tarinaan', 'Haluamme luoda viihtyisän kohtaamispaikan', 'Olemme palvelleet vieraita jo vuosien ajan', 'Meille tärkeintä on hyvä tunnelma', 'Lue lisää ravintolan historiasta']],
    ['values', ['Vastuullisuus ohjaa toimintaamme', 'Haluamme vähentää ruokahävikkiä', 'Teemme työtämme yhdessä paikallisten kumppanien kanssa', 'Kehitämme palveluamme palautteen perusteella', 'Kaikki ovat tervetulleita ravintolaamme']],
    ['forms', ['Anna palautetta käynnistäsi', 'Tilaa uutiskirjeemme tästä', 'Valitse haluamasi kieli', 'Lähetä yhteydenottopyyntö', 'Lataa lounaslista PDF-tiedostona']],
    ['availability', ['Päivän lounaslista julkaistaan aamulla', 'Tämän viikon lounasmenu päivittyy maanantaina', 'Tälle päivälle ei ole lounaslistaa saatavilla', 'Lounaslistaa ei ole vielä julkaistu', 'Tarkista menun voimassaolopäivät']],
    ['social', ['Seuraa meitä Instagramissa', 'Jaa kokemuksesi sosiaalisessa mediassa', 'Katso uusimmat uutiset kanaviltamme', 'Löydät meidät myös Facebookista', 'Tilaa ajankohtaiset uutiset sähköpostiisi']],
  ],
  sv: [
    ['navigation', ['Startsida', 'Kontaktuppgifter', 'Öppettider', 'Boka bord', 'Hitta restaurang']],
    ['page', ['Mer information om restaurangen', 'Läs om våra tjänster', 'Följ oss på sociala medier', 'Prenumerera på nyhetsbrevet', 'Välkommen till restaurangen']],
    ['instructions', ['Visa platsen på kartan', 'Gå till startsidan', 'Välj språk', 'Öppna kontaktuppgifter', 'Läs mer om restaurangen']],
    ['notices', ['Kontrollera aktuell information med restaurangen', 'Fråga personalen om allergener', 'Priserna inkluderar moms', 'Menyn uppdateras varje vecka', 'Välkommen åter']],
    ['opening-hours', ['Öppet måndag till fredag klockan 10–18', 'Köket stänger en halvtimme före restaurangen', 'Avvikande öppettider finns på den här sidan', 'Restaurangen är stängd på söndagar', 'Vi serverar lunch på vardagar']],
    ['contact', ['Adress: Exempelgatan 1', 'Telefon: 000 000 0000', 'Skicka ett e-postmeddelande till oss', 'Kontakta oss via formuläret', 'Du hittar oss i stadens centrum', '123 45 Exempelstad', 'Gatuadress 12, 123 45 Exempelstad', 'Postnummer 123 45, Exempelstad', 'SE-123 45 Exempelstad', '123 45 Stockholm']],
    ['reservations', ['Boka bord enkelt på nätet', 'Vi tar inga bordsbokningar till lunchen', 'Bekräfta bokningen via e-post', 'Fråga personalen om lediga bord', 'Ändra din bokning via länken']],
    ['events', ['Ordna ett privat evenemang i restaurangen', 'Festmenyn anpassas efter sällskapets önskemål', 'Be om en offert för ditt evenemang', 'Lokalen passar även för möten', 'Kontakta oss om gruppbokningar']],
    ['story', ['Läs om restaurangens historia', 'Vi vill skapa en trivsam mötesplats', 'Vi har välkomnat gäster i många år', 'En god stämning är viktig för oss', 'Läs mer om vårt arbete']],
    ['values', ['Hållbarhet vägleder vårt arbete', 'Vi vill minska matsvinnet', 'Vi samarbetar med lokala producenter', 'Vi utvecklar tjänsten med hjälp av feedback', 'Alla är välkomna till restaurangen']],
    ['forms', ['Lämna feedback om ditt besök', 'Prenumerera på vårt nyhetsbrev här', 'Välj önskat språk', 'Skicka en kontaktförfrågan', 'Ladda ner lunchlistan som PDF']],
    ['availability', ['Dagens lunchmeny publiceras på morgonen', 'Veckans lunchmeny uppdateras på måndag', 'Ingen lunchmeny finns tillgänglig i dag', 'Lunchmenyn har inte publicerats ännu', 'Kontrollera menyns giltighetsdatum']],
    ['social', ['Följ oss på Instagram', 'Dela din upplevelse på sociala medier', 'Se de senaste nyheterna i våra kanaler', 'Du hittar oss också på Facebook', 'Prenumerera på nyheter via e-post']],
  ],
};

async function ensureArchive() {
  if (!refresh) {
    try {
      const cached = await readFile(zipPath);
      if (cached.length <= 5_000_000 && cached[0] === 0x50 && cached[1] === 0x4b) return cached;
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const response = await fetch(archiveUrl, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const body = await response.text();
    if (/cloudflare|enable javascript|security verification|just a moment/i.test(body)) {
      throw new Error(`Fineli blocked the automated download (HTTP ${response.status}). Download the official ZIP from ${sourceUrl}, save it as ${path.relative(root, zipPath)}, then rerun this command.`);
    }
    throw new Error(`Fineli download failed with HTTP ${response.status}.`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length > 5_000_000 || archive[0] !== 0x50 || archive[1] !== 0x4b) {
    throw new Error('Fineli download was not the expected small ZIP archive.');
  }
  await mkdir(privateDir, { recursive: true });
  await writeFile(zipPath, archive);
  return archive;
}

function parseSemicolonCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ';') { row.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function decodeCsv(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(fullPath));
    else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.csv')) files.push(fullPath);
  }
  return files;
}

function languageFrom(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'FI' || normalized === 'FIN' || normalized === 'FINNISH') return 'fi';
  if (normalized === 'SV' || normalized === 'SWE' || normalized === 'SWEDISH') return 'sv';
  return null;
}

const archive = await ensureArchive();
const archiveSha256 = createHash('sha256').update(archive).digest('hex');
extractDir = path.join(privateDir, `fineli-source-${archiveSha256.slice(0, 12)}`);
await mkdir(extractDir, { recursive: true });
try { await execFile('tar', ['-xf', zipPath, '-C', extractDir]); }
catch (error) { throw new Error(`Could not extract the Fineli archive with tar: ${error.message}`); }

const dataSource = {
  name: 'Fineli Open Data',
  sourceUrl,
  license: 'CC BY 4.0',
  licenseUrl,
  permissionBasis: 'explicit-license',
  approvedForModelRelease: true,
  commercialUseApproved: true,
};
const syntheticSource = {
  name: 'Lunumi synthetic Finnish and Swedish page-noise examples',
  sourceUrl: 'https://github.com/cudldev/lunumi',
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  permissionBasis: 'explicit-license',
  approvedForModelRelease: true,
  commercialUseApproved: true,
};
const examples = [];
const exampleKeys = new Set();
const counts = { fi: 0, sv: 0 };
const foodNamesByLanguage = { fi: [], sv: [] };
const syntheticMenuCounts = { fi: 0, sv: 0 };
for (const csvPath of await filesBelow(extractDir)) {
  const filename = path.basename(csvPath);
  if (!/^food(?:name|\.csv)/i.test(filename)) continue;
  const rows = parseSemicolonCsv(decodeCsv(await readFile(csvPath)));
  if (rows.length < 2) continue;
  const headers = rows[0].map(value => value.replace(/^\uFEFF/, '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const idIndex = headers.findIndex(header => ['FOODID', 'ID'].includes(header));
  const languageIndex = headers.findIndex(header => ['LANG', 'LANGUAGE'].includes(header));
  const filenameLanguage = filename.match(/(?:_|-)(FI|SV)\.CSV$/i)?.[1];
  const nameColumns = ['fi', 'sv'].flatMap(language => {
    const code = language.toUpperCase();
    const index = headers.findIndex(header => [`FOODNAME${code}`, `${code}FOODNAME`, `NAME${code}`, `${code}NAME`].includes(header));
    return index >= 0 ? [[language, index]] : [];
  });
  const commonNameIndex = headers.findIndex(header => ['FOODNAME', 'NAME'].includes(header));
  if (idIndex < 0 || (commonNameIndex < 0 && nameColumns.length === 0)
    || (commonNameIndex >= 0 && !filenameLanguage && languageIndex < 0 && nameColumns.length === 0)) continue;

  for (const row of rows.slice(1)) {
    const id = String(row[idIndex] ?? '').trim();
    if (!id) continue;
    const names = nameColumns.length ? nameColumns : [[languageFrom(filenameLanguage || row[languageIndex]), commonNameIndex]];
    for (const [language, nameIndex] of names) {
      const name = String(row[nameIndex] ?? '').replace(/\s+/g, ' ').trim();
      if (!language || !name || name.length > 220) continue;
      const key = `${language}\n${id}\n${name.toLocaleLowerCase(language)}`;
      if (exampleKeys.has(key)) continue;
      exampleKeys.add(key);
      counts[language] += 1;
      foodNamesByLanguage[language].push({ id, name });
      examples.push({ key, schema: 1, language, text: name, label: 'dish', group: `fineli-food-${id}`, source: dataSource });
    }
  }
}

for (const [language, names] of Object.entries(foodNamesByLanguage)) {
  const offset = Math.max(1, Math.floor(names.length * 0.371));
  for (let index = 0; index < names.length; index += 1) {
    const first = names[index];
    const second = names[(index + offset) % names.length];
    if (!second || first.name.toLocaleLowerCase(language) === second.name.toLocaleLowerCase(language)) continue;
    const conjunction = language === 'fi' ? (index % 2 ? ' ja ' : ' sekä ') : (index % 2 ? ' och ' : ' med ');
    const text = `${first.name}${conjunction}${second.name}`.replace(/\s+/g, ' ').trim();
    if (text.length > 220) continue;
    const key = `${language}\nsynthetic-menu-${first.id}\n${text.toLocaleLowerCase(language)}`;
    if (exampleKeys.has(key)) continue;
    exampleKeys.add(key);
    syntheticMenuCounts[language] += 1;
    examples.push({ schema: 1, language, text, label: 'dish', group: `fineli-food-${first.id}`, source: dataSource, synthetic: 'fineli-menu-composition-v1' });
  }
}

for (const [language, groups] of Object.entries(syntheticNoise)) {
  for (const [group, texts] of groups) {
    for (const text of texts) {
      examples.push({ schema: 1, language, text, label: 'other', group: `synthetic-${language}-${group}`, source: syntheticSource });
    }
  }
}

if (counts.fi < 1000 || counts.sv < 1000) {
  throw new Error(`Fineli name extraction looks incomplete (Finnish: ${counts.fi}, Swedish: ${counts.sv}); expected at least 1,000 names per language.`);
}
await mkdir(privateDir, { recursive: true });
await writeFile(outputPath, `${examples.map(({ key, ...example }) => JSON.stringify(example)).join('\n')}\n`);
const manifest = {
  ...dataSource,
  archiveUrl,
  archiveSha256,
  fetchedAt: new Date().toISOString(),
  counts: {
    ...counts,
    syntheticMenuFi: syntheticMenuCounts.fi,
    syntheticMenuSv: syntheticMenuCounts.sv,
    syntheticOtherFi: syntheticNoise.fi.reduce((sum, [, texts]) => sum + texts.length, 0),
    syntheticOtherSv: syntheticNoise.sv.reduce((sum, [, texts]) => sum + texts.length, 0),
  },
  labelsPath: path.relative(root, outputPath).replaceAll(path.sep, '/'),
};
await writeFile(path.join(privateDir, 'fineli-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared ${counts.fi} Finnish and ${counts.sv} Swedish CC BY food names, synthetic menu-line compositions, and authored page-noise examples.`);
console.log(`Labels: ${path.relative(root, outputPath)} (Git-ignored). Refresh the cached dataset with --refresh.`);
