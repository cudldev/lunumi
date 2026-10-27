import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { makeAnnotationRecord, validateCandidateForAnnotation } from './menu-training-annotation.mjs';

const root = process.cwd();
const privateDir = path.resolve(root, 'data/private-menu-training');
const candidatesPath = path.resolve(process.argv[2] ?? path.join(privateDir, 'candidates.jsonl'));
const labelsPath = path.resolve(process.argv[3] ?? path.join(privateDir, 'labels.jsonl'));

function ensurePrivatePath(target) {
  const relative = path.relative(privateDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Training files must stay inside ${path.relative(root, privateDir)}.`);
  }
}

function parseJsonLines(text, file) {
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${path.relative(root, file)} line ${index + 1} is not valid JSON.`); }
  });
}

ensurePrivatePath(candidatesPath);
ensurePrivatePath(labelsPath);
const candidates = parseJsonLines(await readFile(candidatesPath, 'utf8'), candidatesPath);
let prior = [];
try { prior = parseJsonLines(await readFile(labelsPath, 'utf8'), labelsPath); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
const labelledHashes = new Set(prior.map(record => record.contentHash));
const rl = readline.createInterface({ input: stdin, output: stdout });
let added = 0;

try {
  for (const [index, candidate] of candidates.entries()) {
    if (labelledHashes.has(candidate?.contentHash)) continue;
    try { validateCandidateForAnnotation(candidate); }
    catch (error) {
      console.warn(`Skipped candidate ${index + 1}: ${error.message}`);
      continue;
    }
    console.log(`\n[${index + 1}/${candidates.length}] ${candidate.sourceName ?? candidate.sourceUrl} · ${candidate.language}`);
    console.log(`Source: ${candidate.sourceUrl}`);
    console.log(`License: ${candidate.license} (${candidate.permissionBasis})`);
    if (candidate.sourceRightsEvidenceUrl || candidate.rightsEvidenceUrl) {
      console.log(`Rights evidence: ${candidate.sourceRightsEvidenceUrl || candidate.rightsEvidenceUrl}`);
    }
    console.log(`\n${candidate.text}\n`);
    const answer = (await rl.question('[d]ish, [s]ection, [o]ther, [k]skip, [q]uit: ')).trim().toLocaleLowerCase();
    if (answer === 'q') break;
    if (answer === 'k' || !answer) continue;
    const label = ({ d: 'dish', s: 'section', o: 'other' })[answer];
    if (!label) { console.warn('Unknown choice; candidate skipped.'); continue; }
    const record = makeAnnotationRecord(candidate, label);
    await mkdir(path.dirname(labelsPath), { recursive: true });
    await appendFile(labelsPath, `${JSON.stringify(record)}\n`, 'utf8');
    labelledHashes.add(candidate.contentHash);
    added += 1;
  }
} finally {
  rl.close();
}
console.log(`Added ${added} reviewed labels to ${path.relative(root, labelsPath)} (Git-ignored).`);
