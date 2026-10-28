export function decode(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&euro;/gi, '€').replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—').replace(/&bull;/gi, '•')
    .replace(/&rsquo;|&lsquo;/gi, '’').replace(/&rdquo;|&ldquo;/gi, '”')
    .replace(/&auml;/gi, 'ä').replace(/&ouml;/gi, 'ö').replace(/&aring;/gi, 'å')
    .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Aring;/g, 'Å')
    .replace(/\s+/g, ' ').trim();
}

function xmlValue(block, name) {
  const expression = new RegExp(`<((?:[\\w.-]+:)?${name})\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}\\s*>`, 'i');
  return decode(block.match(expression)?.[2] ?? '');
}

export function parseFeed(body, contentType) {
  if (/json/i.test(contentType) || /^\s*\{/.test(body)) {
    const data = JSON.parse(body);
    if (!Array.isArray(data.items)) throw new Error('JSON source is not a JSON Feed with an items array.');
    return data.items.map(item => ({
      id: String(item.id ?? item.url ?? ''),
      title: String(item.title ?? ''),
      publishedAt: String(item.date_published ?? item.date_modified ?? ''),
      text: [item.title, item.content_text, item.content_html, item.summary]
        .filter(value => typeof value === 'string').map(decode).filter(Boolean).join('\n'),
    }));
  }
  if (!/xml|rss|atom/i.test(contentType) && !/<(?:rss|feed|channel)\b/i.test(body)) {
    throw new Error(`Unsupported feed content type: ${contentType || 'unknown'}.`);
  }
  const blocks = [...body.matchAll(/<(?:[\w.-]+:)?(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?(?:item|entry)\s*>/gi)].map(match => match[1]);
  return blocks.map(block => {
    const title = xmlValue(block, 'title');
    const description = xmlValue(block, 'description') || xmlValue(block, 'summary');
    const content = xmlValue(block, 'encoded') || xmlValue(block, 'content');
    return {
      id: xmlValue(block, 'guid') || xmlValue(block, 'id'),
      title,
      publishedAt: xmlValue(block, 'pubDate') || xmlValue(block, 'updated'),
      text: [title, description, content].filter(Boolean).join('\n'),
    };
  });
}

export function parseMenuPage(body, contentType) {
  if (!/html|xhtml/i.test(contentType)) throw new Error(`Menu page returned unsupported content type: ${contentType || 'unknown'}.`);
  const clean = body.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const blocks = [...clean.matchAll(/<(h[1-6]|p|li|dt|dd|th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
  const seen = new Set();
  return blocks.flatMap((match, index) => {
    const text = decode(match[2]);
    const key = text.toLocaleLowerCase();
    if (text.length < 8 || text.length > 220 || seen.has(key)) return [];
    seen.add(key);
    return [{ id: `block:${index}`, title: /^h[1-6]$/i.test(match[1]) ? text : '', publishedAt: '', text }];
  });
}
