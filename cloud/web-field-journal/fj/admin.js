/*
 * Field Journal admin: settings, species, species lists, station, command log.
 * Plain Figtree pages on --surface with the site's header and footer (design
 * handoff, "Admin"). Mutations go through /api/v1/admin and need Cloudflare
 * Access on /admin or the ADMIN_TOKEN (ADMIN_AUTH=token).
 */
import { $, $$, el, esc, loadSite, renderHeader } from './app.js';

// ---- API ----------------------------------------------------------------------------
const token = {
  get: () => { try { return sessionStorage.getItem('birdnet_admin_token') || ''; } catch { return ''; } },
  set: (t) => { try { t ? sessionStorage.setItem('birdnet_admin_token', t) : sessionStorage.removeItem('birdnet_admin_token'); } catch { /* fine */ } },
};
async function call(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const t = token.get();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { status: res.status });
  return j;
}
const admin = (path, body, method = body === undefined ? 'GET' : 'POST') => call(`/api/v1/admin${path}`, { method, body });

// ---- small UI pieces ------------------------------------------------------------------
function toast(msg) {
  const t = el(`<div class="adm-toast" role="status">${esc(msg)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}
const slug = (sci) => String(sci).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = (n) => Number(n ?? 0).toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : esc(d || ''); };

/** Destructive actions: name the action and make the user type it (design handoff). */
function confirmTyped({ title, body, phrase, action }) {
  return new Promise((resolve) => {
    const d = el(`<div class="adm-scrim"><div class="panel lake-top adm-dlg" role="dialog" aria-modal="true" aria-labelledby="adm-dlg-t">
      <h2 class="h2-panel" id="adm-dlg-t">${esc(title)}</h2>
      <p class="reading">${body}</p>
      <label class="adm-lbl" for="adm-dlg-i">Type <b>${esc(phrase)}</b> to confirm</label>
      <input id="adm-dlg-i" class="adm-in" autocomplete="off" spellcheck="false">
      <div class="adm-actions"><button class="pill-neutral no">Cancel</button><button class="adm-danger yes" disabled>${esc(action)}</button></div>
    </div></div>`);
    const input = $('input', d), yes = $('.yes', d);
    const done = (v) => { d.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    input.oninput = () => (yes.disabled = input.value.trim() !== phrase);
    yes.onclick = () => done(true);
    $('.no', d).onclick = () => done(false);
    d.onclick = (e) => { if (e.target === d) done(false); };
    document.addEventListener('keydown', onKey);
    document.body.append(d);
    input.focus();
  });
}

// ---- page ------------------------------------------------------------------------------
const TABS = [['settings', 'Settings'], ['species', 'Species'], ['lists', 'Species lists'], ['station', 'Station'], ['commands', 'Command log']];
const tab = new URLSearchParams(location.search).get('tab') || 'settings';
const site = await loadSite().catch(() => null);
renderHeader('admin');
document.title = `${site?.site_name || 'Field Journal'}: admin`;
const main = $('main.main');

async function isAdmin() { try { await admin('/me'); return true; } catch { return false; } }

if (!(await isAdmin())) {
  main.innerHTML = `<div class="adm-login">
    <h1 class="h1">Admin</h1>
    <p class="lede">Sign in with the admin token set on the Worker.</p>
    <form class="panel lake-top adm-pad">
      <label class="adm-lbl" for="tok">Admin token</label>
      <input class="adm-in" type="password" id="tok" autocomplete="current-password" required>
      <p class="adm-help">This is the ADMIN_TOKEN secret, not the Pi's password. With Cloudflare Access in front of /admin this box never appears.</p>
      <p class="adm-err hidden" role="alert">That token was not accepted.</p>
      <div class="adm-actions"><button class="adm-save">Sign in</button></div>
    </form></div>`;
  $('form', main).onsubmit = async (e) => {
    e.preventDefault();
    token.set($('#tok').value.trim());
    if (await isAdmin()) location.reload();
    else { token.set(''); $('.adm-err', main).classList.remove('hidden'); $('#tok').select(); }
  };
} else {
  main.innerHTML = `<div class="sec-head"><h1 class="h1">Admin</h1>
      <span class="adm-who">${esc(site?.site_name || '')} <button class="linkbtn" id="logout">Sign out</button></span></div>
    <nav class="adm-tabs" aria-label="Admin sections">${TABS.map(([k, l]) => `<a href="?tab=${k}" class="${k === tab ? 'active' : ''}"${k === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="tab"></div>`;
  $('#logout').onclick = () => { token.set(''); location.reload(); };
  try {
    await ({ settings, species, lists, station, commands }[tab] || settings)($('#tab'));
  } catch (err) {
    $('#tab').innerHTML = `<p class="reading">Something went wrong: ${esc(err.message)}.</p>`;
  }
}

// ---- settings ----------------------------------------------------------------------------
async function settings(box) {
  const s = await admin('/settings');
  const help = (h) => (h ? `<p class="adm-help">${h}</p>` : '');
  const f = (k, label, type = 'text', h = '') => `<div class="adm-field"><label class="adm-lbl" for="${k}">${label}</label><div><input class="adm-in" id="${k}" name="${k}" type="${type}" value="${esc(s[k] ?? '')}">${help(h)}</div></div>`;
  const sel = (k, label, opts, h = '') => `<div class="adm-field"><label class="adm-lbl" for="${k}">${label}</label><div><select class="adm-in" id="${k}" name="${k}">${opts.map(([v, l]) => `<option value="${v}" ${(s[k] ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${help(h)}</div></div>`;
  const chk = (k, label, h = '') => `<div class="adm-field adm-check"><input id="${k}" name="${k}" type="checkbox" ${s[k] === '1' ? 'checked' : ''}><div><label for="${k}">${label}</label>${help(h)}</div></div>`;
  const panel = (title, intro, inner) => `<section class="panel lake-top adm-pad"><h2 class="h2-panel lake">${title}</h2>${intro ? `<p class="adm-help adm-intro">${intro}</p>` : ''}${inner}</section>`;
  box.innerHTML = `<form id="f" class="adm-stack">
    ${panel('Site', 'What visitors see in the header, on the home page and in the footer.', `
      ${f('site_name', 'Site name')}
      ${f('site_tagline', 'Tagline', 'text', 'The subtitle under "This week at the station".')}
      ${f('footer_blurb', 'Footer blurb', 'text', 'Follows the site name in the footer.')}
      ${f('site_url', 'Public address', 'url', 'Used in notification links, for example https://birds.example.com.')}
      ${f('share_image', 'Share image', 'url', 'Thumbnail shown when a link is posted to Facebook, Messages and the like. 1200 x 630 works best.')}`)}
    ${panel('Weather', 'Conditions on the home and Today pages come from a weather station API.', `
      ${f('weather_api_url', 'Weather API address', 'url', 'A Dorrington Weather style API (/api/current.json). Leave empty to hide conditions.')}
      ${f('weather_url', 'Weather site link', 'url')}
      ${f('weather_label', 'Link label')}`)}
    ${panel('Photos and links', '', `
      ${sel('image_provider', 'Bird photos', [['flickr', 'Flickr' + (site?.flickr_enabled === false ? ' (set the FLICKR_API_KEY secret first)' : '')], ['wikipedia', 'Wikipedia'], ['none', 'None']], 'Flickr gives named photographer credits and the three-photo gallery.')}
      ${f('flickr_filter_email', 'Flickr: only photos by', 'email', 'Optional. A Flickr account email.')}
      ${sel('info_site', 'Species info site', [['allaboutbirds', 'All About Birds'], ['ebird', 'eBird']])}
      ${f('language', 'Language code', 'text', 'Used for eBird links.')}`)}
    ${panel('Station', '', `
      ${f('rare_species_threshold', 'Rare species threshold, in days', 'number')}
      ${f('recording_length', 'Recording length, in seconds', 'number', 'Match RECORDING_LENGTH on the Pi.')}
      ${f('stream_url', 'Live stream address', 'url', 'The Pi\'s icecast stream through a Cloudflare Tunnel. Turns on Listen live.')}
      ${chk('public_admin_links', 'Show admin links to everyone')}`)}
    ${panel('Ask the station', 'Needs AI_GATEWAY_URL and the model secrets on the Worker (docs/DEPLOY.md).', `
      ${chk('chat_enabled', 'Turn on Ask the station')}
      ${f('chat_model', 'Model', 'text', 'Default claude-haiku-5-5.')}
      ${f('chat_intro', 'Intro message')}
      ${f('chat_daily_budget', 'Model calls per day, site-wide', 'number')}
      ${f('chat_per_ip_per_hour', 'Questions per visitor per hour', 'number')}
      ${f('chat_per_ip_per_day', 'Questions per visitor per day', 'number')}`)}
    ${panel('Notifications', 'Sent to the NOTIFY_WEBHOOK secret when it is set. The Pi\'s own Apprise notifications are unaffected.', `
      ${f('notify_title', 'Title')}
      ${chk('notify_each_detection', 'Every detection')}
      ${chk('notify_first_of_day', 'First detection of the day for each species')}
      ${chk('notify_new_species', 'Infrequent species (fewer than 5 visits in 7 days)')}
      ${chk('notify_weekly_report', 'Weekly report on Mondays')}
      ${f('notify_min_seconds_per_species', 'Minimum seconds between notifications per species', 'number')}
      ${f('notify_exclude_species', 'Never notify for', 'text', 'Common names, separated by commas.')}
      ${f('notify_only_species', 'Only notify for', 'text', 'Common names, separated by commas. Leave empty for all.')}`)}
    <div class="adm-savebar"><button class="adm-save">Save settings</button><span class="adm-help" id="saved"></span></div>
  </form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    for (const inp of $$('#f [name]')) out[inp.name] = inp.type === 'checkbox' ? (inp.checked ? '1' : '0') : inp.value;
    await admin('/settings', out, 'PUT');
    $('#saved').textContent = `Saved at ${new Date().toTimeString().slice(0, 5)}.`;
    toast('Settings saved');
  };
}

// ---- species -------------------------------------------------------------------------------
async function species(box) {
  const { items } = await call('/api/v1/species/manage');
  const cols = [['com_name', 'Species'], ['count', 'Detections'], ['max_confidence', 'Best'], ['first_seen', 'First heard'], ['last_seen', 'Last heard'], ['files_in_cloud', 'Clips here'], ['files_on_pi', 'On the Pi']];
  box.innerHTML = `<section class="panel lake-top adm-pad">
    <div class="sec-head"><h2 class="h2-panel lake">Species</h2><span class="adm-help" id="count"></span></div>
    <p class="adm-help adm-intro">Confirmed is a note for you. Excluded species are never reported by the Pi. Whitelisted species are reported even below the location and week threshold. Changes sync to the Pi within seconds.</p>
    <input type="search" class="adm-in adm-filter" id="q" placeholder="Filter by common or scientific name" aria-label="Filter species">
    <div class="adm-scroll"><table class="adm-table" id="t"><thead><tr>
      ${cols.map(([k, l]) => `<th data-k="${k}" class="${k === 'com_name' ? '' : 'r'}"><button class="adm-sort">${l}</button></th>`).join('')}
      <th>Confirmed</th><th>Excluded</th><th>Whitelisted</th><th><span class="sr">Delete</span></th>
    </tr></thead><tbody></tbody></table></div></section>`;
  let sortK = 'com_name', asc = true;
  try { sortK = localStorage.getItem('fj-adm-sort') || sortK; asc = localStorage.getItem('fj-adm-asc') !== 'false'; } catch { /* fine */ }
  const render = () => {
    const q = $('#q').value.toLowerCase();
    const rows = items.filter((r) => !q || r.com_name.toLowerCase().includes(q) || r.sci_name.toLowerCase().includes(q))
      .sort((a, b) => (a[sortK] > b[sortK] ? 1 : a[sortK] < b[sortK] ? -1 : 0) * (asc ? 1 : -1));
    $('#count').textContent = `${rows.length} of ${items.length} species`;
    $$('#t th[data-k]').forEach((th) => th.setAttribute('aria-sort', th.dataset.k === sortK ? (asc ? 'ascending' : 'descending') : 'none'));
    const tb = $('#t tbody');
    tb.innerHTML = '';
    for (const r of rows) {
      const tog = (list, on) => `<td class="c"><input type="checkbox" data-list="${list}" ${on ? 'checked' : ''} aria-label="${list} ${esc(r.com_name)}"></td>`;
      const tr = el(`<tr>
        <td><a class="adm-name" href="/species/${slug(r.sci_name)}">${esc(r.com_name)}</a><div class="adm-sci">${esc(r.sci_name)}</div></td>
        <td class="r">${num(r.count)}</td><td class="r">${Math.round(r.max_confidence * 100)}%</td>
        <td class="r nw">${day(r.first_seen)}</td><td class="r nw">${day(r.last_seen)}</td>
        <td class="r">${num(r.files_in_cloud)}</td><td class="r">${num(r.files_on_pi)}${r.locked ? `<div class="adm-sci">${r.locked} kept</div>` : ''}</td>
        ${tog('confirmed', r.confirmed)}${tog('exclude', r.excluded)}${tog('whitelist', r.whitelisted)}
        <td class="c"><button class="adm-del" aria-label="Delete all detections of ${esc(r.com_name)}">Delete</button></td></tr>`);
      for (const c of $$('input[type=checkbox]', tr)) c.onchange = async () => {
        c.disabled = true;
        try {
          await admin(`/lists/${c.dataset.list}`, { action: c.checked ? 'add' : 'del', sci_name: r.sci_name, com_name: r.com_name });
          r[{ confirmed: 'confirmed', exclude: 'excluded', whitelist: 'whitelisted' }[c.dataset.list]] = c.checked ? 1 : 0;
          toast(`${r.com_name}: ${c.dataset.list} ${c.checked ? 'on' : 'off'}`);
        } catch (err) { c.checked = !c.checked; toast(`Not saved: ${err.message}`); }
        c.disabled = false;
      };
      $('.adm-del', tr).onclick = async () => {
        const ok = await confirmTyped({
          title: `Delete ${r.com_name}`,
          body: `This deletes all ${num(r.count)} detections of ${esc(r.com_name)}, with their audio and spectrograms, here and on the Pi. It cannot be undone.`,
          phrase: r.com_name, action: 'Delete everything',
        });
        if (!ok) return;
        await admin(`/species/${encodeURIComponent(r.sci_name)}/delete`);
        toast('Delete queued for the Pi. The rows go when it confirms.');
      };
      tb.append(tr);
    }
  };
  $('#q').oninput = render;
  $$('#t .adm-sort').forEach((b) => (b.onclick = () => {
    const k = b.closest('th').dataset.k;
    if (sortK === k) asc = !asc; else { sortK = k; asc = k === 'com_name'; }
    try { localStorage.setItem('fj-adm-sort', sortK); localStorage.setItem('fj-adm-asc', asc); } catch { /* fine */ }
    render();
  }));
  render();
}

// ---- species lists ---------------------------------------------------------------------------
async function lists(box) {
  const [{ items: labels }, cur] = await Promise.all([call('/api/v1/labels'), call('/api/v1/lists')]);
  const info = {
    include: 'If this list has any species, the Pi recognizes only those. Keep it empty unless that is what you want.',
    exclude: 'Species the Pi never reports.',
    whitelist: 'Species reported even below the occurrence threshold for this location and week. Use sparingly.',
    confirmed: 'Species you have confirmed by ear or by eye. A note for you; it changes nothing.',
  };
  const names = { include: 'Include', exclude: 'Exclude', whitelist: 'Whitelist', confirmed: 'Confirmed' };
  let list = 'include';
  box.innerHTML = `<section class="panel lake-top adm-pad">
    <h2 class="h2-panel lake">Species lists</h2>
    <p class="adm-help adm-intro">Saved here and copied to the Pi's list files within seconds.</p>
    <div class="adm-chips" role="tablist">${Object.keys(info).map((k) => `<button role="tab" data-list="${k}">${names[k]}</button>`).join('')}</div>
    <p class="reading adm-info" id="info"></p>
    <div class="adm-lists">
      <div><div class="sec-head"><h3 class="adm-h3">All species</h3><span class="adm-help" id="nall"></span></div>
        <input type="search" class="adm-in" id="lq" placeholder="Search species" aria-label="Search species">
        <select class="adm-in adm-multi" id="all" multiple size="16" aria-label="All species"></select>
        <div class="adm-actions"><button class="pill-outline" id="add">Add to list</button></div></div>
      <div><div class="sec-head"><h3 class="adm-h3" id="lt"></h3></div>
        <select class="adm-in adm-multi" id="have" multiple size="18" aria-label="On this list"></select>
        <div class="adm-actions"><button class="pill-neutral" id="del">Remove from list</button></div></div>
    </div></section>`;
  const opt = (l) => `<option value="${esc(l.sci_name)}|${esc(l.com_name)}">${esc(l.com_name)}, ${esc(l.sci_name)}</option>`;
  const render = () => {
    $('#info').textContent = info[list];
    $('#lt').textContent = `${names[list]} list, ${cur[list].length} species`;
    $$('.adm-chips button').forEach((b) => { b.classList.toggle('on', b.dataset.list === list); b.setAttribute('aria-selected', b.dataset.list === list); });
    const q = $('#lq').value.toLowerCase();
    const have = new Set(cur[list].map((x) => x.sci_name));
    const avail = labels.filter((l) => !have.has(l.sci_name) && (!q || l.com_name.toLowerCase().includes(q) || l.sci_name.toLowerCase().includes(q)));
    $('#nall').textContent = `${num(avail.length)} shown`;
    $('#all').innerHTML = avail.slice(0, 2000).map(opt).join('');
    $('#have').innerHTML = cur[list].map(opt).join('');
  };
  $('.adm-chips').onclick = (e) => { const b = e.target.closest('button'); if (b) { list = b.dataset.list; render(); } };
  $('#lq').oninput = render;
  const apply = async (sel, action) => {
    const opts = [...$(sel).selectedOptions];
    if (!opts.length) return toast('Choose species first');
    let r;
    for (const o of opts) { const [sci, com] = o.value.split('|'); r = await admin(`/lists/${list}`, { action, sci_name: sci, com_name: com }); }
    Object.assign(cur, r.lists);
    render();
    toast(`${opts.length} updated, copying to the Pi`);
  };
  $('#add').onclick = () => apply('#all', 'add');
  $('#del').onclick = () => apply('#have', 'del');
  render();
}

function localTime(iso, tz) {
  if (!iso) return 'never';
  try { return new Date(iso).toLocaleString('en-US', { timeZone: tz || undefined, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); } catch { return iso; }
}

// ---- station -----------------------------------------------------------------------------------
async function station(box) {
  const { station: st = {} } = await call('/api/v1/site');
  const cfg = st?.config || {};
  const fact = (k, v) => `<div class="fact"><span>${k}</span><span class="v">${v}</span></div>`;
  const services = ['birdnet_analysis', 'birdnet_recording', 'chart_viewer', 'spectrogram_viewer', 'livestream', 'birdnet_cloud_agent'];
  const cfgNames = { MODEL: 'Model', SF_THRESH: 'Species occurrence threshold', CONFIDENCE: 'Confidence', SENSITIVITY: 'Sensitivity', OVERLAP: 'Overlap', RECORDING_LENGTH: 'Recording length', EXTRACTION_LENGTH: 'Extraction length', AUDIOFMT: 'Audio format', DATABASE_LANG: 'Language', PRIVACY_THRESHOLD: 'Privacy threshold', FULL_DISK: 'When the disk is full', PURGE_THRESHOLD: 'Purge threshold', MAX_FILES_SPECIES: 'Files kept per species', RARE_SPECIES_THRESHOLD: 'Rare species threshold', CHANNELS: 'Channels', REC_CARD: 'Sound card' };
  box.innerHTML = `<div class="adm-two">
    <section class="panel lake-top adm-pad">
      <h2 class="h2-panel lake">Collector</h2>
      <p class="adm-status"><span class="adm-dot ${st?.online ? 'up' : ''}"></span><span>${st?.online ? 'Reporting' : 'Not reporting'}<span class="muted">, last upload ${esc(localTime(st?.last_seen_at, st?.timezone))}</span></span></p>
      <div class="adm-facts">
        ${fact('Time zone', esc(st?.timezone || ''))}
        ${fact('Analyzing now', esc(st?.analyzing_now || 'Nothing'))}
        ${fact('Waiting to analyze', `${num(st?.backlog_files)} ${Number(st?.backlog_files) === 1 ? 'file' : 'files'}`)}
        ${fact('Disk used', `${st?.disk_used_pct ?? ''}%`)}
        ${fact('BirdNET-Pi version', esc(st?.pi_version || ''))}
        ${fact('Agent version', esc(st?.agent_version || ''))}
        ${fact('BirdWeather uploads', cfg.BIRDWEATHER_ENABLED === '1' ? 'On, sent by the Pi' : 'Off')}
      </div>
      <h3 class="adm-h3 adm-gap">Analysis settings on the Pi</h3>
      <div class="adm-facts">${Object.entries(cfg).filter(([k]) => cfgNames[k]).map(([k, v]) => fact(cfgNames[k], esc(v || ''))).join('')}</div>
      <p class="adm-help">These live in birdnet.conf on the Pi. This page shows what the Pi reports; change them on the Pi's own Settings page.</p>
    </section>
    <section class="panel lake-top adm-pad">
      <h2 class="h2-panel lake">Services on the Pi</h2>
      <p class="adm-help adm-intro">Each button queues a command for the agent, which runs it with systemctl.</p>
      <div class="adm-services">${services.map((s) => `<div class="adm-svc"><span>${s}</span><span class="adm-svc-b">
        <button class="pill-neutral" data-s="${s}" data-k="restart_service">Restart</button>
        <button class="pill-neutral" data-s="${s}" data-k="stop_service">Stop</button>
        <button class="pill-neutral" data-s="${s}" data-k="start_service">Start</button></span></div>`).join('')}</div>
      <h3 class="adm-h3 adm-gap">Maintenance</h3>
      <div class="adm-actions adm-wrap">
        <button class="pill-outline" data-k="sync_lists">Copy species lists to the Pi</button>
        <button class="pill-outline" data-k="run" data-n="disk_species_count">Disk use by species</button>
        <button class="pill-outline" data-k="resync" data-confirm="1">Re-send everything from the Pi</button>
      </div>
      <pre class="adm-out hidden" id="out"></pre>
    </section></div>`;
  box.onclick = async (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    if (b.dataset.k === 'stop_service' || b.dataset.confirm) {
      const label = b.dataset.k === 'stop_service' ? `Stop ${b.dataset.s}` : b.textContent.trim();
      const ok = await confirmTyped({
        title: label,
        body: b.dataset.k === 'stop_service'
          ? `This stops ${esc(b.dataset.s)} on the Pi until someone starts it again.`
          : 'The Pi sends its whole history again: every row, then every clip. It takes hours and uses upload bandwidth.',
        phrase: b.dataset.k === 'stop_service' ? 'stop' : 'resend', action: label,
      });
      if (!ok) return;
    }
    const r = await admin('/commands', { kind: b.dataset.k, service: b.dataset.s, name: b.dataset.n });
    toast(`Queued command ${r.queued}`);
    if (b.dataset.k === 'run') pollResult(r.queued);
  };
  async function pollResult(id) {
    const out = $('#out'); out.classList.remove('hidden'); out.textContent = 'Waiting for the Pi';
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { items } = await admin('/commands');
      const c = items.find((x) => x.id === id);
      if (c && c.status !== 'pending' && c.status !== 'taken') { const res = JSON.parse(c.result || 'null'); out.textContent = res?.out ?? JSON.stringify(res, null, 2); return; }
    }
    out.textContent = 'No answer yet. Check the command log.';
  }
}

// ---- command log --------------------------------------------------------------------------------
async function commands(box) {
  const { items } = await admin('/commands');
  const when = (t) => (t ? esc(String(t).replace('T', ' ').slice(0, 16)) : '');
  box.innerHTML = `<section class="panel lake-top adm-pad">
    <div class="sec-head"><h2 class="h2-panel lake">Command log</h2><span class="adm-help">${items.length ? `${items.length} most recent, times in UTC` : ''}</span></div>
    ${items.length ? `<div class="adm-scroll"><table class="adm-table"><thead><tr><th class="r">#</th><th>Command</th><th>Status</th><th>Queued</th><th>Finished</th><th>Result</th></tr></thead><tbody>
      ${items.map((c) => `<tr><td class="r">${c.id}</td><td>${esc(c.kind)}<div class="adm-sci">${esc(c.payload || '').slice(0, 120)}</div></td>
        <td><span class="adm-state ${esc(c.status)}">${esc(c.status)}</span></td><td>${when(c.created_at)}</td><td>${when(c.finished_at)}</td>
        <td><code class="adm-code">${esc(c.result || '').slice(0, 200)}</code></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="reading">No commands have been sent to the Pi yet.</p>'}
  </section>`;
}
