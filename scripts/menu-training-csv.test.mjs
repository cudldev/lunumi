import { describe, expect, it } from 'vitest';
import { menuStatExamples, parseCsv } from './menu-training-csv.mjs';

describe('menu training CSV', () => {
  it('parses quoted delimiters, escaped quotes, and embedded line breaks', () => {
    const rows = parseCsv('name,description\r\nSoup,"He said ""fresh,""\nand ready"\r\n');
    expect(rows).toEqual([{ name: 'Soup', description: 'He said "fresh,"\nand ready' }]);
  });

  it('labels menu names and categories while keeping all items from a restaurant together', () => {
    const source = { sourceUrl: 'https://data.example/menu.csv' };
    const examples = menuStatExamples([
      { Restaurant_ID: '1', Item_Name: 'Garden salad', Food_Category: 'Salads' },
      { Restaurant_ID: '1', Item_Name: 'Garden salad', Food_Category: 'Salads' },
      { Restaurant_ID: '2', Item_Name: 'Garden salad', Food_Category: 'Salads' },
    ], source);

    expect(examples.filter(example => example.label === 'dish')).toHaveLength(2);
    expect(examples.filter(example => example.label === 'dish').map(example => example.group)).toEqual([
      'menustat-restaurant-1', 'menustat-restaurant-2',
    ]);
    expect(examples.filter(example => example.label === 'section')).toEqual([
      { schema: 1, language: 'en', text: 'Salads', label: 'section', group: 'menustat-category-salads', source },
    ]);
  });

  it('rejects malformed rows and missing required fields', () => {
    expect(() => parseCsv('name,description\nSoup\n')).toThrow(/expected 2/);
    expect(() => menuStatExamples([{ Item_Name: 'Soup' }], {})).toThrow(/Restaurant_ID/);
  });
});
