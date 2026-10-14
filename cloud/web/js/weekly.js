import { renderShell, api, esc, $, params, bestUrl } from './app.js';

await renderShell('Weekly Report');
const end = params.get('end');
const r = await api(`/api/v1/weekly${end ? '?end=' + end : ''}`);
const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const pctHtml = (p) => (p === null ? '<span class="up">new</span>' : p > 0 ? `<span class="up">+${p}%</span>` : `<span class="down">${p}%</span>`);
const shift = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
$('#main').innerHTML = `
  <div class="card center">
    <h1>Week ${r.week} Report</h1>
    <p class="muted">${fmt(r.start)} to ${fmt(r.end)}</p>
    <div class="row" style="justify-content:center"><a class="btn" href="?end=${shift(r.end, -7)}">&larr; Previous week</a><a class="btn" href="?end=${shift(r.end, 7)}">Next week &rarr;</a></div>
  </div>
  <div class="stat-strip">
    <div class="stat"><div class="label">Total detections</div><div class="value">${r.total} <small>${pctHtml(r.total_change_pct)}</small></div></div>
    <div class="stat"><div class="label">Unique species</div><div class="value">${r.species_count} <small>${pctHtml(r.species_change_pct)}</small></div></div>
  </div>
  <div class="grid cols-2" style="margin-top:1rem">
    <div class="card"><h2>Top 10 species</h2><table>${r.top.map((t) => `<tr><td><a href="${bestUrl(t.sci_name)}">${esc(t.com_name)}</a><br><small>${t.count} (${pctHtml(t.change_pct)})</small></td></tr>`).join('') || '<tr><td class="muted">No detections this week.</td></tr>'}</table></div>
    <div class="card"><h2>Species detected for the first time</h2><table>${r.first_seen.map((t) => `<tr><td><a href="${bestUrl(t.sci_name)}">${esc(t.com_name)}</a><br><small>${t.count}</small></td></tr>`).join('') || '<tr><td class="muted">No new species were seen this week.</td></tr>'}</table></div>
  </div>
  <p class="help">* percentages are calculated relative to week ${r.week - 1} (${r.prior_start} to ${r.prior_end}).</p>`;
