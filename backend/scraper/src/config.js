import 'dotenv/config';

const positiveInteger = (value, fallback, maximum = 1_000_000) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
};

const workerJobLeaseMs = Math.max(
  60_000,
  positiveInteger(process.env.WORKER_JOB_LEASE_MS, 15 * 60_000, 24 * 60 * 60_000),
);
const workerJobHeartbeatMs = Math.min(
  Math.max(10_000, positiveInteger(process.env.WORKER_JOB_HEARTBEAT_MS, 60_000, 10 * 60_000)),
  Math.floor(workerJobLeaseMs / 3),
);

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  databaseUrl: process.env.DATABASE_URL,
  trustedProxyIps: [...new Set(
    (process.env.TRUSTED_PROXY_IPS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  )],
  rateLimits: {
    windowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000, 3_600_000),
    publicLimit: positiveInteger(process.env.API_RATE_LIMIT_PER_MINUTE, 180),
    searchLimit: positiveInteger(process.env.SEARCH_RATE_LIMIT_PER_MINUTE, 90),
    adminLimit: positiveInteger(process.env.ADMIN_RATE_LIMIT_PER_MINUTE, 30),
    maxClients: positiveInteger(process.env.RATE_LIMIT_MAX_CLIENTS, 5_000),
  },
  corsOrigins: [...new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://mapnifique.vercel.app',
    ...(process.env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  ])],
  workerPollMs: Math.max(1000, Number(process.env.WORKER_POLL_MS || 3000)),
  workerJobLeaseMs,
  workerJobHeartbeatMs,
  workerJobRetryDelayMs: positiveInteger(process.env.WORKER_JOB_RETRY_DELAY_MS, 5 * 60_000, 24 * 60 * 60_000),
  workerJobMaxAttempts: positiveInteger(process.env.WORKER_JOB_MAX_ATTEMPTS, 3, 10),
  defaultMaxPages: Math.max(1, Number(process.env.DEFAULT_MAX_PAGES || 100)),
  hardMaxPages: Math.max(1, Number(process.env.HARD_MAX_PAGES || 2000)),
  defaultMaxConcurrency: Math.max(1, Math.min(2, Number(process.env.DEFAULT_MAX_CONCURRENCY || 2))),
  defaultRequestsPerMinute: Math.max(1, Number(process.env.DEFAULT_REQUESTS_PER_MINUTE || 12)),
  defaultSameDomainDelaySecs: Math.max(1, Number(process.env.DEFAULT_SAME_DOMAIN_DELAY_SECS || 2)),
};

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL absent. Copie .env.example vers .env et configure le mot de passe PostgreSQL.');
}
