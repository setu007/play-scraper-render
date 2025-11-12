const express = require('express');
const gplay = require('google-play-scraper');
const app = express();
const PORT = process.env.PORT || 3000;

const TWO_YEARS_MS = 365*2*24*60*60*1000;

app.get('/', (req, res) => res.send('✅ App running. Go to /run to start scraper.'));

app.get('/run', async (req, res) => {
  try {
    const keywords = (req.query.keywords || 'tools,productivity,education').split(',');
    const appsPerKeyword = parseInt(req.query.per || '20', 10);
    const devs = new Map();

    for (const q of keywords) {
      const results = await gplay.search({term: q, num: appsPerKeyword, country: 'in', lang: 'en'});
      for (const a of results) {
        try {
          const meta = await gplay.app({appId: a.appId, country: 'in', lang: 'en'});
          const devId = meta.developerId || meta.developer || 'unknown';
          const updatedMs = meta.updated ? new Date(meta.updated).getTime() : 0;
          if (!devs.has(devId)) devs.set(devId, {name: meta.developer || '', latest: 0, count: 0});
          const d = devs.get(devId);
          d.count++;
          if (updatedMs > d.latest) d.latest = updatedMs;
        } catch {}
      }
    }

    const rows = [['developerId','developerName','appCount','latestUpdate']];
    for (const [devId, d] of devs.entries()) {
      const inactive = (Date.now() - (d.latest || 0)) > TWO_YEARS_MS;
      if (d.count <= 3 && inactive) {
        rows.push([devId, d.name.replace(/"/g,'""'), d.count, d.latest ? new Date(d.latest).toISOString().slice(0,10) : 'unknown']);
      }
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="inactive_devs.csv"');
    res.send(rows.map(r => `"${r.join('","')}"`).join('\n'));
  } catch (err) {
    res.status(500).send('Error: ' + (err.message||err));
  }
});

app.listen(PORT, () => console.log('Server running on port', PORT));
