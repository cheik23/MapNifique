import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProducts, compileProductPattern, isSameHost } from './extract.js';

function fakePage(jsonLdScripts) {
  return {
    locator(selector) {
      if (selector === 'script[type="application/ld+json"]') {
        return { allTextContents: async () => jsonLdScripts };
      }
      return { count: async () => 0, first() { return this; }, textContent: async () => null, getAttribute: async () => null, nth() { return this; } };
    },
  };
}

test('extracts Product and Offer from JSON-LD', async () => {
  const page = fakePage([JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Gel douche test',
    brand: { '@type': 'Brand', name: 'Marque test' },
    gtin13: '1234567890123',
    image: 'https://shop.example/image.jpg',
    url: 'https://shop.example/p/gel-douche',
    offers: { '@type': 'Offer', price: '3.49', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
  })]);
  const products = await extractProducts(page, 'https://shop.example/categorie');
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Gel douche test');
  assert.equal(products[0].brand, 'Marque test');
  assert.equal(products[0].price, 3.49);
  assert.equal(products[0].currency, 'EUR');
  assert.equal(products[0].gtin, '1234567890123');
  assert.equal(products[0].url, 'https://shop.example/p/gel-douche');
});

test('handles nested graph and list of Product entries', async () => {
  const page = fakePage([JSON.stringify({ '@graph': [
    { '@type': 'Product', name: 'Produit A', url: '/p/a', offers: { price: '2,90' } },
    { '@type': 'Product', name: 'Produit B', url: '/p/b', offers: { price: '4.20' } },
  ] })]);
  const products = await extractProducts(page, 'https://shop.example/categorie');
  assert.equal(products.length, 2);
  assert.equal(products[0].price, 2.9);
  assert.equal(products[1].price, 4.2);
});

test('validates product link pattern and same-host filtering', () => {
  assert.equal(compileProductPattern('/(product|p)/').test('/p/abc'), true);
  assert.equal(isSameHost('https://shop.example/p/abc', 'https://shop.example'), true);
  assert.equal(isSameHost('https://other.example/p/abc', 'https://shop.example'), false);
  assert.throws(() => compileProductPattern('['));
});
