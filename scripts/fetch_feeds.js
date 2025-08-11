/**
 * scripts/fetch_feeds.js
 *
 * Reads feedlist.opml, fetches feeds, builds feeds.json (ISO dates),
 * and exits. Designed to run in GitHub Actions.
 */

const fs = require('fs').promises;
const path = require('path');
const RSSParser = require('rss-parser');
const { XMLParser } = require('fast-xml-parser');
const pLimit = require('p-limit');

const OPML_FILE = process.env.OPML_FILE || 'feedlist.opml';
const OUTPUT_FILE = process.env.OUTPUT_FILE || 'feeds.json';
const MAX_DAYS = parseInt(process.env.MAX_DAYS || '30', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '6', 10);

const parser = new RSSParser({ timeout: 20000 }); // 20s per feed

function log(...args){ console.log(new Date().toISOString(), ...args); }

async function readOpml(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const xmlp = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const obj = xmlp.parse(raw);

  const urls = [];
  // outlines can be nested; traverse recursively
  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    // if this node is an outline with xmlUrl attribute
    if (node.xmlUrl) {
      urls.push({ title: node.title || node.text || '', url: node.xmlUrl });
    }
    // walk children - typical keys: outline, body, etc.
    if (node.outline) walk(node.outline);
    if (node.body) walk(node.body);
  }

  // OPML root can be opml.body.outline or just opml
  if (obj.opml) walk(obj.opml.body || obj.opml);
  else walk(obj);

  // dedupe and normalize
  const map = new Map();
  urls.forEach(f => {
    if (f.url && !map.has(f.url)) map.set(f.url, f);
  });
  return Array.from(map.values());
}

async function fetchFeedWithRetry(url, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const feed = await parser.parseURL(url);
      return feed;
    } catch (err) {
      lastErr = err;
      const backoff = 1000 * Math.pow(2, attempt);
      log(`fetch error for ${url} (attempt ${attempt}): ${err.message}. backoff ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

function toIso(dateLike) {
  if (!dateLike) return null;
  try {
    const d = new Date(dateLike);
    if (isNaN(d)) return null;
    return d.toISOString();
  } catch (e) {
    return null;
  }
}

async function main() {
  try {
    log('Reading OPML:', OPML_FILE);
    const feeds = await readOpml(OPML_FILE);
    log('Found feeds:', feeds.length);

    const limit = pLimit(CONCURRENCY);
    const cutoffTs = Date.now() - MAX_DAYS * 24 * 3600 * 1000;
    const collected = [];

    const tasks = feeds.map(f => limit(async () => {
      log('Fetching:', f.url);
      try {
        const feed = await fetchFeedWithRetry(f.url, 2);
        const sourceTitle = feed.title || f.title || f.url;
        if (!feed.items || feed.items.length === 0) {
          log(`No items for ${f.url}`);
          return;
        }
        feed.items.forEach(item => {
          const iso = item.isoDate || item.pubDate || item.pubdate || item.published || item.publishedDate || null;
          const isoDate = toIso(iso);
          const ts = isoDate ? new Date(isoDate).getTime() : Date.now();

          // keep only items within MAX_DAYS window
          if (ts < cutoffTs) return;

          collected.push({
            title: item.title || item.title ?? '(no title)',
            link: item.link || item.guid || null,
            isoDate,
            pubDate: isoDate,
            contentSnippet: item.contentSnippet || item.summary || (item.content ? (String(item.content).slice(0, 400)) : ''),
            content: item.content || item['content:encoded'] || '',
            guid: item.guid || null,
            source: sourceTitle,
            feedUrl: f.url
          });
        });
        log(`Fetched ${feed.items.length} items from ${sourceTitle}`);
      } catch (err) {
        log(`Failed to fetch ${f.url}: ${err.message}`);
      }
    }));

    await Promise.all(tasks);

    // dedupe: prefer link or guid; fallback to title+date
    const map = new Map();
    collected.forEach(it => {
      const key = it.link || it.guid || (it.title + '|' + it.isoDate);
      if (!map.has(key)) map.set(key, it);
    });

    const items = Array.from(map.values())
      .sort((a, b) => {
        const ta = a.isoDate ? new Date(a.isoDate).getTime() : 0;
        const tb = b.isoDate ? new Date(b.isoDate).getTime() : 0;
        return tb - ta;
      });

    const out = {
      fetched_at: new Date().toISOString(),
      feed_count: feeds.length,
      items_count: items.length,
      items: items.slice(0, 2000) // cap to 2000 entries
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), 'utf8');
    log('Wrote', OUTPUT_FILE, 'items:', out.items.length);
    process.exit(0);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(2);
  }
}

main();
