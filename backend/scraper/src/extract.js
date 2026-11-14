function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function collectProducts(value, found = []) {
  if (!value) return found;
  if (Array.isArray(value)) {
    for (const item of value) collectProducts(item, found);
    return found;
  }
  if (typeof value !== 'object') return found;

  const types = asArray(value['@type']).map((item) => String(item).toLowerCase());
  if (types.includes('product') || types.includes('productgroup')) found.push(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'offers') collectProducts(child, found);
  }
  return found;
}

function numberPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  let text = String(value).replace(/[\s\u00a0€]/g, '').replace(/[^0-9,.-]/g, '');
  if (!text) return null;
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function absoluteUrl(value, baseUrl) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value, baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractOffer(offers) {
  const offer = asArray(offers).find((item) => item && typeof item === 'object') || {};
  const price = numberPrice(offer.price ?? offer.lowPrice);
  const regularPrice = numberPrice(offer.priceSpecification?.price ?? offer.priceValidUntilPrice);
  const availability = typeof offer.availability === 'string'
    ? offer.availability.split('/').at(-1).replace(/([A-Z])/g, ' $1').trim()
    : null;
  return {
    price,
    regularPrice: regularPrice !== price ? regularPrice : null,
    currency: String(offer.priceCurrency || 'EUR').toUpperCase().slice(0, 3),
    availability,
    url: offer.url || null,
  };
}

function fromJsonLd(node, pageUrl) {
  const offer = extractOffer(node.offers);
  const imageValue = asArray(node.image)[0];
  const imageUrl = typeof imageValue === 'string' ? imageValue : imageValue?.url || imageValue?.contentUrl || null;
  const brand = typeof node.brand === 'string' ? node.brand : node.brand?.name || null;
  const category = typeof node.category === 'string' ? node.category : asArray(node.category).join(' > ') || null;
  return {
    url: absoluteUrl(node.url || offer.url, pageUrl) || pageUrl,
    name: typeof node.name === 'string' ? node.name.trim() : null,
    brand,
    category,
    gtin: node.gtin13 || node.gtin12 || node.gtin14 || node.gtin8 || node.gtin || node.sku || null,
    imageUrl: absoluteUrl(imageUrl, pageUrl),
    price: offer.price,
    regularPrice: offer.regularPrice,
    currency: offer.currency,
    promotion: node.offers?.description || node.description || null,
    availability: offer.availability,
    priceScope: 'unknown',
    sourceUrl: pageUrl,
  };
}

async function textAt(page, selector) {
  if (!selector) return null;
  try {
    const text = await page.locator(selector).first().textContent({ timeout: 1500 });
    return text?.trim() || null;
  } catch { return null; }
}

async function attrAt(page, selector, attribute = 'src') {
  if (!selector) return null;
  try {
    return await page.locator(selector).first().getAttribute(attribute, { timeout: 1500 });
  } catch { return null; }
}

async function extractCssCards(page, selectors, pageUrl) {
  if (!selectors?.productCard) return [];
  const cards = page.locator(selectors.productCard);
  const count = Math.min(await cards.count().catch(() => 0), 250);
  const products = [];
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const readText = async (selector) => {
      if (!selector) return null;
      try { return (await card.locator(selector).first().textContent({ timeout: 700 }))?.trim() || null; }
      catch { return null; }
    };
    const readAttr = async (selector, attr) => {
      if (!selector) return null;
      try { return await card.locator(selector).first().getAttribute(attr, { timeout: 700 }); }
      catch { return null; }
    };
    const name = await readText(selectors.name);
    if (!name) continue;
    const link = await readAttr(selectors.productLink || 'a[href]', 'href');
    const image = await readAttr(selectors.image, selectors.imageAttribute || 'src');
    const gtinAttr = selectors.gtinAttribute || 'content';
    const gtin = selectors.gtin ? await readAttr(selectors.gtin, gtinAttr) : null;
    products.push({
      url: absoluteUrl(link, pageUrl) || pageUrl,
      name,
      brand: await readText(selectors.brand),
      category: await readText(selectors.category),
      gtin,
      imageUrl: absoluteUrl(image, pageUrl),
      price: numberPrice(await readText(selectors.price)),
      regularPrice: numberPrice(await readText(selectors.regularPrice)),
      currency: 'EUR',
      promotion: await readText(selectors.promotion),
      availability: await readText(selectors.availability),
      priceScope: 'unknown',
      sourceUrl: pageUrl,
    });
  }
  return products;
}

export async function extractProducts(page, pageUrl, selectors = {}) {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents().catch(() => []);
  const jsonLdNodes = [];
  for (const script of scripts) {
    try { jsonLdNodes.push(...collectProducts(JSON.parse(script))); } catch { /* malformed JSON-LD ignored */ }
  }

  let products = jsonLdNodes.map((node) => fromJsonLd(node, pageUrl)).filter((item) => item.name);
  if (!products.length) products = await extractCssCards(page, selectors, pageUrl);

  if (!products.length && selectors.name) {
    const name = await textAt(page, selectors.name);
    if (name) {
      const image = await attrAt(page, selectors.image, selectors.imageAttribute || 'src');
      const gtin = selectors.gtin ? await attrAt(page, selectors.gtin, selectors.gtinAttribute || 'content') : null;
      products = [{
        url: pageUrl,
        name,
        brand: await textAt(page, selectors.brand),
        category: await textAt(page, selectors.category),
        gtin,
        imageUrl: absoluteUrl(image, pageUrl),
        price: numberPrice(await textAt(page, selectors.price)),
        regularPrice: numberPrice(await textAt(page, selectors.regularPrice)),
        currency: 'EUR',
        promotion: await textAt(page, selectors.promotion),
        availability: await textAt(page, selectors.availability),
        priceScope: 'unknown',
        sourceUrl: pageUrl,
      }];
    }
  }

  const deduped = new Map();
  for (const item of products) {
    if (!item.name || !item.url) continue;
    deduped.set(`${item.url}|${item.name}`, item);
  }
  return [...deduped.values()];
}

export function compileProductPattern(pattern) {
  if (!pattern) return null;
  if (pattern.length > 300) throw new Error('productUrlRegex trop long (300 caractères maximum).');
  try { return new RegExp(pattern, 'i'); }
  catch { throw new Error('productUrlRegex invalide.'); }
}

export function isSameHost(url, baseUrl) {
  try { return new URL(url).hostname === new URL(baseUrl).hostname; }
  catch { return false; }
}
