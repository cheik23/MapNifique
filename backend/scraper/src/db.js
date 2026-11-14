import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      product_url_regex TEXT,
      selectors JSONB NOT NULL DEFAULT '{}'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      requests_per_minute INTEGER NOT NULL DEFAULT 12 CHECK (requests_per_minute BETWEEN 1 AND 120),
      same_domain_delay_secs NUMERIC(6,2) NOT NULL DEFAULT 2 CHECK (same_domain_delay_secs >= 1),
      max_pages_per_run INTEGER NOT NULL DEFAULT 100 CHECK (max_pages_per_run BETWEEN 1 AND 2000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id BIGSERIAL PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      start_urls JSONB NOT NULL,
      max_pages INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
      pages_seen INTEGER NOT NULL DEFAULT 0,
      products_found INTEGER NOT NULL DEFAULT 0,
      skipped_by_robots INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS scrape_jobs_queue_idx ON scrape_jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      product_url TEXT NOT NULL,
      gtin TEXT,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      image_url TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_id, product_url)
    );
    CREATE INDEX IF NOT EXISTS products_name_idx ON products USING GIN (to_tsvector('simple', name));
    CREATE INDEX IF NOT EXISTS products_source_idx ON products(source_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS products_gtin_idx ON products(gtin) WHERE gtin IS NOT NULL;

    CREATE TABLE IF NOT EXISTS price_observations (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      store_code TEXT,
      price NUMERIC(14,4),
      regular_price NUMERIC(14,4),
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      promotion TEXT,
      availability TEXT,
      price_scope TEXT NOT NULL DEFAULT 'unknown' CHECK (price_scope IN ('store','drive','national','unknown')),
      source_url TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS price_product_date_idx ON price_observations(product_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS price_date_idx ON price_observations(observed_at DESC);
    CREATE INDEX IF NOT EXISTS price_store_date_idx ON price_observations(store_code, observed_at DESC) WHERE store_code IS NOT NULL;
  `);
}

export async function insertProductAndPrice(sourceId, product) {
  const productUrl = product.url;
  if (!productUrl || !product.name) return false;

  const result = await pool.query(`
    INSERT INTO products (source_id, product_url, gtin, name, brand, category, image_url, last_seen_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (source_id, product_url) DO UPDATE SET
      gtin = COALESCE(EXCLUDED.gtin, products.gtin),
      name = EXCLUDED.name,
      brand = COALESCE(EXCLUDED.brand, products.brand),
      category = COALESCE(EXCLUDED.category, products.category),
      image_url = COALESCE(EXCLUDED.image_url, products.image_url),
      last_seen_at = NOW()
    RETURNING id
  `, [sourceId, productUrl, product.gtin || null, product.name, product.brand || null,
      product.category || null, product.imageUrl || null]);

  const productId = result.rows[0].id;
  if (product.price === null || product.price === undefined) return true;

  const observedDay = new Date().toISOString().slice(0, 10);
  const fingerprintPayload = JSON.stringify({
    day: observedDay,
    storeCode: product.storeCode || null,
    price: product.price,
    regularPrice: product.regularPrice ?? null,
    currency: product.currency || 'EUR',
    promotion: product.promotion || null,
    availability: product.availability || null,
    priceScope: product.priceScope || 'unknown',
  });
  const fingerprint = Buffer.from(fingerprintPayload).toString('base64url');

  await pool.query(`
    INSERT INTO price_observations
      (product_id, store_code, price, regular_price, currency, promotion, availability, price_scope, source_url, fingerprint)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (product_id, fingerprint) DO NOTHING
  `, [productId, product.storeCode || null, product.price, product.regularPrice ?? null,
      product.currency || 'EUR', product.promotion || null, product.availability || null,
      product.priceScope || 'unknown', product.sourceUrl || productUrl, fingerprint]);

  return true;
}

export async function claimNextJob() {
  const result = await pool.query(`
    UPDATE scrape_jobs
       SET status='running', started_at=NOW(), attempts=attempts+1, error=NULL
     WHERE id = (
       SELECT id FROM scrape_jobs
        WHERE status='queued'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING *
  `);
  return result.rows[0] || null;
}

export async function updateJobCounters(jobId, { pages = 0, products = 0, robots = 0 } = {}) {
  await pool.query(`
    UPDATE scrape_jobs SET
      pages_seen = pages_seen + $2,
      products_found = products_found + $3,
      skipped_by_robots = skipped_by_robots + $4
    WHERE id=$1
  `, [jobId, pages, products, robots]);
}
