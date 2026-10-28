import { createHash } from 'node:crypto';

function stableOrder(value) {
  return createHash('sha256').update(value).digest().readUInt32BE(0);
}

export function splitByGroup(examples, classes, identityFor, fraction = 0.2) {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) throw new Error('Holdout fraction must be between zero and one.');
  const groups = new Map();
  const totalByLabel = Object.fromEntries(classes.map(label => [label, 0]));
  const groupSupport = Object.fromEntries(classes.map(label => [label, 0]));
  for (const example of examples) {
    const identity = identityFor(example);
    if (!identity) return null;
    let group = groups.get(identity);
    if (!group) { group = { identity, examples: [], counts: Object.fromEntries(classes.map(label => [label, 0])) }; groups.set(identity, group); }
    if (!(example.label in group.counts)) return null;
    group.examples.push(example);
    group.counts[example.label] += 1;
    totalByLabel[example.label] += 1;
  }
  if (groups.size < 2) return null;
  const orderedGroups = [...groups.values()].sort((a, b) => stableOrder(a.identity) - stableOrder(b.identity) || a.identity.localeCompare(b.identity));
  for (const group of orderedGroups) for (const label of classes) if (group.counts[label]) groupSupport[label] += 1;
  if (classes.some(label => groupSupport[label] < 2)) return null;

  const selected = new Set();
  const validationByLabel = Object.fromEntries(classes.map(label => [label, 0]));
  const trainingByLabel = { ...totalByLabel };
  const targetByLabel = Object.fromEntries(classes.map(label => [label, Math.max(1, Math.ceil(totalByLabel[label] * fraction))]));
  const addGroup = group => {
    selected.add(group.identity);
    for (const label of classes) {
      validationByLabel[label] += group.counts[label];
      trainingByLabel[label] -= group.counts[label];
    }
  };
  const canHoldOut = group => classes.every(label => !group.counts[label] || trainingByLabel[label] - group.counts[label] > 0);

  for (const label of [...classes].sort((a, b) => groupSupport[a] - groupSupport[b] || a.localeCompare(b))) {
    while (validationByLabel[label] < targetByLabel[label]) {
      const candidate = orderedGroups.find(group => !selected.has(group.identity) && group.counts[label] > 0 && canHoldOut(group));
      if (!candidate) return null;
      addGroup(candidate);
    }
  }

  const validationIdentities = new Set(selected);
  return {
    train: examples.filter(example => !validationIdentities.has(identityFor(example))),
    validation: examples.filter(example => validationIdentities.has(identityFor(example))),
  };
}
