import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { trainingSourceMetadata, validateCommercialLicense } from '../../scripts/menu-training-annotation.mjs';
import { splitByGroup } from './split.mjs';

const root = process.cwd();
const privateDir = path.resolve(root, 'data/private-menu-training');
const labelsPath = path.resolve(process.argv[2] ?? path.join(privateDir, 'labels.jsonl'));
const outputDir = path.resolve(process.argv[3] ?? path.join(root, 'public/models'));
const buckets = 4096;
const allowedLabels = new Set(['dish', 'section', 'other']);

function features(text) {
  const normalized = `^${text.toLowerCase().trim()}$`;
  const vector = new Map();
  const chars = [...normalized];
  for (let start = 0; start < chars.length; start += 1) {
    for (let size = 2; size <= 5 && start + size <= chars.length; size += 1) {
      const gram = chars.slice(start, start + size).join('');
      let hash = 2166136261;
      for (const char of gram) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
      const index = hash % buckets;
      vector.set(index, (vector.get(index) ?? 0) + 1);
    }
  }
  return vector;
}

function scoreText(text, model) {
  const vector = features(text);
  const scores = {};
  for (const label of model.classes) {
    let score = model.logPrior[label];
    for (const [index, count] of vector) score += count * model.logLikelihood[label][index];
    scores[label] = score;
  }
  const max = Math.max(...Object.values(scores));
  const exp = Object.fromEntries(Object.entries(scores).map(([label, score]) => [label, Math.exp(score - max)]));
  const total = Object.values(exp).reduce((sum, score) => sum + score, 0);
  return Object.fromEntries(Object.entries(exp).map(([label, score]) => [label, score / total]));
}

let lines;
try { lines = (await readFile(labelsPath, 'utf8')).split(/\r?\n/).filter(Boolean); }
catch (error) {
  if (error?.code === 'ENOENT') throw new Error('Missing ignored training labels. Run npm run model:prepare first; see docs/menu-training.md.');
  throw error;
}
const all = lines.map((line, index) => {
  const example = JSON.parse(line);
  if (!['en', 'fi', 'sv'].includes(example.language) || !allowedLabels.has(example.label) || typeof example.text !== 'string' || !example.text.trim()) {
    throw new Error(`Invalid annotation on line ${index + 1}.`);
  }
  const source = trainingSourceMetadata(example);
  try { validateCommercialLicense(source); }
  catch (error) { throw new Error(`Line ${index + 1}: ${error.message}`); }
  if (source.approvedForModelRelease !== true || source.commercialUseApproved !== true || !source.license
    || !source.licenseUrl || !source.sourceUrl || !['explicit-license', 'written-permission', 'open-data-terms'].includes(source.permissionBasis)
    || (['written-permission', 'open-data-terms'].includes(source.permissionBasis)
      && !(source.rightsEvidenceUrl || source.sourceRightsEvidenceUrl))) {
    throw new Error(`Line ${index + 1} has no license evidence approved for released weights and future commercial use.`);
  }
  return { ...example, source, text: example.text.trim() };
});

function fit(examples, classes) {
  const classCounts = Object.fromEntries(classes.map(label => [label, 0]));
  const tokenCounts = Object.fromEntries(classes.map(label => [label, new Float64Array(buckets)]));
  const totals = Object.fromEntries(classes.map(label => [label, 0]));
  for (const example of examples) {
    classCounts[example.label] += 1;
    for (const [index, count] of features(example.text)) {
      tokenCounts[example.label][index] += count;
      totals[example.label] += count;
    }
  }
  return {
    classes,
    logPrior: Object.fromEntries(classes.map(label => [label, Math.log(classCounts[label] / examples.length)])),
    logLikelihood: Object.fromEntries(classes.map(label => [label,
      Array.from(tokenCounts[label], count => Math.log((count + 1) / (totals[label] + buckets))),
    ])),
    exampleCounts: classCounts,
  };
}

for (const language of [...new Set(all.map(example => example.language))].sort()) {
  const languageExamples = all.filter(example => example.language === language);
  const classes = [...new Set(languageExamples.map(example => example.label))].sort();
  if (classes.length < 2) throw new Error(`${language}: training needs at least two different labels.`);
  const sourceKey = example => example.sourceUrl || example.sourceName || example.source?.sourceUrl || example.source?.name || 'unknown-source';
  const groupKey = example => example.group == null || String(example.group).trim() === ''
    ? null
    : `${sourceKey(example)}\n${String(example.group).trim()}`;
  const sources = [...new Set(languageExamples.map(sourceKey))];
  const groups = [...new Set(languageExamples.map(groupKey).filter(Boolean))];
  let splitKind = '';
  let split;
  if (sources.length >= 5) {
    split = splitByGroup(languageExamples, classes, sourceKey);
    if (split) splitKind = 'source-held-out';
  }
  if (!split && groups.length >= 5) {
    split = splitByGroup(languageExamples, classes, groupKey);
    if (split) splitKind = 'item-group-held-out';
  }
  if (!split) {
    split = splitByGroup(languageExamples, classes, example => `${example.label}\n${example.text.toLowerCase()}`);
    splitKind = 'exact-text-held-out';
  }
  if (!split) throw new Error(`${language}: could not create a deterministic holdout with every label represented in train and validation.`);
  const { train, validation } = split;

  const fitted = fit(train, classes);
  const classMetrics = Object.fromEntries(classes.map(label => [label, { truePositive: 0, falsePositive: 0, falseNegative: 0, support: 0 }]));
  const runtimeFilterThreshold = 0.9;
  const runtimeFilter = { selected: 0, correct: 0, dishSupport: 0, dishFiltered: 0, sectionSupport: 0, sectionFiltered: 0 };
  let correct = 0;
  for (const example of validation) {
    const probabilities = scoreText(example.text, fitted);
    const predicted = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
    if (example.label === 'dish') runtimeFilter.dishSupport += 1;
    if (example.label === 'section') runtimeFilter.sectionSupport += 1;
    if ((probabilities.other ?? 0) >= runtimeFilterThreshold) {
      runtimeFilter.selected += 1;
      if (example.label === 'other') runtimeFilter.correct += 1;
      if (example.label === 'dish') runtimeFilter.dishFiltered += 1;
      if (example.label === 'section') runtimeFilter.sectionFiltered += 1;
    }
    classMetrics[example.label].support += 1;
    if (predicted === example.label) { correct += 1; classMetrics[example.label].truePositive += 1; }
    else { classMetrics[predicted].falsePositive += 1; classMetrics[example.label].falseNegative += 1; }
  }
  const evaluation = {
    split: `deterministic approximately 80/20 ${splitKind}${splitKind === 'exact-text-held-out' ? ' only' : ''}`,
    trainingExamples: train.length,
    validationExamples: validation.length,
    accuracy: correct / validation.length,
    runtimeOtherFilter: {
      threshold: runtimeFilterThreshold,
      selectedLines: runtimeFilter.selected,
      precision: runtimeFilter.correct / Math.max(1, runtimeFilter.selected),
      dishRetention: (runtimeFilter.dishSupport - runtimeFilter.dishFiltered) / Math.max(1, runtimeFilter.dishSupport),
      sectionRetention: (runtimeFilter.sectionSupport - runtimeFilter.sectionFiltered) / Math.max(1, runtimeFilter.sectionSupport),
    },
    byLabel: Object.fromEntries(classes.map(label => {
      const { truePositive, falsePositive, falseNegative, support } = classMetrics[label];
      const precision = truePositive / Math.max(1, truePositive + falsePositive);
      const recall = truePositive / Math.max(1, truePositive + falseNegative);
      return [label, { support, precision, recall, f1: (2 * precision * recall) / Math.max(Number.EPSILON, precision + recall) }];
    })),
  };
  const model = {
    schema: 1,
    algorithm: 'character-ngram-multinomial-naive-bayes',
    featureBuckets: buckets,
    language,
    classes,
    trainedAt: new Date().toISOString(),
    training: { ...evaluation, sources: [...new Map(languageExamples.map(example => [example.source.name || example.source.sourceUrl, example.source])).values()] },
    ...fitted,
  };
  const filename = language === 'en' ? 'menu-line-classifier.json' : `menu-line-classifier-${language}.json`;
  const outputPath = path.join(outputDir, filename);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(model)}\n`);
  console.log(`${language}: trained ${train.length}, held out ${validation.length}, accuracy ${(evaluation.accuracy * 100).toFixed(1)}% (${evaluation.split}).`);
  for (const [label, metrics] of Object.entries(evaluation.byLabel)) {
    console.log(`  ${label}: precision ${(metrics.precision * 100).toFixed(1)}%, recall ${(metrics.recall * 100).toFixed(1)}%, n=${metrics.support}`);
  }
  console.log(`  runtime other filter (>=${(runtimeFilterThreshold * 100).toFixed(0)}%): precision ${(evaluation.runtimeOtherFilter.precision * 100).toFixed(1)}%, dish retention ${(evaluation.runtimeOtherFilter.dishRetention * 100).toFixed(1)}%, n=${evaluation.runtimeOtherFilter.selectedLines}`);
  console.log(`  model: ${outputPath}`);
}
console.log(`Training text remains in the Git-ignored local corpus.`);
