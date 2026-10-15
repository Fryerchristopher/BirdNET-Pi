/*
 * Field Journal: shared runtime. Router, header and footer, API client,
 * spectrogram rendering, audio playback, photos with credits, formatting.
 * Pages live in fj/pages/*.js and export render(root, params).
 */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
export const pct = (c) => `${Math.round(c * 100)}%`;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d, opts = {}) { const [y, m, dd] = d.split('-').map(Number); return `${MON[m - 1]} ${dd}${opts.year ? ', ' + y : ''}`; }
export function longDate(d) { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
export const plural = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;

// ---- API ------------------------------------------------------------------------
const cache = new Map();
export async function api(path, { ttl = 0 } = {}) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const res = await fetch(path);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  cache.set(path, { t: Date.now(), v: body });
  return body;
}
export let site = null;
export async function loadSite() { site = await api('/api/v1/journal/site', { ttl: 30_000 }); return site; }

// ---- theme ------------------------------------------------------------------------
export function themeIsDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
export function toggleTheme() {
  const next = themeIsDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('fj-theme', next); } catch { /* fine */ }
  document.dispatchEvent(new Event('fj-theme'));
}
export function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

// ---- router ---------------------------------------------------------------------
const ROUTES = [
  [/^\/$/, 'home'],
  [/^\/species\/?$/, 'search'],
  [/^\/species\/([^/]+)\/?$/, 'species'],
  [/^\/today\/?$/, 'today'],
  [/^\/day\/(\d{4}-\d{2}-\d{2})\/?$/, 'today'],
  [/^\/live\/?$/, 'live'],
  [/^\/archive(?:\/(\d{4}-\d{2}))?\/?$/, 'archive'],
];
let current = null;
export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', href); else history.pushState(null, '', href);
  route();
}
// The admin pages share the header and footer but are plain pages, not routes.
const isAdminPage = document.body.dataset.page === 'admin';
document.addEventListener('click', (e) => {
  if (isAdminPage) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin) return;
  if (u.pathname.startsWith('/admin') || u.pathname.startsWith('/api/') || u.pathname.startsWith('/media/')) return;
  e.preventDefault();
  if (u.pathname + u.search === location.pathname + location.search && !u.hash) { window.scrollTo(0, 0); return; }
  navigate(u.pathname + u.search + u.hash);
});
window.addEventListener('popstate', route);

export async function route() {
  stopAll();
  closeDialog();
  const path = location.pathname;
  let page = 'home', params = {};
  for (const [re, name] of ROUTES) { const m = path.match(re); if (m) { page = name; params = { arg: m[1] ? decodeURIComponent(m[1]) : null }; break; } }
  current = page;
  renderHeader(page);
  const main = $('main.main');
  if (!location.hash) window.scrollTo(0, 0);
  try {
    const mod = await import(`./pages/${page}.js`);
    await mod.render(main, params);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<h1 class="h1">Something went wrong</h1><p class="lede">${esc(err.message)}. <a href="/">Back to this week.</a></p>`;
  }
  if (location.hash) { const t = $(location.hash); if (t) t.scrollIntoView(); }
  document.title = `${site?.site_name || 'Field Journal'}${pageTitle(page, params)}`;
}
function pageTitle(page, p) {
  return { home: ': this week', search: ': species', species: '', today: p.arg ? `: ${p.arg}` : ': today', live: ': listen', archive: ': archive' }[page] ?? '';
}

// ---- header and footer -----------------------------------------------------------
const NAV = [['/', 'This week', 'home'], ['/species', 'Species', 'search'], ['/today', 'Today', 'today'], ['/live', 'Listen', 'live'], ['/archive', 'Archive', 'archive']];
let speciesIndex = null;
async function getSpeciesIndex() {
  if (!speciesIndex) speciesIndex = api('/api/v1/journal/species', { ttl: 300_000 }).then((r) => r.items);
  return speciesIndex;
}

export function renderHeader(page) {
  const s = site;
  const active = (id) => (page === id || (id === 'search' && page === 'species') ? 'active' : '');
  const name = esc(s?.site_name || 'Field Journal');
  const navHtml = NAV.map(([h, l, id]) => `<a href="${h}" class="${active(id)}">${l}</a>`).join('');
  let hdr = $('header.hdr');
  if (!hdr.dataset.built) {
    hdr.innerHTML = `
      <div class="hdr-in">
        <a class="wordmark" href="/">${name}</a>
        <nav class="nav">${navHtml}</nav>
        <div class="hdr-search"><input type="search" placeholder="Find a bird heard at the station" aria-label="Find a bird heard at the station" autocomplete="off"><div class="suggest hidden"></div></div>
      </div>
      <div class="hdr-m">
        <div class="bar">
          <a class="wordmark" href="/">${name}</a>
          <button class="rbtn ms" aria-label="Search"><span class="mag"></span></button>
          <button class="mbtn mm" aria-label="Menu">Menu</button>
        </div>
        <div class="m-search hidden"><input type="search" placeholder="Find a bird heard at the station" aria-label="Find a bird heard at the station" autocomplete="off"><div class="suggest hidden"></div></div>
        <nav class="m-nav hidden">${navHtml}</nav>
      </div>`;
    hdr.dataset.built = '1';
    for (const box of $$('.hdr-search, .m-search', hdr)) wireSearch(box);
    const ms = $('.ms', hdr), mm = $('.mm', hdr), mSearch = $('.m-search', hdr), mNav = $('.m-nav', hdr);
    ms.onclick = () => { mSearch.classList.toggle('hidden'); mNav.classList.add('hidden'); mm.classList.remove('on'); mm.textContent = 'Menu'; ms.classList.toggle('on', !mSearch.classList.contains('hidden')); if (!mSearch.classList.contains('hidden')) $('input', mSearch).focus(); };
    mm.onclick = () => { const open = mNav.classList.toggle('hidden') === false; mSearch.classList.add('hidden'); ms.classList.remove('on'); mm.classList.toggle('on', open); mm.textContent = open ? 'Close' : 'Menu'; };
    mNav.onclick = () => { mNav.classList.add('hidden'); mm.classList.remove('on'); mm.textContent = 'Menu'; };
  } else {
    for (const nav of $$('nav', hdr)) nav.innerHTML = navHtml;
  }
  // offline banner
  let off = $('.offline');
  const offline = s?.station && !s.station.online;
  if (offline && !off) {
    off = el(`<div class="offline"><div>The microphone has not reported since ${esc(s.station.last_seen_local || 'an unknown time')}. Showing the last data received.</div></div>`);
    hdr.after(off);
  } else if (!offline && off) off.remove();
  // footer
  if (!$('footer.ftr')) {
    const f = el(`<footer class="ftr"><div>
      <span>${name}, ${esc((s?.footer_blurb || 'a private BirdNET-Pi listening station').replace(/\.$/, ''))}. Built on <a href="https://github.com/Nachtzuster/BirdNET-Pi" target="_blank" rel="noopener">BirdNET-Pi</a>.</span>
      ${s?.weather_url ? `<a href="${esc(s.weather_url)}">${esc(s.weather_label || 'Weather')}</a>` : ''}
      <span class="right"><button class="theme">${themeIsDark() ? 'Light mode' : 'Dark mode'}</button><a href="/admin/">Admin</a></span>
    </div></footer>`);
    $('#app').append(f);
    $('.theme', f).onclick = (e) => { toggleTheme(); e.target.textContent = themeIsDark() ? 'Light mode' : 'Dark mode'; };
    if (s?.chat_enabled) mountAsk();
  }
}

function wireSearch(box) {
  const input = $('input', box), list = $('.suggest', box);
  let hot = -1;
  const close = () => { list.classList.add('hidden'); list.innerHTML = ''; hot = -1; };
  input.oninput = async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    const all = await getSpeciesIndex();
    const hits = all.filter((x) => x.com_name.toLowerCase().includes(q) || x.sci_name.toLowerCase().includes(q)).slice(0, 6);
    if (!hits.length) return close();
    list.innerHTML = hits.map((h) => `<a href="/species/${h.slug}"><span class="n">${esc(h.com_name)}</span> <span class="s">${esc(h.sci_name)}</span></a>`).join('');
    list.classList.remove('hidden');
    hot = -1;
  };
  input.onkeydown = (e) => {
    const items = $$('a', list);
    if (e.key === 'ArrowDown') { hot = Math.min(items.length - 1, hot + 1); } else if (e.key === 'ArrowUp') { hot = Math.max(0, hot - 1); } else if (e.key === 'Enter') { if (items[hot >= 0 ? hot : 0]) { e.preventDefault(); items[hot >= 0 ? hot : 0].click(); input.value = ''; close(); } return; } else if (e.key === 'Escape') { close(); return; } else return;
    e.preventDefault();
    items.forEach((a, i) => a.classList.toggle('hot', i === hot));
  };
  list.onclick = () => { input.value = ''; close(); box.closest('.m-search')?.classList.add('hidden'); };
  input.onblur = () => setTimeout(close, 150);
}

// ---- photos -----------------------------------------------------------------------
const photoCache = new Map();
export function photosFor(sci) {
  if (!photoCache.has(sci)) photoCache.set(sci, api(`/api/v1/journal/photos/${encodeURIComponent(sci)}`).catch(() => ({ main: null, gallery: [] })));
  return photoCache.get(sci);
}
export function creditHtml(c) {
  if (!c) return '<span class="credit">Photo credit unavailable</span>';
  return `<span class="credit">${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.text)}</a>` : esc(c.text)}</span>`;
}
/**
 * A photo box: fills with the main image when it arrives, otherwise the
 * missing-photo plate (conifer block with the species' spectrogram).
 * Returns { box, credit } elements.
 */
export function photoBox(sci, { href = null, clip = null, alt = '' } = {}) {
  const tag = href ? 'a' : 'div';
  const box = el(`<${tag} class="photo" ${href ? `href="${esc(href)}"` : ''} aria-label="${esc(alt)}"><div class="skel"></div></${tag}>`);
  const credit = el('<span class="credit"></span>');
  photosFor(sci).then((p) => {
    if (p.main?.image_url) {
      const img = el(`<img src="${esc(p.main.image_url)}" alt="${esc(alt || p.main.title || '')}" loading="lazy">`);
      img.onerror = () => missing();
      $('.skel', box)?.remove();
      box.prepend(img);
      credit.innerHTML = creditHtml(p.main.credit).replace(/^<span class="credit">|<\/span>$/g, '');
    } else missing();
  });
  function missing() {
    box.classList.add('empty');
    $('.skel', box)?.remove();
    $('img', box)?.remove();
    box.prepend(spectrogram(clip?.png ?? null, { conifer: true }));
    credit.textContent = 'No photo yet. Spectrogram of its best recording.';
  }
  return { box, credit };
}

// ---- spectrograms -----------------------------------------------------------------
// The Pi's sox PNG is recolored into the design's colormap on a canvas.
const cmapCache = new Map();
function cmapFor(conifer) {
  const key = (conifer ? 'plate:' : 'page:') + (themeIsDark() ? 'd' : 'l');
  if (cmapCache.has(key)) return cmapCache.get(key);
  const stops = cssVar(conifer ? '--cmap-plate' : '--cmap').split(',').map((h) => h.trim()).map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(stops[k][c] * (1 - f) + stops[k + 1][c] * f);
  }
  cmapCache.set(key, lut);
  return lut;
}
document.addEventListener('fj-theme', () => { cmapCache.clear(); $$('.spec[data-src]').forEach((s) => drawSpec(s)); });
const CROP = { l: 0.062, r: 0.093, t: 0.082, b: 0.079 }; // inside the sox plot frame, measured on the Pi's 940-944 x 611 PNGs

export function spectrogram(src, { conifer = false } = {}) {
  const box = el(`<div class="spec ${conifer ? 'conifer' : ''}"><canvas></canvas><div class="ph"></div><span class="elapsed"></span></div>`);
  if (src) { box.dataset.src = src; box.dataset.conifer = conifer ? '1' : ''; drawSpec(box); } else box.append(el('<div class="none">No spectrogram</div>'));
  return box;
}
function drawSpec(box) {
  const img = new Image();
  img.onload = () => {
    const cv = $('canvas', box), ctx = cv.getContext('2d');
    const sx = Math.round(img.width * CROP.l), sy = Math.round(img.height * CROP.t);
    const sw = Math.round(img.width * (1 - CROP.l - CROP.r)), sh = Math.round(img.height * (1 - CROP.t - CROP.b));
    cv.width = Math.min(sw, 900); cv.height = Math.min(sh, 300);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    const d = ctx.getImageData(0, 0, cv.width, cv.height), p = d.data, lut = cmapFor(!!box.dataset.conifer);
    for (let i = 0; i < p.length; i += 4) {
      const lum = Math.min(255, Math.round(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]));
      p[i] = lut[lum * 3]; p[i + 1] = lut[lum * 3 + 1]; p[i + 2] = lut[lum * 3 + 2]; p[i + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
  };
  img.onerror = () => { $('canvas', box)?.remove(); if (!$('.none', box)) box.append(el('<div class="none">Spectrogram not available</div>')); };
  img.src = box.dataset.src;
}

// ---- audio ---------------------------------------------------------------------------
let activeAudio = null, activeRaf = 0;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function stopAll() {
  if (activeAudio) { activeAudio.pause(); activeAudio = null; }
  cancelAnimationFrame(activeRaf);
  $$('.spec.playing').forEach((s) => s.classList.remove('playing'));
  $$('[data-playing]').forEach((b) => setPlayLabel(b, false));
}
function setPlayLabel(btn, playing) {
  if (playing) btn.dataset.playing = '1'; else delete btn.dataset.playing;
  const icon = $('.tri, .pausebars', btn);
  if (icon) icon.className = playing ? 'pausebars' : (icon.dataset.cls || 'tri');
  const lbl = $('.lbl', btn);
  if (lbl) lbl.textContent = playing ? 'Pause' : btn.dataset.label || 'Play';
  btn.setAttribute('aria-label', playing ? 'Pause' : btn.dataset.label || 'Play');
}
/** Bind a play button to a clip URL and a .spec element (for the playhead). */
export function bindPlay(btn, src, spec) {
  const icon = $('.tri, .pausebars', btn);
  if (icon) icon.dataset.cls = icon.className;
  btn.onclick = (e) => {
    e.stopPropagation();
    if (!src) return;
    if (btn.dataset.playing) { stopAll(); return; }
    stopAll();
    const a = new Audio(src);
    activeAudio = a;
    setPlayLabel(btn, true);
    spec?.classList.add('playing');
    const tick = () => {
      if (activeAudio !== a) return;
      if (spec && a.duration) {
        const f = Math.min(1, a.currentTime / a.duration);
        const ph = $('.ph', spec); if (ph) ph.style.left = `${f * 100}%`;
        const elp = $('.elapsed', spec); if (elp && reduced) elp.textContent = `${a.currentTime.toFixed(1)} s`;
      }
      activeRaf = requestAnimationFrame(tick);
    };
    a.onended = () => { if (activeAudio === a) stopAll(); };
    a.onerror = () => { stopAll(); };
    a.play().then(tick).catch(() => stopAll());
  };
}
export function playButton(cls, src, spec, label) {
  const b = el(`<button class="play ${cls}" aria-label="${esc(label || 'Play')}"><span class="tri sm"></span></button>`);
  if (label) b.dataset.label = label;
  bindPlay(b, src, spec);
  return b;
}
export function playPill(label, src, spec, cls = '') {
  const b = el(`<button class="play-pill ${cls}" data-label="${esc(label)}"><span class="tri"></span><span class="lbl">${esc(label)}</span></button>`);
  bindPlay(b, src, spec);
  return b;
}

// ---- dialog ---------------------------------------------------------------------------
let dialogState = null;
export function closeDialog() {
  const d = $('.scrim');
  if (!d) return;
  stopAll();
  d.remove();
  document.removeEventListener('keydown', onDialogKey);
  const back = dialogState?.returnTo; dialogState = null;
  back?.focus?.();
}
function onDialogKey(e) {
  if (!dialogState) return;
  if (e.key === 'Escape') closeDialog();
  else if (e.key === 'ArrowRight') dialogState.next();
  else if (e.key === 'ArrowLeft') dialogState.prev();
}
/**
 * Recording detail view. clips: [{file_name, date, time, confidence, audio, png, com_name, sci_name}], index.
 */
export function openRecording(clips, index, { returnTo = null } = {}) {
  closeDialog();
  dialogState = { clips, index, returnTo, next: () => show((dialogState.index + 1) % clips.length), prev: () => show((dialogState.index - 1 + clips.length) % clips.length) };
  const scrim = el('<div class="scrim"></div>');
  scrim.onclick = (e) => { if (e.target === scrim) closeDialog(); };
  document.body.append(scrim);
  document.addEventListener('keydown', onDialogKey);
  show(index);
  function show(i) {
    stopAll();
    dialogState.index = i;
    const c = clips[i];
    scrim.innerHTML = '';
    const dlg = el(`<div class="dlg" role="dialog" aria-modal="true" aria-label="Recording details">
      <div class="top"><div><span class="n">${esc(c.com_name)}</span> <span class="s">${esc(c.sci_name)}</span></div>
        <div class="ctl"><span class="pos">${i + 1} of ${clips.length}</span><button class="rnd40 prev" aria-label="Previous recording"><span class="arrow-l"></span></button><button class="rnd40 next" aria-label="Next recording"><span class="arrow-r"></span></button><button class="pill-neutral close">Close</button></div></div>
      <div class="body">
        <figure><div class="pslot"></div><figcaption class="credit"></figcaption></figure>
        <div class="r">
          <div><div class="specwrap"></div><div class="axis"><span>0 s</span><span>1</span><span>2</span><span class="end">3 s</span></div></div>
          <div class="acts"></div>
          <div class="facts">
            <div class="fact"><span class="muted">Heard</span><span class="v">${c.date === site?.today ? 'Today' : fmtDate(c.date, { year: true })}, ${hhmm(c.time)}</span></div>
            <div class="fact"><span class="muted">Confidence</span><span class="v">${pct(c.confidence)}</span></div>
            <div class="fact cond"><span class="muted">Conditions</span><span class="v muted">Loading</span></div>
            <div class="fact len"><span class="muted">Length</span><span class="v">3 seconds</span></div>
          </div>
        </div>
      </div></div>`);
    scrim.append(dlg);
    const spec = spectrogram(c.png, { conifer: true });
    $('.specwrap', dlg).append(spec);
    const pill = playPill('Play', c.audio, spec);
    $('.acts', dlg).append(pill);
    if (c.audio) $('.acts', dlg).append(el(`<a href="${esc(c.audio)}" download style="font-weight:600">Download clip</a>`));
    const ph = photoBox(c.sci_name, { clip: c, alt: c.com_name });
    $('.pslot', dlg).replaceWith(ph.box);
    $('figcaption', dlg).replaceWith(ph.credit);
    $('.prev', dlg).onclick = dialogState.prev; $('.next', dlg).onclick = dialogState.next; $('.close', dlg).onclick = closeDialog;
    // clip length and conditions
    if (c.audio) { const a = new Audio(); a.preload = 'metadata'; a.src = c.audio; a.onloadedmetadata = () => { if (!a.duration) return; const s = Math.round(a.duration); $('.len .v', dlg).textContent = `${s} seconds`; $('.axis .end', dlg).textContent = `${s} s`; const mid = $$('.axis span', dlg); mid[1].textContent = String(Math.round(s / 3)); mid[2].textContent = String(Math.round((2 * s) / 3)); }; }
    api(`/api/v1/journal/recording/${encodeURIComponent(c.file_name)}`).then((r) => { const v = $('.cond .v', dlg); if (!v) return; v.classList.remove('muted'); v.textContent = r.conditions ? r.conditions.summary : 'Not recorded'; }).catch(() => { const v = $('.cond .v', dlg); if (v) v.textContent = 'Not recorded'; });
    $('.close', dlg).focus();
  }
}

// ---- presence of empty states ---------------------------------------------------------
export function emptyToday(sun) { return `No birds heard yet today.${sun?.sunrise ? ` Sunrise at the station is at ${sun.sunrise}.` : ''}`; }

// ---- Ask (optional) --------------------------------------------------------------------
function mountAsk() {
  const fab = el('<button class="ask-fab">Ask the station</button>');
  const panel = el(`<div class="ask-panel" hidden><header><span>Ask the station</span><button class="pill-neutral close">Close</button></header><div class="log"><div class="msg a">Ask about what has been heard here: species, counts, first arrivals, the best time of day for a bird.</div></div><form><input type="text" maxlength="400" placeholder="What was heard most this week?" required><button>Ask</button></form></div>`);
  document.body.append(fab, panel);
  fab.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) $('input', panel).focus(); };
  $('.close', panel).onclick = () => (panel.hidden = true);
  const log = $('.log', panel);
  $('form', panel).onsubmit = async (e) => {
    e.preventDefault();
    const input = $('input', panel); const q = input.value.trim(); if (!q) return; input.value = '';
    log.append(el(`<div class="msg q">${esc(q)}</div>`));
    const a = el('<div class="msg a muted">Thinking</div>'); log.append(a); log.scrollTop = log.scrollHeight;
    try { const r = await fetch('/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) }); const j = await r.json(); a.textContent = j.answer || 'No answer.'; } catch { a.textContent = 'Something went wrong.'; }
    a.classList.remove('muted'); log.scrollTop = log.scrollHeight;
  };
}

// ---- boot --------------------------------------------------------------------------------
if (!isAdminPage) loadSite().catch(() => null).then(route);
