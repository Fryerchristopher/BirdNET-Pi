/*
 * Recordings (the Pi's play.php): choose by species or by date, then a
 * species' recordings with date/confidence sort, "only locked" filter, and
 * paging. ?file=<File_Name> shows a single recording (the deep link used in
 * notifications).
 */
import { renderShell, api, el, esc, $, params, detectionCard, pct } from './app.js';

const site = await renderShell('Recordings');
const main = $('#main');
const file = params.get('file');
const species = params.get('species');
const date = params.get('date');
const mode = params.get('by');
const sort = params.get('sort') || 'date';
const locked = params.get('locked') === '1';
const qs = (o) => '?' + Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

if (file) {
  const row = await api(`/api/v1/detections/${encodeURIComponent(file)}`).catch(() => null);
  main.innerHTML = '';
  if (!row) { main.innerHTML = `<div class="card"><p>Recording not found: ${esc(file)}</p></div>`; }
  else {
    const card = el(`<div class="card"><h2>${esc(row.com_name)} <small class="muted">${esc(row.date)} ${esc(row.time)}</small></h2></div>`);
    card.append(detectionCard(row, { showDate: true, admin: site.admin, shifted: true, onChange: () => location.reload() }));
    main.append(card);
  }
} else if (species) {
  await speciesView();
} else if (date) {
  await dateView();
} else if (mode === 'species' || mode === 'date') {
  mode === 'species' ? await allSpecies() : await allDates();
} else {
  main.innerHTML = `<div class="card center"><h2>Recordings</h2><div class="row" style="justify-content:center"><a class="btn primary" href="?by=species">By species</a><a class="btn primary" href="?by=date">By date</a></div></div>`;
}

function sortBar(current, base, keys) {
  return `<div class="sort-bar">${keys.map(([k, l]) => `<a href="${qs({ ...base, sort: k })}" class="${k === current ? 'active' : ''}">${l}</a>`).join('')}</div>`;
}

async function allSpecies() {
  const s = params.get('sort') || 'alphabetical';
  const { items } = await api(`/api/v1/species?sort=${s}`);
  main.innerHTML = `<div class="card">${sortBar(s, { by: 'species' }, [['alphabetical', 'A-Z'], ['occurrences', 'Count'], ['confidence', 'Confidence'], ['date', 'Recent']])}
    <div class="species-grid">${items.map((i) => `<a href="${qs({ species: i.sci_name })}">${esc(i.com_name)} <small>(${s === 'confidence' ? pct(i.max_confidence) : s === 'date' ? i.last_date : i.count})</small></a>`).join('')}</div></div>`;
}

async function allDates() {
  const { items, today } = await api('/api/v1/dates');
  main.innerHTML = `<div class="card"><div class="species-grid">${items.map((d) => `<a href="${qs({ date: d.date })}">${d.date === today ? 'Today' : d.date} <small>(${d.species} species, ${d.count})</small></a>`).join('')}</div></div>`;
}

async function dateView() {
  const s = params.get('sort') || 'alphabetical';
  const d = date === 'today' ? site.today : date;
  const { items } = await api(`/api/v1/species?sort=${s}&date=${d}`);
  main.innerHTML = `<div class="card"><h2>${d}</h2>${sortBar(s, { date: d }, [['alphabetical', 'A-Z'], ['occurrences', 'Count'], ['confidence', 'Confidence'], ['date', 'Time']])}
    <div class="species-grid">${items.map((i) => `<a href="${qs({ species: i.sci_name, date: d })}">${esc(i.com_name)} <small>(${s === 'confidence' ? pct(i.max_confidence) : s === 'date' ? i.best_time : i.count})</small></a>`).join('')}</div>
    ${items.length ? '' : '<p class="muted">No recordings for this day.</p>'}</div>`;
}

async function speciesView() {
  const d = date === 'today' ? site.today : date;
  main.innerHTML = `<div class="card">
    <div class="row between"><h2 id="title">${esc(species)}</h2>
      <div class="row">${sortBar(sort, { species, date: d, locked }, [['date', 'Date'], ['confidence', 'Confidence']])}
      <label><input type="checkbox" id="locked" ${locked ? 'checked' : ''}> Only purge-protected</label></div></div>
    ${d ? `<p class="muted">Showing ${d} only. <a href="${qs({ species })}">All dates</a></p>` : ''}
    <div class="detection-list two-up" id="list"></div>
    <div class="center" style="margin-top:1rem"><button id="more" hidden>Load 40 more</button></div></div>`;
  $('#locked').onchange = (e) => (location.href = qs({ species, date: d, sort, locked: e.target.checked }));
  let offset = 0;
  const load = async () => {
    const r = await api(`/api/v1/detections?sci=${encodeURIComponent(species)}&sort=${sort}&limit=40&offset=${offset}${d ? '&date=' + d : ''}${locked ? '&locked=1' : ''}`);
    if (r.items[0]) $('#title').textContent = r.items[0].com_name;
    for (const row of r.items) $('#list').append(detectionCard(row, { compact: true, showDate: !d, admin: site.admin, shifted: true, onChange: () => location.reload() }));
    offset += r.items.length;
    $('#more').hidden = offset >= r.total;
    if (!r.total) $('#list').innerHTML = '<p class="muted">No recordings were found.</p>';
  };
  $('#more').onclick = load;
  await load();
}
