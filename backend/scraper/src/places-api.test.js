import test from 'node:test';
import assert from 'node:assert/strict';
import { initPlacesDb, registerPlaceRoutes } from './places-api.js';
import { getDateInTimeZone } from './offer-validity.js';

function makeApp() {
  const routes = new Map();
  return {
    routes,
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
  };
}

function makeReply() {
  return {
    statusCode: 200,
    payload: undefined,
    code(code) { this.statusCode = code; return this; },
    send(payload) { this.payload = payload; return payload; },
  };
}

test('initPlacesDb prepares separate places and offers tables without destructive SQL', async () => {
  let captured = '';
  await initPlacesDb({ query: async (sql) => { captured = sql; return { rows: [] }; } });
  assert.match(captured, /CREATE TABLE IF NOT EXISTS places/i);
  assert.match(captured, /CREATE TABLE IF NOT EXISTS offers/i);
  assert.match(captured, /offers_active_validity_check/i);
  assert.match(captured, /offers_date_range_check/i);
  assert.doesNotMatch(captured, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('GET /api/places validates coordinates and builds a bounded nearby search', async () => {
  const app = makeApp();
  let capturedSql = '';
  let capturedValues = [];
  const pool = { query: async (sql, values = []) => {
    capturedSql = sql;
    capturedValues = values;
    return { rows: [{ id: 7, name: 'Sephora', lat: 48.85, lon: 2.35 }] };
  } };
  registerPlaceRoutes(app, pool);
  const handler = app.routes.get('GET /api/places');
  const result = await handler({ query: { lat: '48.85', lon: '2.35', radiusM: '3000', q: 'Sephora', limit: '12' } }, makeReply());
  assert.equal(result.places.length, 1);
  assert.match(capturedSql, /p\.lat BETWEEN/);
  assert.match(capturedSql, /distance_m/);
  assert.ok(capturedValues.includes(3000));
  assert.ok(capturedValues.includes(12));
});

test('GET /api/places rejects an invalid coordinate pair', async () => {
  const app = makeApp();
  registerPlaceRoutes(app, { query: async () => { throw new Error('database should not be called'); } });
  const reply = makeReply();
  await app.routes.get('GET /api/places')({ query: { lat: '48.85' } }, reply);
  assert.equal(reply.statusCode, 400);
});

test('GET /api/offers returns four empty offer groups when no merchant is selected', async () => {
  const app = makeApp();
  registerPlaceRoutes(app, { query: async () => { throw new Error('database should not be called'); } });
  const result = await app.routes.get('GET /api/offers')({ query: {} }, makeReply());
  assert.deepEqual(result, { storeOffers: [], brandOffers: [], onlineOffers: [], cashbackOffers: [] });
});

test('POST /api/offers requires the private administrator token', async () => {
  const prior = process.env.PLACES_ADMIN_TOKEN;
  delete process.env.PLACES_ADMIN_TOKEN;
  try {
    const app = makeApp();
    registerPlaceRoutes(app, { query: async () => { throw new Error('database should not be called'); } });
    const reply = makeReply();
    await app.routes.get('POST /api/offers')({ body: {}, headers: {} }, reply);
    assert.equal(reply.statusCode, 401);
    assert.match(reply.payload.error, /administrateur/i);
  } finally {
    if (prior !== undefined) process.env.PLACES_ADMIN_TOKEN = prior;
  }
});

test('POST /api/offers rejects an impossible date before writing to the database', async () => {
  const prior = process.env.PLACES_ADMIN_TOKEN;
  process.env.PLACES_ADMIN_TOKEN = 'test-only-admin-token';
  try {
    const app = makeApp();
    let queryCount = 0;
    registerPlaceRoutes(app, { query: async () => { queryCount += 1; return { rows: [] }; } });
    const reply = makeReply();
    await app.routes.get('POST /api/offers')({
      headers: { 'x-admin-token': 'test-only-admin-token' },
      body: {
        sourceId: 'official-test',
        title: 'Promotion vérifiée',
        sourceUrl: 'https://example.com/offre',
        scope: 'brand',
        offerType: 'promotion',
        brandKey: 'example',
        validUntil: '2026-02-31',
      },
    }, reply);

    assert.equal(reply.statusCode, 400);
    assert.match(reply.payload.error, /YYYY-MM-DD/);
    assert.equal(queryCount, 0);
  } finally {
    if (prior === undefined) delete process.env.PLACES_ADMIN_TOKEN;
    else process.env.PLACES_ADMIN_TOKEN = prior;
  }
});

test('POST /api/offers stores date-only values and requires a valid end date to activate', async () => {
  const prior = process.env.PLACES_ADMIN_TOKEN;
  process.env.PLACES_ADMIN_TOKEN = 'test-only-admin-token';
  try {
    const app = makeApp();
    let capturedValues;
    registerPlaceRoutes(app, {
      query: async (_sql, values) => {
        capturedValues = values;
        return { rows: [{ id: 4, title: 'Promotion vérifiée', status: 'active' }] };
      },
    });

    const request = {
      headers: { 'x-admin-token': 'test-only-admin-token' },
      body: {
        sourceId: 'official-test',
        title: 'Promotion vérifiée',
        sourceUrl: 'https://example.com/offre',
        scope: 'brand',
        offerType: 'promotion',
        brandKey: 'example',
        validFrom: getDateInTimeZone(),
        validUntil: getDateInTimeZone(),
        status: 'active',
        verifiedAt: '2026-11-14T10:00:00.000Z',
      },
    };
    const reply = makeReply();
    await app.routes.get('POST /api/offers')(request, reply);

    assert.equal(reply.statusCode, 201);
    assert.equal(capturedValues[14], getDateInTimeZone());
    assert.equal(capturedValues[15], getDateInTimeZone());
    assert.equal(capturedValues[16], 'active');

    const noEndDate = makeReply();
    await app.routes.get('POST /api/offers')({
      ...request,
      body: { ...request.body, validUntil: null },
    }, noEndDate);
    assert.equal(noEndDate.statusCode, 400);
    assert.match(noEndDate.payload.error, /validUntil/);
  } finally {
    if (prior === undefined) delete process.env.PLACES_ADMIN_TOKEN;
    else process.env.PLACES_ADMIN_TOKEN = prior;
  }
});
