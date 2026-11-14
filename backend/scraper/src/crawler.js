import { PlaywrightCrawler } from 'crawlee';
import { extractProducts, compileProductPattern, isSameHost } from './extract.js';
import { insertProductAndPrice, updateJobCounters } from './db.js';
import { config } from './config.js';

function validateStartUrls(urls, baseUrl) {
  const clean = [];
  for (const value of urls) {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Seules les adresses HTTP/HTTPS sont acceptées.');
    if (!isSameHost(url.toString(), baseUrl)) throw new Error('Une URL ne correspond pas au domaine de l’enseigne configurée.');
    clean.push(url.toString());
  }
  return [...new Set(clean)];
}

export async function runCrawlJob(job, source) {
  const startUrls = validateStartUrls(job.start_urls, source.base_url);
  const productPattern = compileProductPattern(source.product_url_regex);
  const maxPages = Math.min(Number(job.max_pages), Number(source.max_pages_per_run), config.hardMaxPages);
  let pagesSeen = 0;
  let productsFound = 0;
  let skippedByRobots = 0;

  const crawler = new PlaywrightCrawler({
    headless: true,
    minConcurrency: 1,
    maxConcurrency: config.defaultMaxConcurrency,
    maxRequestsPerMinute: Number(source.requests_per_minute || config.defaultRequestsPerMinute),
    sameDomainDelaySecs: Number(source.same_domain_delay_secs || config.defaultSameDomainDelaySecs),
    maxRequestsPerCrawl: maxPages,
    maxRequestRetries: 1,
    navigationTimeoutSecs: 35,
    requestHandlerTimeoutSecs: 60,
    respectRobotsTxtFile: true,
    // Ne jamais activer retryOnBlocked : pas de contournement de CAPTCHA ou de protection.
    retryOnBlocked: false,
    async requestHandler({ page, request, enqueueLinks, log }) {
      pagesSeen += 1;
      await updateJobCounters(job.id, { pages: 1 });

      const pageUrl = request.loadedUrl || request.url;
      let products = [];
      try {
        products = await extractProducts(page, pageUrl, source.selectors || {});
      } catch (error) {
        log.warning(`Extraction impossible sur ${pageUrl}: ${error.message}`);
      }

      let saved = 0;
      for (const product of products) {
        try {
          if (!isSameHost(product.url, source.base_url)) product.url = pageUrl;
          if (await insertProductAndPrice(source.id, product)) saved += 1;
        } catch (error) {
          log.warning(`Enregistrement produit impossible (${product.name}): ${error.message}`);
        }
      }
      productsFound += saved;
      if (saved) await updateJobCounters(job.id, { products: saved });

      if (productPattern && pagesSeen < maxPages) {
        await enqueueLinks({
          strategy: 'same-domain',
          transformRequestFunction: (candidate) => {
            try {
              const candidateUrl = new URL(candidate.url);
              if (!isSameHost(candidateUrl.toString(), source.base_url)) return null;
              if (!productPattern.test(candidateUrl.pathname)) return null;
              return candidate;
            } catch { return null; }
          },
        });
      }
    },
    async onSkippedRequest({ url, reason }) {
      if (String(reason || '').toLowerCase().includes('robot')) {
        skippedByRobots += 1;
        await updateJobCounters(job.id, { robots: 1 });
      }
    },
    async failedRequestHandler({ request, error }) {
      // Erreur visible dans les logs, sans tenter de contourner les protections.
      console.warn(`[scraper] Échec ${request.url}: ${error?.message || 'erreur inconnue'}`);
    },
  });

  await crawler.run(startUrls);
  return { pagesSeen, productsFound, skippedByRobots, maxPages };
}
