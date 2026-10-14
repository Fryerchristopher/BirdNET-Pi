import { renderShell, api, el, esc, $, detectionCard, params, every, relativeTime, pct, thumb, bestUrl } from './app.js';

const kiosk = params.get('kiosk') === '1';
const site = await renderShell("Today's Detections");
const main = $('#main');
main.innerHTML = `
  ${kiosk ? `<h1 class="center">${esc(site.settings?.site_name || 'BirdNET-Pi')}</h1>` : ''}
  <div class="stat-strip" id="stats"></div>
  <div class="row between" style="margin:1rem 0 .5rem">
    <h2 style="margin:0">Today's Detections</h2>
    ${kiosk ? '' : '<div class="row"><input type="search" id="q" placeholder="Search (prefix with not to exclude)"><label><input type="checkbox" id="legacy"> Compact list</label></div>'}
  </div>
  <div id="list" class="detection-list two-up"></div>
  <div class="center" style="margin:1rem"><button id="more" hidden>Load 40 more</button></div>`;

async function loadStats() {
  const s = await api('/api/v1/summary');
  $('#stats').innerHTML = [['Total', s.total], ['Today', s.today], ['Last hour', s.last_hour], ['Species today', s.species_today], ['Species total', s.species_total]]
    .map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
}

let offset = 0;
let q = '';
let legacy = false;
async function load(reset) {
  if (reset) { offset = 0; $('#list').innerHTML = ''; }
  const r = await api(`/api/v1/detections?date=today&limit=40&offset=${offset}${q ? '&q=' + encodeURIComponent(q) : ''}`);
  const list = $('#list');
  if (legacy) {
    let t = list.querySelector('table');
    if (!t) { t = el('<table><thead><tr><th>Time</th><th>Species</th><th>Confidence</th><th>Listen</th></tr></thead><tbody></tbody></table>'); list.append(t); list.classList.remove('two-up'); }
    for (const row of r.items) {
      t.querySelector('tbody').append(el(`<tr><td>${kiosk ? relativeTime(row.date, row.time) : esc(row.time)}</td><td><a href="${bestUrl(row.sci_name)}"><strong>${esc(row.com_name)}</strong></a><br><i class="muted">${esc(row.sci_name)}</i></td><td>${pct(row.confidence)}</td><td>${row.has_audio ? `<audio controls preload="none" src="/media/${esc(row.media_key)}"></audio>` : '<span class="muted">n/a</span>'}</td></tr>`));
    }
  } else {
    list.classList.add('two-up');
    for (const row of r.items) {
      const card = detectionCard(row, { admin: site.admin && !kiosk, onChange: () => load(true) });
      if (kiosk) card.querySelector('.when').prepend(el(`<span>${relativeTime(row.date, row.time)} &middot; </span>`));
      list.append(card);
    }
  }
  if (!r.total) list.innerHTML = '<p class="muted">No detections for today.</p>';
  offset += r.items.length;
  $('#more').hidden = offset >= r.total;
}

$('#more').onclick = () => load(false);
if (!kiosk) {
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') { q = e.target.value.trim(); load(true); } };
  $('#legacy').onchange = (e) => { legacy = e.target.checked; load(true); };
}
await Promise.all([loadStats(), load(true)]);
every(kiosk ? 60_000 : 120_000, () => { loadStats(); if (offset <= 40) load(true); });
