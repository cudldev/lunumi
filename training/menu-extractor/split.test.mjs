import { describe, expect, it } from 'vitest';
import { splitByGroup } from './split.mjs';

describe('grouped model validation split', () => {
  it('holds out deterministic groups while preserving each label in both partitions', () => {
    const examples = [
      ...Array.from({ length: 40 }, (_, index) => ({ label: 'dish', group: `food-${index}` })),
      ...Array.from({ length: 13 }, (_, index) => ({ label: 'other', group: `noise-${index}` })),
    ];
    const first = splitByGroup(examples, ['dish', 'other'], example => example.group);
    const second = splitByGroup(examples, ['dish', 'other'], example => example.group);
    expect(first).not.toBeNull();
    expect(first).toEqual(second);

    const trainGroups = new Set(first.train.map(example => example.group));
    const validationGroups = new Set(first.validation.map(example => example.group));
    expect([...validationGroups].some(group => trainGroups.has(group))).toBe(false);
    for (const label of ['dish', 'other']) {
      expect(first.train.some(example => example.label === label)).toBe(true);
      expect(first.validation.filter(example => example.label === label).length).toBeGreaterThanOrEqual(
        Math.ceil(examples.filter(example => example.label === label).length * 0.2),
      );
    }
  });

  it('declines a grouped split when a label occurs in only one group', () => {
    const examples = [
      { label: 'dish', group: 'one-dish-group' },
      { label: 'dish', group: 'another-dish-group' },
      { label: 'other', group: 'only-other-group' },
    ];
    expect(splitByGroup(examples, ['dish', 'other'], example => example.group)).toBeNull();
  });
});
