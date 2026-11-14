import 'dotenv/config';

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  databaseUrl: process.env.DATABASE_URL,
  corsOrigins: [...new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://mapnifique.vercel.app',
    ...(process.env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  ])],
  workerPollMs: Math.max(1000, Number(process.env.WORKER_POLL_MS || 3000)),
  defaultMaxPages: Math.max(1, Number(process.env.DEFAULT_MAX_PAGES || 100)),
  hardMaxPages: Math.max(1, Number(process.env.HARD_MAX_PAGES || 2000)),
  defaultMaxConcurrency: Math.max(1, Math.min(2, Number(process.env.DEFAULT_MAX_CONCURRENCY || 2))),
  defaultRequestsPerMinute: Math.max(1, Number(process.env.DEFAULT_REQUESTS_PER_MINUTE || 12)),
  defaultSameDomainDelaySecs: Math.max(1, Number(process.env.DEFAULT_SAME_DOMAIN_DELAY_SECS || 2)),
};

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL absent. Copie .env.example vers .env et configure le mot de passe PostgreSQL.');
}
