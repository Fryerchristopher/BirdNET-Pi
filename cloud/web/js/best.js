/* Best Recordings (the Pi's stats.php): species list with sort, the best recording per species, Flickr gallery. */
import { renderShell, api, el, esc, $, params, player, mediaUrl, pngUrl, infoUrl, wikiUrl, recordingsUrl, thumb, showAttribution, pct } from './app.js';

const site = await renderShell('Best Recordings');
const sort = params.get('sort') || 'alphabetical';
const selected = params.get('species');
const main = $('#main');
main.innerHTML = `<div class="grid sidebar">
  <div class="card">
    <div class="sort-bar">${[['alphabetical', 'A-Z'], ['occurrences', 'Count'], ['confidence', 'Confidence'], ['date', 'Recent']].map(([k, l]) => `<a href="?sort=${k}${selected ? '&species=' + encodeURIComponent(selected) : ''}" class="${k === sort ? 'active' : ''}">${l}</a>`).join('')}</div>
    <input type="search" id="filter" placeholder="Filter species" style="width:100%;margin-bottom:.5rem">
    <div class="species-grid" id="species" style="grid-template-columns:1fr"></div>
  </div>
  <div>
    <div id="detail"></div>
    <div class="card"><h2>${selected ? 'Best recordings for other species' : 'Best recordings'}</h2><div class="detection-list" id="all"></div></div>
  </div></div>`;

const { items } = await api(`/api/v1/species?sort=${sort}`);
const label = (s) => {
  if (sort === 'confidence') return `${s.com_name} (${pct(s.max_confidence)})`;
  if (sort === 'occurrences') return `${s.com_name} (${s.count >= 1000 ? (s.count / 1000).toFixed(1) + 'k' : s.count})`;
  if (sort === 'date') return `${s.com_name} (${s.last_date})`;
  return s.com_name;
};
const list = $('#species');
const renderList = (q = '') => {
  list.innerHTML = items.filter((s) => !q || s.com_name.toLowerCase().includes(q) || s.sci_name.toLowerCase().includes(q))
    .map((s) => `<a href="?sort=${sort}&species=${encodeURIComponent(s.sci_name)}" class="${s.sci_name === selected ? 'active' : ''}">${esc(label(s))}</a>`).join('');
};
renderList();
$('#filter').oninput = (e) => renderList(e.target.value.toLowerCase());

function bestCard(s, big) {
  const row = { media_key: s.best_media_key, has_audio: s.best_has_audio, has_png: s.best_has_png };
  const card = el(`<article class="detection ${big ? '' : 'compact'}">
    <div class="thumb-slot"></div>
    <div class="meta">
      <div class="name"><a href="?sort=${sort}&species=${encodeURIComponent(s.sci_name)}">${esc(s.com_name)}</a></div>
      <div class="sci">${esc(s.sci_name)}</div>
      <div class="when">Occurrences: <strong>${s.count}</strong> &middot; Max confidence: <strong>${pct(s.max_confidence)}</strong> &middot; Best recording: ${esc(s.best_date)} ${esc(s.best_time)}</div>
      <div class="links"><a class="btn" href="${infoUrl(s.sci_name)}" target="_blank" rel="noopener">Info</a><a class="btn" href="${wikiUrl(s.sci_name)}" target="_blank" rel="noopener">Wikipedia</a><a class="btn" href="${recordingsUrl(s.sci_name)}">All recordings</a><a class="btn" href="/recordings?file=${encodeURIComponent(s.best_file_name)}">Open</a></div>
    </div></article>`);
  card.querySelector('.thumb-slot').replaceWith(thumb(s.sci_name));
  if (row.has_audio) { const p = player(mediaUrl(row), row.has_png ? pngUrl(row) : null); p.classList.add('player'); card.append(p); }
  return card;
}

if (selected) {
  const s = items.find((i) => i.sci_name === selected);
  const d = $('#detail');
  if (s) {
    d.append(el(`<div class="card"><h2>${esc(s.com_name)}</h2></div>`));
    d.firstElementChild.append(bestCard(s, true));
    if (site.flickr_enabled) {
      const g = el('<div class="card"><h3>Photos from Flickr</h3><p class="muted">Loading...</p></div>');
      d.append(g);
      api(`/api/v1/species/${encodeURIComponent(selected)}/gallery`).then((r) => {
        g.innerHTML = '<h3>Photos from Flickr</h3>' + (r.items.length ? '' : '<p class="muted">No photos.</p>');
        for (const [i, p] of r.items.entries()) {
          const im = el(`<img src="${esc(p.image_url)}" alt="${esc(p.title)}" style="height:120px;margin:.2rem;border-radius:var(--radius-sm);cursor:pointer">`);
          im.onclick = () => showAttribution({ ...p, title: `Photo ${i + 1}: ${p.title}`, license_url: 'https://www.flickr.com/creativecommons/' , provider: 'flickr-gallery' });
          g.append(im);
        }
      });
    }
    document.title += ` · ${s.com_name}`;
  } else d.innerHTML = `<div class="card"><p>No detections for ${esc(selected)}.</p></div>`;
}

const all = $('#all');
for (const s of items) if (s.sci_name !== selected) all.append(bestCard(s, false));
if (!items.length) all.innerHTML = '<p class="muted">No detections yet.</p>';
