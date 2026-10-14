import { renderShell, api, el, esc, $, detectionCard, every, onVisible, anyPlaying, pct, thumb, bestUrl, recordingsUrl, miniGraph, player } from './app.js';

const site = await renderShell('Overview');
const main = $('#main');
const rl = Number(site.settings?.recording_length || 15);
main.innerHTML = `
  <div class="stat-strip" id="stats"></div>
  <div id="highlights"></div>
  <div class="grid cols-2" style="margin-top:1rem">
    <div class="stack">
      <div class="card" id="latest"><h2>Most Recent Detection</h2><p class="muted">Loading...</p></div>
      <div class="card"><h2>Currently Analyzing</h2><div id="live"><p class="muted">No live spectrogram yet.</p></div></div>
    </div>
    <div class="stack">
      <div class="card"><h2>5 Most Recent Detections</h2><div class="detection-list" id="recent"></div></div>
      <div class="card" id="chart"><h2>Today</h2><div id="chartbody"></div></div>
    </div>
  </div>`;

async function loadStats() {
  const s = await api('/api/v1/summary');
  $('#stats').innerHTML = [
    ['Total', s.total, null], ['Today', s.today, '/today'], ['Last hour', s.last_hour, null],
    ['Species today', s.species_today, `/recordings?date=${s.date}`], ['Species total', s.species_total, '/best'],
  ].map(([l, v, h]) => `<div class="stat"><div class="label">${l}</div>${h ? `<a class="value" href="${h}">${v}</a>` : `<div class="value">${v}</div>`}</div>`).join('');
  return s;
}

async function loadHighlights() {
  const h = await api('/api/v1/today/highlights');
  const box = $('#highlights');
  box.innerHTML = '';
  const block = (title, rows, rare) => {
    if (!rows.length) return;
    const card = el(`<div class="card"><h2>${rows.length} ${title}</h2></div>`);
    if (rows.length > 8) {
      card.append(el(`<a class="btn" href="/recordings?date=today">Open today's recordings</a>`));
    } else {
      const t = el('<table></table>');
      for (const r of rows) {
        const tr = el(`<tr><td style="width:56px"></td><td><a href="${bestUrl(r.sci_name)}"><strong>${esc(r.com_name)}</strong></a><br><i class="muted">${esc(r.sci_name)}</i> <button class="ghost graph" title="Trend">&#9641;</button></td>
          <td>Max confidence: ${pct(r.max_confidence)}${r.occurrences > 1 ? ` (${r.occurrences}x)` : ''}<br>First detection: ${esc(r.first_time)}${rare ? `<br>Last seen: ${r.days_ago > 30 ? Math.floor(r.days_ago / 30) + 'mo' : r.days_ago + 'd'} ago` : ''}</td></tr>`);
        tr.querySelector('td').append(thumb(r.sci_name, 'thumb'));
        tr.querySelector('.graph').onclick = (e) => miniGraph(e.currentTarget, r.sci_name, r.com_name);
        t.append(tr);
      }
      card.append(t);
    }
    box.append(card);
  };
  block('new species detected today!', h.new_species, false);
  block('rare species detected today!', h.rare_species, true);
}

let lastFile = null;
async function loadLatest(force = false) {
  if (anyPlaying()) return;
  const row = await api('/api/v1/detections/latest');
  const box = $('#latest');
  if (!row) { box.innerHTML = '<h2>Most Recent Detection</h2><p class="muted">No detections yet.</p>'; return; }
  if (row.file_name === lastFile && !force) return;
  lastFile = row.file_name;
  box.innerHTML = `<h2>Most Recent Detection <small class="muted">${esc(row.date)} ${esc(row.time)}</small></h2>`;
  box.append(detectionCard(row, { admin: site.admin, onChange: () => loadLatest(true) }));
  loadRecent();
  loadStats();
  loadHighlights();
}

async function loadRecent() {
  const r = await api('/api/v1/detections/recent?limit=5');
  const list = $('#recent');
  list.innerHTML = '';
  for (const row of r.items) list.append(detectionCard(row, { compact: true, admin: site.admin, onChange: loadRecent }));
  if (!r.items.length) list.innerHTML = '<p class="muted">No detections yet.</p>';
}

async function loadLive() {
  const l = await api('/api/v1/live');
  const box = $('#live');
  if (!l.spectrogram) { box.innerHTML = `<p class="muted">${l.analyzing_now ? 'Analyzing ' + esc(l.analyzing_now) : 'No live spectrogram yet.'}</p>`; return; }
  box.innerHTML = `<img src="${l.spectrogram.url}?t=${Date.parse(l.spectrogram.uploaded)}" alt="live spectrogram" style="width:100%;border-radius:var(--radius-sm)"><div class="muted" style="font-size:.8rem">${esc(l.analyzing_now || '')} &middot; updated ${new Date(l.spectrogram.uploaded).toLocaleTimeString()}</div>`;
}

async function loadChart() {
  const d = await api('/api/v1/daily?date=today');
  const body = $('#chartbody');
  if (!d.species.length) { body.innerHTML = '<p class="muted">Nothing yet today.</p>'; return; }
  const top = d.species.slice(0, 12);
  const max = Math.max(...top.map((s) => s.total));
  body.innerHTML = `<table>${top.map((s) => `<tr><td style="width:40%"><a href="${bestUrl(s.sci_name)}">${esc(s.com_name)}</a></td><td><div style="background:var(--accent);height:14px;border-radius:3px;width:${Math.max(2, (s.total / max) * 100)}%"></div></td><td style="width:3rem;text-align:right">${s.total}</td></tr>`).join('')}</table>
    <p><a class="btn" href="/daily">Full daily chart</a></p>`;
}

await Promise.all([loadStats(), loadHighlights(), loadLatest(true), loadLive(), loadChart()]);
every(Math.max(4, rl / 4) * 1000, () => loadLatest());
every(rl * 1000, loadLive);
every(120_000, loadChart);
onVisible(() => { loadLatest(); loadLive(); });
