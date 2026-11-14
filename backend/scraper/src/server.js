import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import { initDb, pool } from './db.js';
import { config } from './config.js';
import { initPlacesDb, registerPlaceRoutes } from './places-api.js';
import {
  createRequestRateLimiter,
  safeRequestLogSerializer,
} from './security.js';

const app = Fastify({
  logger: { serializers: { req: safeRequestLogSerializer } },
  trustProxy: config.trustedProxyIps.length ? config.trustedProxyIps : false,
  bodyLimit: 1_000_000,
});
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origine CORS non autorisée.'), false);
  },
});
app.addHook('onRequest', createRequestRateLimiter(config.rateLimits));

function requireAdmin(request, reply) {
  const expected = Buffer.from(String(process.env.PLACES_ADMIN_TOKEN || ''));
  const supplied = Buffer.from(String(request.headers['x-admin-token'] || ''));

  const valid = expected.length > 0
    && expected.length === supplied.length
    && timingSafeEqual(expected, supplied);

  if (!valid) {
    reply.code(401).send({
      error: 'Authentification administrateur requise.',
    });
    return false;
  }

  return true;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('L’URL doit commencer par http:// ou https://.');
  if (url.username || url.password) throw new Error('Les URL avec identifiants intégrés sont refusées.');
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Un domaine public d’enseigne est requis.');
  return url;
}

function validateUrls(urls, baseUrl) {
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 20) throw new Error('Fournis entre 1 et 20 URL de départ.');
  return [...new Set(urls.map((value) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocole URL non autorisé.');
    if (url.hostname !== baseUrl.hostname) throw new Error('Toutes les URL doivent appartenir au domaine enregistré pour cette enseigne.');
    return url.toString();
  }))];
}

app.get('/health', async () => {
  const result = await pool.query('SELECT NOW() AS database_time');
  return { status: 'ok', database: 'connected', databaseTime: result.rows[0].database_time };
});

app.get('/api/sources', async () => {
  const result = await pool.query(`
    SELECT id, name, base_url AS "baseUrl", product_url_regex AS "productUrlRegex",
           enabled, requests_per_minute AS "requestsPerMinute",
           same_domain_delay_secs AS "sameDomainDelaySecs",
           max_pages_per_run AS "maxPagesPerRun", created_at AS "createdAt"
      FROM sources ORDER BY name
  `);
  return { sources: result.rows };
});

app.post('/api/sources', async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  try {
    const body = request.body || {};
    const id = String(body.id || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) throw new Error('ID invalide : 2 à 49 caractères minuscules, chiffres ou tirets.');
    if (!name || name.length > 100) throw new Error('Nom d’enseigne obligatoire (100 caractères maximum).');
    const base = normalizeBaseUrl(body.baseUrl);
    const rpm = Math.max(1, Math.min(120, Number(body.requestsPerMinute || config.defaultRequestsPerMinute)));
    const delay = Math.max(1, Math.min(60, Number(body.sameDomainDelaySecs || config.defaultSameDomainDelaySecs)));
    const maxPages = Math.max(1, Math.min(config.hardMaxPages, Number(body.maxPagesPerRun || config.defaultMaxPages)));
    const selectors = body.selectors && typeof body.selectors === 'object' && !Array.isArray(body.selectors) ? body.selectors : {};
    if (JSON.stringify(selectors).length > 10000) throw new Error('La configuration des sélecteurs est trop volumineuse.');

    const result = await pool.query(`
      INSERT INTO sources (id,name,base_url,product_url_regex,selectors,requests_per_minute,same_domain_delay_secs,max_pages_per_run,updated_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,NOW())
      ON CONFLICT (id) DO UPDATE SET
        name=EXCLUDED.name, base_url=EXCLUDED.base_url,
        product_url_regex=EXCLUDED.product_url_regex, selectors=EXCLUDED.selectors,
        requests_per_minute=EXCLUDED.requests_per_minute,
        same_domain_delay_secs=EXCLUDED.same_domain_delay_secs,
        max_pages_per_run=EXCLUDED.max_pages_per_run,
        updated_at=NOW()
      RETURNING id,name,base_url AS "baseUrl",enabled
    `, [id, name, base.origin, body.productUrlRegex ? String(body.productUrlRegex).slice(0,300) : null,
        JSON.stringify(selectors), rpm, delay, maxPages]);
    return reply.code(201).send({ source: result.rows[0] });
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
});

app.post('/api/crawls', async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  try {
    const body = request.body || {};
    const sourceId = String(body.sourceId || '').trim();
    const result = await pool.query('SELECT * FROM sources WHERE id=$1 AND enabled=TRUE', [sourceId]);
    const source = result.rows[0];
    if (!source) throw new Error('Enseigne inconnue ou désactivée. Crée d’abord la source.');
    const urls = validateUrls(body.urls, new URL(source.base_url));
    const maxPages = Math.max(1, Math.min(Number(body.maxPages || config.defaultMaxPages), source.max_pages_per_run, config.hardMaxPages));
    const job = await pool.query(`
      INSERT INTO scrape_jobs (source_id,start_urls,max_pages) VALUES ($1,$2::jsonb,$3)
      RETURNING id,status,created_at AS "createdAt"
    `, [sourceId, JSON.stringify(urls), maxPages]);
    return reply.code(202).send({ job: job.rows[0], message: 'Collecte mise en file. Le worker la traitera en arrière-plan.' });
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
});

app.get('/api/crawls/:id', async (request, reply) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return reply.code(400).send({ error: 'Identifiant invalide.' });
  const result = await pool.query(`
    SELECT id,source_id AS "sourceId",status,pages_seen AS "pagesSeen",
           products_found AS "productsFound",skipped_by_robots AS "skippedByRobots",
           attempts,error,created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt"
      FROM scrape_jobs WHERE id=$1
  `, [id]);
  if (!result.rows[0]) return reply.code(404).send({ error: 'Collecte introuvable.' });
  return { job: result.rows[0] };
});

app.get('/api/products', async (request, reply) => {
  const limit = Math.max(1, Math.min(100, Number(request.query.limit || 25)));
  const offset = Math.max(0, Number(request.query.offset || 0));
  const query = String(request.query.q || '').trim().slice(0, 120);
  const sourceId = request.query.sourceId ? String(request.query.sourceId).slice(0, 50) : null;
  const result = await pool.query(`
    SELECT p.id,p.source_id AS "sourceId",s.name AS retailer,p.product_url AS url,
           p.gtin,p.name,p.brand,p.category,p.image_url AS "imageUrl",p.last_seen_at AS "lastSeenAt",
           latest.price,latest.regular_price AS "regularPrice",latest.currency,latest.promotion,
           latest.availability,latest.price_scope AS "priceScope",latest.store_code AS "storeCode",
           latest.observed_at AS "priceObservedAt"
      FROM products p JOIN sources s ON s.id=p.source_id
      LEFT JOIN LATERAL (
        SELECT price,regular_price,currency,promotion,availability,price_scope,store_code,observed_at
          FROM price_observations WHERE product_id=p.id ORDER BY observed_at DESC LIMIT 1
      ) latest ON TRUE
     WHERE ($1::text IS NULL OR p.source_id=$1)
       AND ($2='' OR p.name ILIKE '%' || $2 || '%' OR COALESCE(p.brand,'') ILIKE '%' || $2 || '%' OR COALESCE(p.gtin,'')=$2)
     ORDER BY p.last_seen_at DESC LIMIT $3 OFFSET $4
  `, [sourceId, query, limit, offset]);
  return { products: result.rows, limit, offset };
});

app.get('/api/products/:id/prices', async (request, reply) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return reply.code(400).send({ error: 'Identifiant invalide.' });
  const result = await pool.query(`
    SELECT store_code AS "storeCode",price,regular_price AS "regularPrice",currency,
           promotion,availability,price_scope AS "priceScope",source_url AS "sourceUrl",observed_at AS "observedAt"
      FROM price_observations WHERE product_id=$1 ORDER BY observed_at DESC LIMIT 1000
  `, [id]);
  return { observations: result.rows };
});

await initDb();
await initPlacesDb(pool);
registerPlaceRoutes(app, pool);
await app.listen({ host: config.host, port: config.port });
console.log(`[api] MapNifique Scraper API prête sur http://127.0.0.1:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
