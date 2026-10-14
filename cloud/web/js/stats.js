/* Species Stats: replaces the Streamlit app with Chart.js on /api/v1/stats. */
import { renderShell, api, el, esc, $, params, loadChart, cssVar, player, mediaUrl, pngUrl, detectionCard, pct } from './app.js';

const site = await renderShell('Species Stats');
const today = site.today;
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
let from = params.get('from') || addDays(today, -30);
let to = params.get('to') || today;
let sci = params.get('sci') || '';
let top = Number(params.get('top') || 10);
let single = params.get('single') === '1';

const main = $('#main');
main.innerHTML = `<div class="grid sidebar">
  <div class="card stack">
    <label><input type="checkbox" id="single" ${single ? 'checked' : ''}> Single day view</label>
    <div id="range">
      <label>From <input type="date" id="from" value="${from}"></label>
      <label>To <input type="date" id="to" value="${to}"></label>
    </div>
    <div id="day" hidden><label>Date <input type="date" id="date" value="${to}"></label></div>
    <label>Species <select id="sci"><option value="">All species</option></select></label>
    <label>Number of birds to show <input type="number" id="top" min="1" max="200" value="${top}"></label>
    <button class="primary" id="go">Update</button>
  </div>
  <div id="out" class="stack"></div></div>`;

$('#single').onchange = (e) => { single = e.target.checked; $('#range').hidden = single; $('#day').hidden = !single; };
$('#single').dispatchEvent(new Event('change'));
$('#go').onclick = () => {
  if (single) { from = to = $('#date').value; } else { from = $('#from').value; to = $('#to').value; }
  sci = $('#sci').value; top = Number($('#top').value) || 10;
  history.replaceState(null, '', `?from=${from}&to=${to}&sci=${encodeURIComponent(sci)}&top=${top}${single ? '&single=1' : ''}`);
  run();
};

const Chart = await loadChart();
const charts = [];
const mk = (parent, cfg, h = 260) => {
  const box = el(`<div class="chart-box"><canvas height="${h}"></canvas></div>`);
  parent.append(box);
  const ch = new Chart(box.querySelector('canvas'), cfg);
  charts.push(ch);
  return ch;
};
const muted = () => cssVar('--text-muted');
const accent = () => cssVar('--accent');
const baseOpts = (title) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: !!title, text: title, color: muted() } }, scales: { x: { ticks: { color: muted() }, grid: { color: cssVar('--border') } }, y: { ticks: { color: muted(), precision: 0 }, grid: { color: cssVar('--border') }, beginAtZero: true } } });
const HOURS = [...Array(24).keys()].map((h) => (h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : h - 12 + 'pm'));

async function run() {
  charts.splice(0).forEach((c) => c.destroy());
  const out = $('#out');
  out.innerHTML = '<p class="muted">Loading...</p>';
  const d = await api(`/api/v1/stats?from=${from}&to=${to}&top=${top}${sci ? '&sci=' + encodeURIComponent(sci) : ''}`);
  // species picker keeps all species of the range
  const sel = $('#sci');
  const cur = sel.value;
  if (!sci || sel.options.length <= 1) {
    sel.innerHTML = '<option value="">All species</option>' + (await api(`/api/v1/stats?from=${from}&to=${to}&top=500`)).species.map((s) => `<option value="${esc(s.sci_name)}">${esc(s.com_name)} (${s.n})</option>`).join('');
    sel.value = cur || sci;
  }
  out.innerHTML = '';
  const title = sci ? sel.options[sel.selectedIndex]?.text?.replace(/ \(\d+\)$/, '') || sci : 'All species';
  out.append(el(`<div class="card"><h2>${esc(title)} <small class="muted">${from === to ? from : from + ' to ' + to} &middot; ${d.total} detections</small></h2></div>`));

  if (!sci) {
    const c1 = el('<div class="card"><h3>Top species</h3></div>'); out.append(c1);
    mk(c1, { type: 'bar', data: { labels: d.species.map((s) => s.com_name), datasets: [{ data: d.species.map((s) => s.n), backgroundColor: accent() }] }, options: { ...baseOpts(`Top ${d.species.length} species`), indexAxis: 'y' } }, Math.max(220, d.species.length * 26));
  }
  const c2 = el('<div class="grid cols-2"><div class="card"><h3>By hour of day</h3></div><div class="card"><h3>By date</h3></div></div>'); out.append(c2);
  mk(c2.children[0], { type: 'polarArea', data: { labels: HOURS, datasets: [{ data: d.hours, backgroundColor: HOURS.map((_, i) => `hsla(150, 60%, ${35 + (i % 2) * 10}%, .85)`) }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: `Total: ${d.total}`, color: muted() } }, scales: { r: { ticks: { display: false }, grid: { color: cssVar('--border') }, startAngle: -90 } } } }, 300);
  mk(c2.children[1], { type: 'bar', data: { labels: d.dates.map((x) => x.date.slice(5)), datasets: [{ data: d.dates.map((x) => x.n), backgroundColor: accent() }] }, options: baseOpts('Detections per day') }, 300);

  if (sci) {
    if (d.confidence) out.append(el(`<div class="card"><strong>Total:</strong> ${d.confidence.count} &nbsp; <strong>Confidence max:</strong> ${pct(d.confidence.max)} &nbsp; <strong>Median:</strong> ${pct(d.confidence.median)}</div>`));
    if (from !== to) {
      // 15-minute x date heatmap (the DAILY view in Streamlit)
      const dates = d.dates.map((x) => x.date);
      const grid = new Map(d.quarter_hours.map((r) => [`${r.date}:${r.slot}`, r.n]));
      const max = Math.max(1, ...d.quarter_hours.map((r) => r.n));
      const hm = el(`<div class="card"><h3>Time of day by date</h3><div class="heatmap" style="grid-template-columns:3rem repeat(${dates.length}, minmax(6px,1fr))"></div></div>`);
      const g = hm.querySelector('.heatmap');
      for (let slot = 95; slot >= 0; slot--) {
        g.append(el(`<div class="lbl">${slot % 8 === 0 ? String(slot / 4).padStart(2, '0') + ':00' : ''}</div>`));
        for (const date of dates) {
          const n = grid.get(`${date}:${slot}`) || 0;
          g.append(el(`<div class="cell" style="aspect-ratio:auto;height:5px;${n ? `background:rgba(63,185,80,${0.15 + 0.85 * n / max})` : ''}" title="${date} ${String(Math.floor(slot / 4)).padStart(2, '0')}:${String((slot % 4) * 15).padStart(2, '0')}: ${n}"></div>`));
        }
      }
      out.append(hm);
    }
    const rec = el('<div class="card"><h3>Recordings</h3><div class="detection-list two-up"></div></div>');
    for (const row of d.recordings.slice(0, 40)) rec.querySelector('.detection-list').append(detectionCard(row, { compact: true, showDate: true, admin: site.admin, onChange: run }));
    out.append(rec);
  } else if (from === to) {
    // single day: species x hour heatmap with counts
    const day = await api(`/api/v1/daily?date=${from}`);
    const rows = day.species.slice(0, top);
    const hm = el(`<div class="card"><h3>Species by hour, ${from}</h3><div class="heatmap" style="grid-template-columns:9rem repeat(24, minmax(0,1fr))"></div></div>`);
    const g = hm.querySelector('.heatmap');
    g.append(el('<div></div>'));
    for (let h = 0; h < 24; h++) g.append(el(`<div class="hour">${h}</div>`));
    for (const s of rows) {
      const mx = Math.max(1, ...s.hours);
      g.append(el(`<div class="lbl" title="${esc(s.com_name)}">${esc(s.com_name)}</div>`));
      for (const n of s.hours) g.append(el(`<div class="cell" style="${n ? `background:rgba(63,185,80,${0.2 + 0.8 * n / mx})` : ''}">${n || ''}</div>`));
    }
    out.append(hm);
  }
}
await run();
