export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"' && !quoted && field === '') {
      quoted = true;
    } else if (char === '"' && quoted) {
      quoted = false;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV ended inside a quoted field.');
  if (field.length || row.length) {
    row.push(field);
    if (row.some(value => value.trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim());
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be non-empty and unique.');
  return rows.map((values, rowIndex) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

export function menuStatExamples(rows, source) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('MenuStat CSV contains no data rows.');
  const required = ['Restaurant_ID', 'Item_Name', 'Food_Category'];
  for (const name of required) if (!(name in rows[0])) throw new Error(`MenuStat CSV is missing the ${name} column.`);
  const examples = [];
  const seenItems = new Set();
  const seenSections = new Set();
  for (const row of rows) {
    const restaurantId = String(row.Restaurant_ID ?? '').trim();
    const name = String(row.Item_Name ?? '').replace(/\s+/g, ' ').trim();
    if (restaurantId && name.length >= 3 && name.length <= 220) {
      const key = `${restaurantId}\n${name.toLocaleLowerCase('en-US')}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        examples.push({ schema: 1, language: 'en', text: name, label: 'dish', group: `menustat-restaurant-${restaurantId}`, source });
      }
    }
    const category = String(row.Food_Category ?? '').replace(/\s+/g, ' ').trim();
    if (category.length >= 3 && category.length <= 100) {
      const key = category.toLocaleLowerCase('en-US');
      if (!seenSections.has(key)) {
        seenSections.add(key);
        examples.push({ schema: 1, language: 'en', text: category, label: 'section', group: `menustat-category-${key}`, source });
      }
    }
  }
  if (!examples.some(example => example.label === 'dish')) throw new Error('MenuStat CSV contains no valid item names.');
  if (!examples.some(example => example.label === 'section')) throw new Error('MenuStat CSV contains no valid food categories.');
  return examples;
}
