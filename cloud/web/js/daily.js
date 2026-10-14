/* Daily Charts: the Combo chart drawn client-side (count bars + species x hour heatmap). Left/Right arrows and swipes change the day. */
import { renderShell, api, el, esc, $, params, bestUrl, pct } from './app.js';

const site = await renderShell('Daily Charts');
let date = params.get('date') || site.today;
const main = $('#main');

async function render() {
  history.replaceState(null, '', `?date=${date}`);
  main.innerHTML = '<p class="muted">Loading...</p>';
  const d = await api(`/api/v1/daily?date=${date}`);
  const nowHour = d.is_today ? new Date().getHours() : -1;
  const max = Math.max(1, ...d.species.map((s) => s.total));
  const confs = d.species.map((s) => s.max_confidence);
  const cmin = Math.min(...confs, 1), cmax = Math.max(...confs, 0);
  const shade = (c) => 0.25 + 0.75 * (cmax > cmin ? (c - cmin) / (cmax - cmin) : 1);
  main.innerHTML = `
    <div class="card row between">
      <div class="row"><a class="btn" href="?date=${d.prev}">&larr; ${d.prev}</a><input type="date" id="date" value="${date}"><button id="go">Go</button>${d.is_today ? '' : `<a class="btn" href="?date=${d.next}">${d.next} &rarr;</a>`}</div>
      <div class="row"><span class="pill">Total detections for the day: <strong>${d.total}</strong></span><a class="btn" href="/api/v1/ebird.csv?date=${date}" download>Export eBird CSV</a>${d.chart_image ? `<a class="btn" href="${d.chart_image}" target="_blank">Pi chart image</a>` : ''}</div>
    </div>
    ${d.species.length ? `<div class="card"><h2>All ${d.species.length} species, ${date}</h2>
      <div class="heatmap" style="grid-template-columns:11rem 6rem repeat(24, minmax(0,1fr))" id="hm"></div>
      <p class="help">Bar and cell shading follows each species' best confidence of the day; cell numbers are detections in that hour.</p></div>` : `<div class="card"><p>No detections for ${date}.</p></div>`}`;
  $('#go').onclick = () => { date = $('#date').value; render(); };
  const g = $('#hm');
  if (!g) return;
  g.append(el('<div></div><div class="hour">Count</div>'.replace('<div></div>', '<div class="lbl">Species</div>')));
  for (let h = 0; h < 24; h++) g.append(el(`<div class="hour ${h === nowHour ? 'now' : ''}">${h}</div>`));
  for (const s of d.species) {
    g.append(el(`<div class="lbl" title="${esc(s.com_name)} (${pct(s.max_confidence)})"><a href="${bestUrl(s.sci_name)}">${esc(s.com_name)}</a></div>`));
    g.append(el(`<div class="cell" style="aspect-ratio:auto;justify-content:flex-start;background:none"><div style="height:70%;width:${Math.max(3, (s.total / max) * 100)}%;background:rgba(63,185,80,${shade(s.max_confidence)});border-radius:2px"></div><span style="margin-left:.3rem">${s.total}</span></div>`));
    const hmax = Math.max(1, ...s.hours);
    for (const n of s.hours) g.append(el(`<div class="cell" style="${n ? `background:rgba(63,185,80,${0.2 + 0.8 * Math.log1p(n) / Math.log1p(hmax)})` : ''}">${n || ''}</div>`));
  }
}
await render();

// keyboard and swipe navigation, as on the Pi
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') { date = shift(-1); render(); }
  if (e.key === 'ArrowRight' && date < site.today) { date = shift(1); render(); }
});
let tx = 0, tt = 0;
document.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; tt = Date.now(); }, { passive: true });
document.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - tx;
  if (Date.now() - tt < 350 && Math.abs(dx) > 40) { if (dx > 0) { date = shift(-1); render(); } else if (date < site.today) { date = shift(1); render(); } }
}, { passive: true });
function shift(n) { const t = new Date(date + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
