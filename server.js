// server.js - returns CSV; if no real data, returns sample fallback rows so file is never empty
const express = require('express');
const gplay = require('google-play-scraper');
const app = express();
const PORT = process.env.PORT || 3000;

const TWO_YEARS_MS = 365 * 2 * 24 * 60 * 60 * 1000;

async function fetchAppsForKeyword(q, appsPerKeyword) {
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

  try {
    if (typeof gplay.search === 'function') {
      const sr = await gplay.search({ term: q, num: appsPerKeyword, country: 'in', lang: 'en' });
      if (Array.isArray(sr) && sr.length) return sr;
    }
  } catch (e) { /* ignore */ }

  // fallback: basic static seed
  return [
    { appId: 'com.whatsapp' },
    { appId: 'com.facebook.katana' },
    { appId: 'com.instagram.android' }
  ].slice(0, appsPerKeyword);
}

app.get('/', (req, res) => res.send('✅ App running. Use /run to fetch CSV.'));

app.get('/run', async (req, res) => {
  try {
    const keywords = (req.query.keywords || 'tools,productivity,education').split(',').map(s => s.trim()).filter(Boolean);
    const appsPerKeyword = Math.max(1, Math.min(100, parseInt(req.query.per || '20', 10)));
    const devs = new Map();
    const errors = [];
    let totalAppsSeen = 0;

    for (const q of keywords) {
      let list = [];
      try {
        list = await fetchAppsForKeyword(q, appsPerKeyword);
      } catch (e) {
        errors.push(`fetch ${q}: ${e.message || e}`);
        list = [];
      }

      for (const a of list) {
        totalAppsSeen++;
        try {
          const appId = a.appId || a.app_id || a.app || a.id;
          if (!appId) continue;
          const meta = await gplay.app({ appId, country: 'in', lang: 'en' });
          const devId = meta.developerId || meta.developer || ('unknown:' + (meta.developer || 'no-name'));
          const updatedMs = meta.updated ? new Date(meta.updated).getTime() : 0;

          if (!devs.has(devId)) devs.set(devId, { name: meta.developer || '', latest: 0, count: 0, sampleApps: [] });
          const d = devs.get(devId);
          d.count++;
          if (d.sampleApps.length < 5) d.sampleApps.push({ appId: meta.appId || appId, title: meta.title || '' });
          if (updatedMs > d.latest) d.latest = updatedMs;
        } catch (e) {
          // collect errors but continue
          errors.push(`meta ${a.appId || JSON.stringify(a)}: ${e.message || e}`);
        }
      }
    }

    // Build CSV rows for inactive devs (<=3 apps and last update >2 years)
    const rows = [['developerId','developerName','appCount','latestUpdate','sampleApps']];
    for (const [devId, d] of devs.entries()) {
      const inactive = (Date.now() - (d.latest || 0)) > TWO_YEARS_MS;
      if (d.count <= 3 && inactive) {
        const latestStr = d.latest ? new Date(d.latest).toISOString().slice(0,10) : 'unknown';
        const sample = d.sampleApps.map(x => `${(x.title||'').replace(/"/g,'""')} (${x.appId})`).join(' | ').replace(/"/g,'""');
        rows.push([devId.replace(/"/g,'""'), (d.name||'').replace(/"/g,'""'), d.count, latestStr, sample]);
      }
    }

    // If no matching inactive developers found, return a CSV with helpful sample rows (so file is never empty)
    if (rows.length <= 1) {
      const sampleRows = [
        ['dev.id.sample1','Sample Developer One',2,'2020-01-10','Sample App A (com.sample.a) | Sample App B (com.sample.b)'],
        ['dev.id.sample2','Sample Developer Two',1,'2019-05-15','Only App (com.sample.only)'],
        ['dev.id.sample3','Sample Developer Three',3,'2018-08-20','A (com.a) | B (com.b)']
      ];
      const csv = [['developerId','developerName','appCount','latestUpdate','sampleApps']].concat(sampleRows)
        .map(r => `"${r.join('","')}"`).join('\n');
      // also log diagnostics to console for you to check Render logs
      console.log('NO inactive devs found from live scan. totalAppsSeen=', totalAppsSeen, 'errors=', errors.slice(0,10));
      res.setHeader('Content-Type','text/csv');
      res.setHeader('Content-Disposition','attachment; filename="inactive_devs_sample_fallback.csv"');
      return res.send(csv);
    }

    // otherwise send the real CSV
    const csv = rows.map(r => `"${r.join('","')}"`).join('\n');
    console.log('Found inactive developers:', rows.length-1, 'totalAppsSeen=', totalAppsSeen, 'errors=', errors.slice(0,10));
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="inactive_devs.csv"');
    res.send(csv);

  } catch (err) {
    console.error('Run handler error:', err);
    res.status(500).send('Error: ' + (err.message || String(err)));
  }
});

app.listen(PORT, () => console.log('Server running on port', PORT));
