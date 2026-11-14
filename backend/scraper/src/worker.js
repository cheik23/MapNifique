import { initDb, pool, claimNextJob } from './db.js';
import { config } from './config.js';
import { runCrawlJob } from './crawler.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function main() {
  await initDb();
  console.log('[worker] Prêt. Un job à la fois; la concurrence navigateur reste limitée à 2.');

  while (!stopping) {
    let job;
    try {
      job = await claimNextJob();
    } catch (error) {
      console.error('[worker] Erreur lecture file:', error.message);
      await sleep(config.workerPollMs);
      continue;
    }

    if (!job) {
      await sleep(config.workerPollMs);
      continue;
    }

    try {
      const sourceResult = await pool.query('SELECT * FROM sources WHERE id=$1 AND enabled=TRUE', [job.source_id]);
      const source = sourceResult.rows[0];
      if (!source) throw new Error('Source absente ou désactivée.');
      const stats = await runCrawlJob(job, source);
      await pool.query(`UPDATE scrape_jobs SET status='completed', finished_at=NOW() WHERE id=$1`, [job.id]);
      console.log(`[worker] Job ${job.id} terminé: ${stats.pagesSeen} pages, ${stats.productsFound} produits enregistrés, ${stats.skippedByRobots} URL ignorées par robots.txt.`);
    } catch (error) {
      console.error(`[worker] Job ${job.id} en échec:`, error.stack || error.message);
      await pool.query(`UPDATE scrape_jobs SET status='failed', finished_at=NOW(), error=$2 WHERE id=$1`, [job.id, String(error.message || error).slice(0, 2000)]);
    }
  }

  await pool.end();
}

main().catch(async (error) => {
  console.error('[worker] Arrêt fatal:', error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
