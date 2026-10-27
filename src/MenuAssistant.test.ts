import { describe, expect, it } from 'vitest';
import { parseMenu, schemaMenuLines } from './MenuAssistant';

describe('structured menu extraction', () => {
  it('reads Schema.org menu items, section, image, price, explicit diet, and allergen metadata', () => {
    const menu = {
      '@type': 'Menu',
      hasMenuSection: [{
        '@type': 'MenuSection',
        name: 'Lunch',
        hasMenuItem: [{
          '@type': 'MenuItem',
          name: 'Roasted vegetable bowl',
          description: 'Root vegetables with tahini dressing.',
          image: 'https://restaurant.example/images/bowl.jpg',
          suitableForDiet: 'https://schema.org/VeganDiet',
          offers: { '@type': 'Offer', price: '12.90', priceCurrency: 'EUR' },
          additionalProperty: [{ '@type': 'PropertyValue', name: 'Allergens', value: 'Sesame' }],
        }],
      }],
    };
    const fakeDocument = {
      querySelectorAll: () => [{ textContent: JSON.stringify(menu) }],
    } as unknown as Document;

    const lines = schemaMenuLines(fakeDocument, 'https://restaurant.example/menu');
    const parsed = parseMenu(lines.join('\n'), 'en', null);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      section: 'Lunch',
      name: 'Roasted vegetable bowl',
      description: 'Root vegetables with tahini dressing.',
      price: '12.90 EUR',
      imageUrl: 'https://restaurant.example/images/bowl.jpg',
      diets: ['Marked vegan'],
      allergenInfo: ['Sesame'],
    });
    expect(parsed.items[0].sourceText).toContain('VeganDiet');
  });

  it('ignores unsafe image hosts and retains supported menu text without inventing a currency', () => {
    const menu = {
      '@type': 'Menu',
      hasMenuItem: [{
        '@type': 'MenuItem',
        name: 'Fish soup',
        image: 'https://images.example/soup.jpg',
        offers: { price: '10.50' },
      }],
    };
    const fakeDocument = { querySelectorAll: () => [{ textContent: JSON.stringify(menu) }] } as unknown as Document;

    const parsed = parseMenu(schemaMenuLines(fakeDocument, 'https://restaurant.example/menu').join('\n'), 'en', null);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].price).toBe('10.50');
    expect(parsed.items[0].imageUrl).toBeUndefined();
  });
});
