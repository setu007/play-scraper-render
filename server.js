// server.js - Play Store scraper using fetch + cheerio (no google-play-scraper)
const express = require('express');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

const TWO_YEARS_MS = 365 * 2 * 24 * 60 * 60 * 1000;

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

async function searchApps(keyword, max) {
  const q = encodeURIComponent(keyword);
  const url = `https://play.google.com/store/search?q=${q}&c=apps&hl=en&gl=IN`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const ids = new Set();
  $('a[href^="/store/apps/details"]').each((i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/[?&]id=([^&]+)/);
    if (m && m[1]) ids.add(m[1]);
    if (ids.size >= max) return false;
  });
  return Array.from(ids).slice(0, max);
}

function parseLdJson(html) {
  const $ = cheerio.load(html);
  let found = null;
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const txt = $(el).contents().text();
      if (!txt) return;
      const j = JSON.parse(txt);
      // The LD JSON for app pages often contains '@type':'SoftwareApplication'
      if (j['@type'] && (j['@type'].toLowerCase().includes('softwareapplication') || j['@type'].toLowerCase().includes('software'))) {
        found = j;
        return false;
      }
      // fallback accept if contains name+author
      if (j.name && j.author) {
        found = j;
        return false;
      }
    } catch (e) { /* ignore parse errors */ }
  });
  return found;
}

async function fetchAppMeta(appId) {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en&gl=IN`;
  const html = await fetchText(url);
  // Try JSON-LD first
  const ld = parseLdJson(html);
  if (ld) {
    const devName = (ld.author && (ld.author.name || (ld.author['@id'] || ''))) || '';
    // prefer dateModified or datePublished
    const updated = ld.dateModified || ld.datePublished || '';
    return { appId, developer: devName, updated: updated || null, title: ld.name || null };
  }
  // Fallback: try meta tags / selectors
  const $ = cheerio.load(html);
  const devName = $('a[href^="/store/apps/dev"]').first().text().trim() || $('meta[itemprop="author"]').attr('content') || '';
  // look for text node that says "Updated" then following sibling contains date
  let updated = null;
  $('div.hAyfc').each((i, el) => {
    const label = $(el).find('div.BgcNfc').text().trim();
    if (label && label.toLowerCase().includes('updated')) {
      updated = $(el).find('span.htlgb').text().trim();
      return false;
    }
  });
  if (!updated) {
    updated = $('meta[itemprop="datePublished"]').attr('content') || null;
  }
  const title = $('h1 span').first().text().trim() || $('meta[itemprop="name"]').attr('content') || null;
  return { appId, developer: devName, updated: updated || null, title };
}

app.get('/', (req, res) => res.send('✅ App running. Use /run to fetch CSV.'));

app.get('/run', async (req, res) => {
  try {
    const keywords = (req.query.keywords || 'tools,productivity,education').split(',').map(s => s.trim()).filter(Boolean);
    const appsPerKeyword = Math.max(1, Math.min(50, parseInt(req.query.per || '10', 10)));
    const devs = new Map();
    const errors = [];

    for (const kw of keywords) {
      let appIds = [];
      try {
        appIds = await searchApps(kw, appsPerKeyword);
      } catch (e) {
        errors.push(`search ${kw}: ${e.message}`);
        continue;
      }
      for (const id of appIds) {
        try {
          const meta = await fetchAppMeta(id);
          const devId = (meta.developer || 'unknown:' + id).trim();
          const updatedMs = meta.updated ? Date.parse(meta.updated) : 0;
          if (!devs.has(devId)) devs.set(devId, { name: meta.developer || '', latest: 0, count: 0, sample: [] });
          const d = devs.get(devId);
          d.count += 1;
          if (d.sample.length < 5) d.sample.push({ appId: id, title: meta.title || '' });
          if (updatedMs && updatedMs > d.latest) d.latest = updatedMs;
        } catch (e) {
          errors.push(`meta ${id}: ${e.message}`);
        }
      }
    }

    const rows = [['developerId','developerName','appCount','latestUpdate','sampleApps']];
    for (const [devId, d] of devs.entries()) {
      const latestStr = d.latest ? new Date(d.latest).toISOString().slice(0,10) : 'unknown';
      const sample = d.sample.map(x => `${(x.title||'').replace(/"/g,'""')} (${x.appId})`).join(' | ').replace(/"/g,'""');
      rows.push([devId.replace(/"/g,'""'), (d.name||'').replace(/"/g,'""'), d.count, latestStr, sample]);
    }

    // If no developers found, return a helpful JSON debug instead of empty CSV
    if (rows.length <= 1) {
      return res.json({ ok: true, message: 'No developers found', keywords, appsPerKeyword, errors, devCount: devs.size });
    }

    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="developers.csv"');
    res.send(rows.map(r => `"${r.join('","')}"`).join('\n'));
  } catch (err) {
    console.error('Run error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => console.log('Server running on port', PORT));
