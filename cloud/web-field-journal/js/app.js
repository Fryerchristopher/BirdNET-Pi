/*
 * BirdNET-Pi Cloud: shared front-end runtime for the default UI.
 *
 * Everything here talks to /api/v1 (docs/API.md). Pages import this module,
 * call renderShell() for the header and nav, and build their content with
 * the helpers below. There is no framework and no build step: edit, reload.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (c) => `${Math.round(Number(c) * 100)}%`;
export const params = new URLSearchParams(location.search);
export const station = params.get('station') || '';

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---- API ------------------------------------------------------------------

export async function api(path, opts = {}) {
  const u = new URL(path, location.origin);
  if (station && !u.searchParams.has('station')) u.searchParams.set('station', station);
  const res = await fetch(u, opts);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

export const adminToken = {
  get: () => sessionStorage.getItem('birdnet_admin_token') || '',
  set: (t) => (t ? sessionStorage.setItem('birdnet_admin_token', t) : sessionStorage.removeItem('birdnet_admin_token')),
};

export async function adminApi(path, body, method = 'POST') {
  const headers = { 'content-type': 'application/json' };
  const t = adminToken.get();
  if (t) headers.authorization = `Bearer ${t}`;
  return api(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

let siteCache = null;
export async function getSite() {
  if (!siteCache) siteCache = await api('/api/v1/site');
  return siteCache;
}

// ---- shell ----------------------------------------------------------------

const NAV = [
  ['/', 'Overview'], ['/today', "Today's Detections"], ['/spectrogram', 'Spectrogram'], ['/best', 'Best Recordings'],
  ['/stats', 'Species Stats'], ['/daily', 'Daily Charts'], ['/weekly', 'Weekly Report'], ['/recordings', 'Recordings'],
];

export async function renderShell(active) {
  const site = await getSite().catch(() => ({ settings: {}, station: null, admin: false }));
  const s = site.settings || {};
  document.title = `${s.site_name || 'BirdNET-Pi'}${active ? ' · ' + active : ''}`;
  if (params.get('theme')) $('#theme-css').href = `/theme.css?theme=${encodeURIComponent(params.get('theme'))}`;
  const st = site.station;
  const online = !!st?.online;
  const header = el(`
    <header class="site-header">
      <a class="brand" href="/"><img src="/img/bird.svg" alt=""> <span>${esc(s.site_name || 'BirdNET-Pi')}</span></a>
      <div class="status">
        ${s.stream_url ? '<a class="btn" href="/spectrogram">Live audio</a>' : ''}
        <span title="${esc(st?.last_seen_at ? 'Last push ' + st.last_seen_at : 'No data yet')}"><span class="dot ${online ? 'online' : 'offline'}"></span> ${online ? 'Station online' : 'Station offline'}</span>
        ${site.admin || s.public_admin_links === '1' ? '<a href="/admin/">Admin</a>' : ''}
      </div>
    </header>`);
  const nav = el(`<nav class="site-nav"><button class="menu-toggle btn">Menu</button><ul>${NAV.map(([h, l]) => `<li><a href="${h}" class="${l === active ? 'active' : ''}">${l}</a></li>`).join('')}${site.admin ? '<li><a href="/admin/" class="' + (active === 'Admin' ? 'active' : '') + '">Tools</a></li>' : ''}</ul></nav>`);
  nav.querySelector('.menu-toggle').onclick = () => nav.classList.toggle('open');
  const footer = el(`<footer class="site-footer">
    <span>Powered by <a href="https://github.com/Nachtzuster/BirdNET-Pi" target="_blank" rel="noopener">BirdNET-Pi</a></span>
    <span>Station time zone: ${esc(st?.timezone || 'UTC')}</span>
    ${st?.pi_version ? `<span>Pi ${esc(st.pi_version)}</span>` : ''}
    <span><a href="/api/v1/site">API</a></span>
  </footer>`);
  document.body.prepend(nav);
  document.body.prepend(header);
  document.body.append(footer);
  if (params.get('kiosk') === '1') document.body.classList.add('kiosk');
  if (s.chat_enabled === '1' || site.chat_enabled) mountAsk(s);
  return site;
}

export function toast(msg, ms = 2500) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---- species helpers ---------------------------------------------------------

export const mediaUrl = (row, shifted = false) => `/media/${shifted ? row.media_key.replace('by_date/', 'by_date/shifted/') : row.media_key}`;
export const pngUrl = (row) => `/media/${row.media_key}.png`;
export const wikiUrl = (sci) => `https://wikipedia.org/wiki/${encodeURIComponent(sci.replace(/ /g, '_'))}`;
export const infoUrl = (sci) => `/api/v1/species/${encodeURIComponent(sci)}/info`;
export const bestUrl = (sci) => `/best?species=${encodeURIComponent(sci)}`;
export const recordingsUrl = (sci, date) => `/recordings?species=${encodeURIComponent(sci)}${date ? '&date=' + date : ''}`;

const imageCache = new Map();
export async function speciesImage(sci) {
  if (!imageCache.has(sci)) {
    imageCache.set(sci, api(`/api/v1/image/${encodeURIComponent(sci)}`).then((r) => r.data).catch(() => null));
  }
  return imageCache.get(sci);
}

/** <img> that fills in when the provider answers; click opens attribution. */
export function thumb(sci, cls = 'thumb') {
  const img = el(`<div class="${cls} empty" title="${esc(sci)}">&#9679;</div>`);
  speciesImage(sci).then((d) => {
    if (!d) return;
    const i = el(`<img class="${cls}" src="${esc(d.image_url)}" alt="${esc(d.title)}" loading="lazy">`);
    i.onclick = () => showAttribution(d);
    img.replaceWith(i);
  });
  return img;
}

export function showAttribution(d) {
  let dlg = $('#attribution-dialog');
  if (!dlg) {
    dlg = el(`<dialog id="attribution-dialog"><h2></h2><div class="body"></div><div class="row"><button class="close">Close</button><button class="blacklist" hidden>Blacklist this image</button></div></dialog>`);
    document.body.append(dlg);
    dlg.querySelector('.close').onclick = () => dlg.close();
  }
  dlg.querySelector('h2').textContent = `Photo: "${d.title}"`;
  dlg.querySelector('.body').innerHTML = `<img class="preview" src="${esc(d.image_url)}" alt="">
    <div>Image: <a href="${esc(d.photos_url)}" target="_blank" rel="noopener">${esc(d.photos_url)}</a></div>
    <div>Author: <a href="${esc(d.author_url)}" target="_blank" rel="noopener">${esc(d.author_url)}</a></div>
    <div>License: <a href="${esc(d.license_url)}" target="_blank" rel="noopener">${esc(d.license_url)}</a></div>`;
  const bl = dlg.querySelector('.blacklist');
  bl.hidden = !(d.provider === 'flickr' && adminToken.get());
  bl.onclick = async () => {
    if (!confirm('Blacklist this image?')) return;
    await adminApi('/api/v1/admin/images/blacklist', { image_id: d.image_id });
    imageCache.delete(d.sci_name);
    dlg.close();
    location.reload();
  };
  dlg.showModal();
}

// ---- audio player ----------------------------------------------------------

/** Spectrogram-backed player, modeled on static/custom-audio-player.js. */
export function player(audioSrc, imgSrc, { preload = 'none' } = {}) {
  const root = el(`<div class="player">
    ${imgSrc ? `<img src="${esc(imgSrc)}" alt="spectrogram" loading="lazy">` : '<div class="no-spec">No spectrogram</div>'}
    <div class="cursor"></div>
    <button class="play" aria-label="Play">&#9654;</button>
    <div class="bar"><input type="range" min="0" max="1000" value="0"><span class="t">0:00</span><a href="${esc(audioSrc)}" download title="Download">&#8681;</a></div>
  </div>`);
  const audio = new Audio();
  audio.preload = preload;
  audio.src = audioSrc;
  const play = root.querySelector('.play');
  const range = root.querySelector('input');
  const cursor = root.querySelector('.cursor');
  const img = root.querySelector('img');
  const time = root.querySelector('.t');
  const L = 6, R = 9; // sox axes margins, percent
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const toggle = () => (audio.paused ? (pauseOthers(audio), audio.play()) : audio.pause());
  play.onclick = toggle;
  if (img) {
    img.onclick = toggle;
    img.onerror = () => img.replaceWith(el('<div class="no-spec">Spectrogram not available</div>'));
  }
  audio.onplay = () => play.classList.add('playing');
  audio.onpause = audio.onended = () => play.classList.remove('playing');
  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    const f = audio.currentTime / audio.duration;
    range.value = Math.round(f * 1000);
    cursor.style.left = `${L + f * (100 - L - R)}%`;
    time.textContent = fmt(audio.currentTime);
  };
  range.oninput = () => { if (audio.duration) audio.currentTime = (range.value / 1000) * audio.duration; };
  root.audio = audio;
  allPlayers.add(audio);
  return root;
}
const allPlayers = new Set();
function pauseOthers(a) { for (const p of allPlayers) if (p !== a && !p.paused) p.pause(); }
export const anyPlaying = () => [...allPlayers].some((p) => !p.paused && !p.ended);

// ---- detection card ----------------------------------------------------------

/**
 * One detection. opts: { compact, showDate, admin, onChange, shifted }
 */
export function detectionCard(row, opts = {}) {
  const sci = row.sci_name;
  const card = el(`<article class="detection ${opts.compact ? 'compact' : ''}" data-file="${esc(row.file_name)}">
    <div class="thumb-slot"></div>
    <div class="meta">
      <div class="name"><a href="${bestUrl(sci)}">${esc(row.com_name)}</a> ${opts.tag ? `<span class="new-tag">${esc(opts.tag)}</span>` : ''}</div>
      <div class="sci">${esc(sci)}</div>
      <div class="when">${opts.showDate ? esc(row.date) + ' ' : ''}${esc(row.time)} &middot; <span class="conf">${pct(row.confidence)}</span>${row.confidence === 0 ? ' <span class="pill" title="Re-identified by hand">manual</span>' : ''}${opts.extra ? ' &middot; ' + opts.extra : ''}</div>
      <div class="links">
        <a class="btn" href="${infoUrl(sci)}" target="_blank" rel="noopener">Info</a>
        <a class="btn" href="${wikiUrl(sci)}" target="_blank" rel="noopener">Wikipedia</a>
        <button class="graph" title="Detections over time">Trend</button>
        <a class="btn" href="/recordings?file=${encodeURIComponent(row.file_name)}" title="Open on its own page">Open</a>
      </div>
    </div>
  </article>`);
  card.querySelector('.thumb-slot').replaceWith(thumb(sci, 'thumb'));
  card.querySelector('.graph').onclick = (e) => miniGraph(e.currentTarget, sci, row.com_name);
  if (row.has_audio) {
    const p = player(mediaUrl(row, opts.shifted && row.has_shifted), row.has_png ? pngUrl(row) : null);
    p.classList.add('player');
    card.append(p);
  } else {
    card.append(el(`<div class="player muted" style="padding:.4rem;background:var(--surface-2)">${row.on_pi ? 'Audio not uploaded yet' : 'Audio no longer available'}</div>`));
  }
  if (opts.admin) card.querySelector('.meta').append(adminActions(row, opts.onChange));
  return card;
}

function adminActions(row, onChange) {
  const box = el(`<div class="actions">
    <button class="icon" data-act="lock" title="${row.locked ? 'Protected from purge on the Pi' : 'Will be purged when the Pi runs out of disk'}">${row.locked ? '&#128274;' : '&#128275;'}</button>
    <button class="icon" data-act="shift" title="${row.has_shifted ? 'Remove the pitch-shifted copy' : 'Create a pitch-shifted copy'}">${row.has_shifted ? '&#9660;' : '&#9650;'}</button>
    <button class="icon" data-act="reid" title="Change species">&#9998;</button>
    <button class="icon" data-act="delete" title="Delete detection">&#10006;</button>
  </div>`);
  box.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const f = encodeURIComponent(row.file_name);
    try {
      if (b.dataset.act === 'delete') {
        if (!confirm(`Delete this ${row.com_name} detection and its files?`)) return;
        await adminApi(`/api/v1/admin/detections/${f}/delete`);
        toast('Delete queued for the Pi');
      } else if (b.dataset.act === 'lock') {
        await adminApi(`/api/v1/admin/detections/${f}/${row.locked ? 'unlock' : 'lock'}`);
        toast(row.locked ? 'Unlocked' : 'Locked');
      } else if (b.dataset.act === 'shift') {
        await adminApi(`/api/v1/admin/detections/${f}/${row.has_shifted ? 'unshift' : 'shift'}`);
        toast(row.has_shifted ? 'Shifted copy will be removed' : 'Shift queued; the copy appears when the Pi is done');
      } else if (b.dataset.act === 'reid') {
        const pick = await pickLabel();
        if (!pick) return;
        if (!confirm(`Change this detection to ${pick.com_name}?`)) return;
        await adminApi(`/api/v1/admin/detections/${f}/reidentify`, pick);
        toast('Re-identification queued for the Pi');
      }
      onChange && onChange();
    } catch (err) {
      toast(err.status === 401 ? 'Admin login required (Admin page)' : err.message);
    }
  };
  return box;
}

let labelsCache = null;
export async function pickLabel() {
  if (!labelsCache) labelsCache = (await api('/api/v1/labels')).items;
  return new Promise((resolve) => {
    const dlg = el(`<dialog><h2>Select the correct species</h2><input type="search" placeholder="Type to filter..." autofocus><div class="label-picker"></div><div class="row" style="margin-top:.6rem"><button class="cancel">Cancel</button></div></dialog>`);
    const list = dlg.querySelector('.label-picker');
    const input = dlg.querySelector('input');
    const render = () => {
      const q = input.value.toLowerCase();
      list.innerHTML = labelsCache.filter((l) => !q || l.com_name.toLowerCase().includes(q) || l.sci_name.toLowerCase().includes(q)).slice(0, 200)
        .map((l) => `<div data-sci="${esc(l.sci_name)}" data-com="${esc(l.com_name)}">${esc(l.com_name)} <small>${esc(l.sci_name)}</small></div>`).join('');
    };
    input.oninput = render;
    render();
    list.onclick = (e) => { const d = e.target.closest('div[data-sci]'); if (d) { dlg.close(); resolve({ sci_name: d.dataset.sci, com_name: d.dataset.com }); } };
    dlg.querySelector('.cancel').onclick = () => { dlg.close(); resolve(null); };
    dlg.onclose = () => dlg.remove();
    document.body.append(dlg);
    dlg.showModal();
  });
}

// ---- mini graph --------------------------------------------------------------

let chartLib = null;
export async function loadChart() {
  if (window.Chart) return window.Chart;
  if (!chartLib) chartLib = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload = () => res(window.Chart);
    s.onerror = rej;
    document.head.append(s);
  });
  return chartLib;
}

export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export async function miniGraph(anchor, sci, comName) {
  $$('.minigraph').forEach((m) => m.remove());
  const box = el(`<div class="minigraph"><div class="hdr"><strong>${esc(comName)}</strong><span><select><option value="30">30 days</option><option value="180">180</option><option value="365">365</option><option value="730">730</option></select> <button class="ghost">&times;</button></span></div><div class="chart-box"><canvas height="140"></canvas></div></div>`);
  const r = anchor.getBoundingClientRect();
  box.style.top = `${Math.max(8, Math.min(window.innerHeight - 220, r.top - 60))}px`;
  box.style.left = `${Math.min(window.innerWidth - 440, r.right + 8)}px`;
  document.body.append(box);
  box.querySelector('button').onclick = () => box.remove();
  const close = () => { box.remove(); window.removeEventListener('scroll', close); };
  window.addEventListener('scroll', close, { once: true });
  const Chart = await loadChart();
  let chart;
  const draw = async (days) => {
    const d = await api(`/api/v1/species/${encodeURIComponent(sci)}/history?days=${days}`);
    chart?.destroy();
    chart = new Chart(box.querySelector('canvas'), {
      type: 'line',
      data: { labels: d.items.map((i) => i.date.slice(5)), datasets: [{ data: d.items.map((i) => i.count), fill: true, backgroundColor: cssVar('--accent-dim'), borderColor: cssVar('--accent'), borderWidth: 1, tension: .3, pointRadius: 1 }] },
      options: { plugins: { legend: { display: false }, title: { display: true, text: `Detections over ${days}d`, color: cssVar('--text-muted') } }, scales: { x: { ticks: { maxTicksLimit: 6, color: cssVar('--text-muted') }, grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0, color: cssVar('--text-muted') } } } },
    });
  };
  box.querySelector('select').onchange = (e) => draw(Number(e.target.value));
  draw(30);
}

// ---- Ask BirdNET-Pi -----------------------------------------------------------

function mountAsk(settings) {
  const fab = el('<button class="ask-fab primary">Ask BirdNET-Pi</button>');
  const panel = el(`<div class="ask-panel" hidden>
    <header><strong>Ask BirdNET-Pi</strong><button class="ghost close">&times;</button></header>
    <div class="log"><div class="msg a">${esc(settings.chat_intro || 'Ask me about what this station has heard.')}</div></div>
    <form><input type="text" maxlength="400" placeholder="What was heard most this week?" required><button class="primary">Ask</button></form>
  </div>`);
  document.body.append(fab, panel);
  fab.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) panel.querySelector('input').focus(); };
  panel.querySelector('.close').onclick = () => (panel.hidden = true);
  const log = panel.querySelector('.log');
  panel.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const input = panel.querySelector('input');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    log.append(el(`<div class="msg q">${esc(q)}</div>`));
    const a = el('<div class="msg a muted">Thinking...</div>');
    log.append(a);
    log.scrollTop = log.scrollHeight;
    try {
      const r = await api('/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) });
      a.textContent = r.answer;
    } catch (err) {
      a.textContent = err.body?.answer || 'Something went wrong.';
    }
    a.classList.remove('muted');
    log.scrollTop = log.scrollHeight;
  };
}

// ---- misc ---------------------------------------------------------------------

export function relativeTime(date, time) {
  const t = new Date(`${date}T${time}`);
  const s = Math.round((Date.now() - t.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return `${Math.floor(s / 86400)} days ago`;
}

export function onVisible(fn) {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
}

export function every(ms, fn) {
  let id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  return () => clearInterval(id);
}
