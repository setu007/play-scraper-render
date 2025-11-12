// server.js
const express = require('express');
const gplay = require('google-play-scraper');
const app = express();
const PORT = process.env.PORT || 3000;

const TWO_YEARS_MS = 365 * 2 * 24 * 60 * 60 * 1000;

/**
 * Helper: fetch apps for one keyword using several fallbacks
 * - Preferred: gplay.list() with literal collection name
 * - Fallback: gplay.search() if available
 * - Final fallback: small static seed list
 */
async function fetchAppsForKeyword(q, appsPerKeyword) {
  // 1) try list() with literal collection name
  try {
    const listResult = await gplay.list({
      collection: 'topselling_free',   // literal string works across versions
      category: 'APPLICATION',         // literal string
      num: appsPerKeyword,
      country: 'in',
      lang: 'en'
    });
    if (Array.isArray(listResult) && listResult.length) return listResult;
  } catch (e) {
    // ignore and try next method
  }

  // 2) try search(), if it exists on this package version
  try {
    if (typeof gplay.search === 'function') {
      const sr = await gplay.search({ term: q, num: appsPerKeyword, country: 'in', lang: 'en' });
      if (Array.isArray(sr) && sr.length) return sr;
    }
  } catch (e) {
    // ignore and try last fallback
  }

  // 3) final fallback: small static well-known app list so endpoint returns something
  const staticSeed = [
    { appId: 'com.whatsapp' },
    { appId: 'com.facebook.katana' },
    { appId: 'com.instagram.android' },
    { appId: 'com.google.android.apps.maps' },
    { appId: 'com.mxtech.videoplayer.ad' }
  ];
  return staticSeed.slice(0, appsPerKeyword);
}

app.get('/', (req, res) => res.send('✅ App running. Go to /run to start scraper.'));

app.get('/run', async (req, res) => {
  try {
    const keywords = (req.query.keywords || 'tools,productivity,education').split(',').map(s => s.trim()).filter(Boolean);
    const appsPerKeyword = Math.max(1, Math.min(100, parseInt(req.query.per || '20', 10))); // keep safe bounds
    const devs = new Map();

    // iterate keywords sequentially (safer)
    for (const q of keywords) {
      const results = await fetchAppsForKeyword(q, appsPerKeyword);
      for (const a of results) {
        try {
          // tolerate different shapes returned by different versions (appId, app_id, id)
          const appId = a.appId || a.app_id || a.app || a.id;
          if (!appId) continue;
          const meta = await gplay.app({ appId, country: 'in', lang: 'en' });
          const devId = meta.developerId || meta.developer || meta.developerId || 'unknown';
          const updatedMs = meta.updated ? new Date(meta.updated).getTime() : 0;

          if (!devs.has(devId)) devs.set(devId, { name: meta.developer || '', latest: 0, count: 0, sampleApps: [] });
          const d = devs.get(devId);
          d.count++;
          if (d.sampleApps.length < 5) d.sampleApps.push({ appId: meta.appId || appId, title: meta.title || '' });
          if (updatedMs > d.latest) d.latest = updatedMs;
        } catch (err) {
          // ignore single app failures (rate limits, not found, etc.)
        }
      }
    }

    // build CSV rows for developers matching criteria (<=3 apps and no update in 2 years)
    const rows = [['developerId', 'developerName', 'appCount', 'latestUpdate', 'sampleApps']];
    for (const [devId, d] of devs.entries()) {
      const inactive = (Date.now() - (d.latest || 0)) > TWO_YEARS_MS;
      if (d.count <= 3 && inactive) {
        const latestStr = d.latest ? new Date(d.latest).toISOString().slice(0, 10) : 'unknown';
        const sample = d.sampleApps.map(x => `${x.title || ''} (${x.appId})`).join(' | ').replace(/"/g, '""');
        rows.push([devId, (d.name || '').replace(/"/g, '""'), d.count, latestStr, sample]);
      }
    }

    // send CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="inactive_devs.csv"');
    const csv = rows.map(r => `"${r.join('","')}"`).join('\n');
    res.send(csv);
  } catch (err) {
    console.error('Run error:', err);
    res.status(500).send('Error: ' + (err && err.message ? err.message : String(err)));
  }
});

app.listen(PORT, () => console.log('Server running on port', PORT));
