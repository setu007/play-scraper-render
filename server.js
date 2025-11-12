// server.js (debug / show-all-devs mode)
const express = require('express');
const gplay = require('google-play-scraper');
const app = express();
const PORT = process.env.PORT || 3000;

function now() { return new Date().toISOString(); }

async function fetchAppsForKeyword(q, appsPerKeyword) {
  // try list() with literal names
  try {
    const listResult = await gplay.list({
      collection: 'topselling_free',
      category: 'APPLICATION',
      num: appsPerKeyword,
      country: 'in',
      lang: 'en'
    });
    if (Array.isArray(listResult) && listResult.length) return listResult;
  } catch (e) { /* ignore */ }

  // try search if available
  try {
    if (typeof gplay.search === 'function') {
      const sr = await gplay.search({ term: q, num: appsPerKeyword, country: 'in', lang: 'en' });
      if (Array.isArray(sr) && sr.length) return sr;
    }
  } catch (e) { /* ignore */ }

  // final fallback: static seed
  return [
    { appId: 'com.whatsapp' },
    { appId: 'com.facebook.katana' },
    { appId: 'com.instagram.android' }
  ].slice(0, appsPerKeyword);
}

app.get('/', (req, res) => res.send('✅ App running. Use /run to fetch data.'));

app.get('/run', async (req, res) => {
  try {
    const keywords = (req.query.keywords || 'tools,productivity,education').split(',').map(s=>s.trim()).filter(Boolean);
    const appsPerKeyword = Math.max(1, Math.min(100, parseInt(req.query.per || '20', 10)));
    const devs = new Map();
    const errors = [];
    let totalAppsSeen = 0;

    for (const q of keywords) {
      let list;
      try {
        list = await fetchAppsForKeyword(q, appsPerKeyword);
      } catch (e) {
        errors.push(`fetch ${q}: ${e.message||e}`);
        list = [];
      }

      for (const a of list) {
        totalAppsSeen++;
        try {
          const appId = a.appId || a.app_id || a.app || a.id;
          if (!appId) continue;
          const meta = await gplay.app({ appId, country: 'in', lang: 'en' });
          const devId = meta.developerId || meta.developer || ('unknown:'+ (meta.developer || 'no-name'));
          const updatedMs = meta.updated ? new Date(meta.updated).getTime() : 0;

          if (!devs.has(devId)) devs.set(devId, { name: meta.developer || '', latest: 0, count: 0, sampleApps: [] });
          const d = devs.get(devId);
          d.count++;
          if (d.sampleApps.length < 5) d.sampleApps.push({ appId: meta.appId || appId, title: meta.title || '' });
          if (updatedMs > d.latest) d.latest = updatedMs;
        } catch (e) {
          errors.push(`meta ${a.appId||JSON.stringify(a)}: ${e.message||e}`);
        }
      }
    }

    // Build CSV of ALL developers found (no inactivity filter)
    const rows = [['developerId','developerName','appCount','latestUpdate','sampleApps']];
    for (const [devId, d] of devs.entries()) {
      const latestStr = d.latest ? new Date(d.latest).toISOString().slice(0,10) : 'unknown';
      const sample = d.sampleApps.map(x => `${(x.title||'').replace(/"/g,'""')} (${x.appId})`).join(' | ').replace(/"/g,'""');
      rows.push([devId.replace(/"/g,'""'), (d.name||'').replace(/"/g,'""'), d.count, latestStr, sample]);
    }

    // If no developers found, include a small diagnostic JSON instead of empty CSV
    if (rows.length <= 1) {
      return res.json({
        ok: true,
        message: 'No developers found. Diagnostics below.',
        keywords, appsPerKeyword, totalAppsSeen, totalDevelopers: devs.size, errors: errors.slice(0,30)
      });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="all_devs_debug.csv"');
    res.send(rows.map(r => `"${r.join('","')}"`).join('\n'));
  } catch (err) {
    console.error('Run error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`${now()} - Server running on port ${PORT}`));
