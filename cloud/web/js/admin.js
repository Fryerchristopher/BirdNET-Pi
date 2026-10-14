/*
 * Admin (the Pi's Tools): settings, species management, species lists,
 * station services, command log. Mutations go through /api/v1/admin and
 * need either Cloudflare Access on this path or a token (ADMIN_AUTH=token).
 */
import { renderShell, api, adminApi, adminToken, el, esc, $, $$, toast, pct, bestUrl, recordingsUrl, miniGraph } from './app.js';

const site = await renderShell('Admin');
const main = $('#main');
const tab = new URLSearchParams(location.search).get('tab') || 'settings';

async function ensureAdmin() {
  try { await adminApi('/api/v1/admin/me', undefined, 'GET'); return true; } catch { return false; }
}

if (!(await ensureAdmin())) {
  main.innerHTML = `<div class="card" style="max-width:480px;margin:2rem auto"><h2>Admin login</h2>
    <p class="help">Enter the ADMIN_TOKEN secret set on the Worker. With Cloudflare Access in front of /admin this box never appears.</p>
    <form class="stack"><input type="password" id="tok" placeholder="Admin token" style="width:100%"><button class="primary">Sign in</button></form></div>`;
  main.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    adminToken.set($('#tok').value.trim());
    if (await ensureAdmin()) location.reload(); else { adminToken.set(''); toast('That token was not accepted'); }
  };
} else {
  main.innerHTML = `<div class="sort-bar">${[['settings', 'Settings'], ['species', 'Species management'], ['lists', 'Species lists'], ['station', 'Station'], ['commands', 'Command log']].map(([k, l]) => `<a href="?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}<a href="#" id="logout" style="margin-left:auto">Sign out</a></div><div id="tab"></div>`;
  $('#logout').onclick = () => { adminToken.set(''); location.reload(); };
  await ({ settings, species, lists, station, commands }[tab] || settings)();
}

// ---- settings ----------------------------------------------------------------
async function settings() {
  const s = await adminApi('/api/v1/admin/settings', undefined, 'GET');
  const f = (k, label, type = 'text', help = '', extra = '') => `<label for="${k}">${label}</label><div><input id="${k}" name="${k}" type="${type}" value="${esc(s[k] ?? '')}" ${extra}>${help ? `<div class="help">${help}</div>` : ''}</div>`;
  const sel = (k, label, opts, help = '') => `<label for="${k}">${label}</label><div><select id="${k}" name="${k}">${opts.map(([v, l]) => `<option value="${v}" ${s[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${help ? `<div class="help">${help}</div>` : ''}</div>`;
  const chk = (k, label, help = '') => `<label for="${k}">${label}</label><div><input id="${k}" name="${k}" type="checkbox" ${s[k] === '1' ? 'checked' : ''}>${help ? `<span class="help"> ${help}</span>` : ''}</div>`;
  $('#tab').innerHTML = `<form id="f" class="stack">
    <div class="card"><h2>Site</h2><div class="form-grid">
      ${f('site_name', 'Site name')}
      ${f('site_url', 'Public URL', 'url', 'Used in notification links, e.g. https://birds.example.com')}
      ${sel('theme', 'Theme', [['default', 'default (BirdNET-Pi classic)'], ['forest-night', 'forest-night (dark)']], 'Themes are CSS files in web/css/themes. Preview any page with ?theme=name. See docs/THEMING.md to add your own.')}
      ${sel('image_provider', 'Bird photo source', [['none', 'None'], ['wikipedia', 'Wikipedia'], ['flickr', 'Flickr' + (site.flickr_enabled ? '' : ' (set FLICKR_API_KEY secret first)')]])}
      ${f('flickr_filter_email', 'Flickr: only photos by (email)', 'email')}
      ${sel('info_site', 'Species info site', [['allaboutbirds', 'All About Birds'], ['ebird', 'eBird']])}
      ${f('language', 'Language code', 'text', 'Used for eBird links')}
      ${f('rare_species_threshold', 'Rare species threshold (days)', 'number')}
      ${f('recording_length', 'Recording length (seconds)', 'number', 'Drives the refresh timers; match RECORDING_LENGTH on the Pi')}
      ${f('stream_url', 'Live stream URL', 'url', 'Public URL of the Pi\'s icecast stream (through a Cloudflare Tunnel). Enables Live audio and the live Spectrogram.')}
      ${chk('public_admin_links', 'Show the Admin link to everyone')}
    </div></div>
    <div class="card"><h2>Ask BirdNET-Pi</h2><div class="form-grid">
      ${chk('chat_enabled', 'Enable', 'Needs AI_GATEWAY_URL and the model secrets on the Worker (docs/DEPLOY.md)')}
      ${f('chat_model', 'Model', 'text', 'Default claude-haiku-5-5')}
      ${f('chat_intro', 'Intro message')}
      ${f('chat_daily_budget', 'Model calls per day (site-wide cap)', 'number')}
      ${f('chat_per_ip_per_hour', 'Questions per visitor per hour', 'number')}
      ${f('chat_per_ip_per_day', 'Questions per visitor per day', 'number')}
    </div></div>
    <div class="card"><h2>Notifications (webhook)</h2><p class="help">Only when the NOTIFY_WEBHOOK secret is set. The Pi's own Apprise notifications are unaffected.</p><div class="form-grid">
      ${f('notify_title', 'Title')}
      ${chk('notify_each_detection', 'Notify each detection')}
      ${chk('notify_first_of_day', 'Notify first detection of the day per species')}
      ${chk('notify_new_species', 'Notify infrequent species (fewer than 5 visits in 7 days)')}
      ${chk('notify_weekly_report', 'Send the weekly report (Mondays)')}
      ${f('notify_min_seconds_per_species', 'Minimum seconds between notifications per species', 'number')}
      ${f('notify_exclude_species', 'Exclude these species (comma separated common names)')}
      ${f('notify_only_species', 'ONLY notify for these species')}
    </div></div>
    <div class="row"><button class="primary">Save settings</button></div></form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    for (const inp of $$('#f [name]')) out[inp.name] = inp.type === 'checkbox' ? (inp.checked ? '1' : '0') : inp.value;
    await adminApi('/api/v1/admin/settings', out, 'PUT');
    toast('Settings saved');
  };
}

// ---- species management ---------------------------------------------------------
async function species() {
  const { items } = await api('/api/v1/species/manage');
  const box = $('#tab');
  box.innerHTML = `<div class="card"><div class="row between"><input type="search" id="q" placeholder="Filter species (name, scientific)"><span class="muted" id="count"></span></div>
    <table class="sortable" id="t"><thead><tr><th data-k="com_name">Common name</th><th data-k="sci_name">Scientific</th><th></th><th data-k="count">Count</th><th data-k="max_confidence">Max conf.</th><th data-k="first_seen">First</th><th data-k="last_seen">Last seen</th><th data-k="files_in_cloud">Clips (cloud)</th><th data-k="files_on_pi">On Pi</th><th>Confirmed</th><th>Excluded</th><th>Whitelisted</th><th></th></tr></thead><tbody></tbody></table></div>`;
  let sortK = localStorage.getItem('speciesSortCol') || 'com_name', asc = localStorage.getItem('speciesSortAsc') !== 'false';
  const render = () => {
    const q = $('#q').value.toLowerCase();
    const rows = items.filter((r) => !q || r.com_name.toLowerCase().includes(q) || r.sci_name.toLowerCase().includes(q))
      .sort((a, b) => (a[sortK] > b[sortK] ? 1 : a[sortK] < b[sortK] ? -1 : 0) * (asc ? 1 : -1));
    $('#count').textContent = `${rows.length} / ${items.length}`;
    const tb = $('#t tbody');
    tb.innerHTML = '';
    for (const r of rows) {
      const tr = el(`<tr data-sci="${esc(r.sci_name)}"><td><a href="${recordingsUrl(r.sci_name)}">${esc(r.com_name)}</a></td><td><i><a href="${bestUrl(r.sci_name)}">${esc(r.sci_name)}</a></i></td><td><button class="ghost graph" title="Trend">&#9641;</button></td>
        <td>${r.count}</td><td>${(r.max_confidence * 100).toFixed(1)}%</td><td>${r.first_seen}</td><td>${r.last_seen}</td><td>${r.files_in_cloud}</td><td>${r.files_on_pi}${r.locked ? ` <span class="pill" title="locked">${r.locked} locked</span>` : ''}</td>
        <td><button class="ghost tog" data-list="confirmed" data-on="${r.confirmed ? 1 : 0}">${r.confirmed ? '&#10004;' : '&#9675;'}</button></td>
        <td><button class="ghost tog" data-list="exclude" data-on="${r.excluded ? 1 : 0}">${r.excluded ? '&#10004;' : '&#9675;'}</button></td>
        <td><button class="ghost tog" data-list="whitelist" data-on="${r.whitelisted ? 1 : 0}">${r.whitelisted ? '&#10004;' : '&#9675;'}</button></td>
        <td><button class="ghost del" title="Delete all detections and files">&#10006;</button></td></tr>`);
      tr.querySelector('.graph').onclick = (e) => miniGraph(e.currentTarget, r.sci_name, r.com_name);
      tr.querySelector('.del').onclick = async () => {
        if (!confirm(`Delete ${r.count} detections and all audio and spectrograms for ${r.com_name}? This cannot be undone.`)) return;
        await adminApi(`/api/v1/admin/species/${encodeURIComponent(r.sci_name)}/delete`);
        toast('Delete queued for the Pi; the rows disappear when it confirms');
      };
      for (const b of tr.querySelectorAll('.tog')) b.onclick = async () => {
        await adminApi(`/api/v1/admin/lists/${b.dataset.list}`, { action: b.dataset.on === '1' ? 'del' : 'add', sci_name: r.sci_name, com_name: r.com_name });
        location.reload();
      };
      tb.append(tr);
    }
  };
  $('#q').oninput = render;
  $$('#t th[data-k]').forEach((th) => (th.onclick = () => { if (sortK === th.dataset.k) asc = !asc; else { sortK = th.dataset.k; asc = true; } localStorage.setItem('speciesSortCol', sortK); localStorage.setItem('speciesSortAsc', asc); render(); }));
  render();
}

// ---- species lists ------------------------------------------------------------------
async function lists() {
  const [{ items: labels }, cur] = await Promise.all([api('/api/v1/labels'), api('/api/v1/lists')]);
  const box = $('#tab');
  const info = {
    include: 'Warning: if this list contains ANY species, the Pi will ONLY recognize those species. Keep it empty unless you only want specific species.',
    exclude: 'Species the Pi should never report.',
    whitelist: 'Species detected even when they fall below the occurrence threshold for your location and week. Use sparingly.',
    confirmed: 'Species you have confirmed by ear or eye. Informational.',
  };
  box.innerHTML = `<div class="card"><p class="help">Changes are saved here and synced to the Pi's text files within seconds (sync_lists command).</p>
    <div class="row" id="which">${Object.keys(info).map((k, i) => `<a href="#" class="btn ${i === 0 ? 'primary' : ''}" data-list="${k}">${k}</a>`).join('')}</div>
    <p class="help" id="info"></p>
    <div class="grid cols-2"><div><h3>All species labels</h3><input type="search" id="lq" placeholder="Search" style="width:100%"><select id="all" multiple size="20" style="width:100%"></select><button id="add" class="primary" style="margin-top:.4rem">Add &raquo;</button></div>
    <div><h3 id="lt"></h3><select id="have" multiple size="20" style="width:100%"></select><button id="del" style="margin-top:.4rem">&laquo; Remove</button></div></div></div>`;
  let list = 'include';
  const render = () => {
    $('#info').textContent = info[list];
    $('#lt').textContent = `${list} list (${cur[list].length})`;
    $$('#which a').forEach((a) => a.classList.toggle('primary', a.dataset.list === list));
    const q = $('#lq').value.toLowerCase();
    const have = new Set(cur[list].map((x) => x.sci_name));
    $('#all').innerHTML = labels.filter((l) => !have.has(l.sci_name) && (!q || l.com_name.toLowerCase().includes(q) || l.sci_name.toLowerCase().includes(q))).slice(0, 2000).map((l) => `<option value="${esc(l.sci_name)}|${esc(l.com_name)}">${esc(l.com_name)} (${esc(l.sci_name)})</option>`).join('');
    $('#have').innerHTML = cur[list].map((l) => `<option value="${esc(l.sci_name)}|${esc(l.com_name)}">${esc(l.com_name)} (${esc(l.sci_name)})</option>`).join('');
  };
  $('#which').onclick = (e) => { const a = e.target.closest('a'); if (a) { e.preventDefault(); list = a.dataset.list; render(); } };
  $('#lq').oninput = render;
  const apply = async (sel, action) => {
    const opts = [...$(sel).selectedOptions];
    if (!opts.length) return toast('Select species first');
    let r;
    for (const o of opts) { const [sci, com] = o.value.split('|'); r = await adminApi(`/api/v1/admin/lists/${list}`, { action, sci_name: sci, com_name: com }); }
    Object.assign(cur, r.lists);
    render();
    toast(`${opts.length} updated; syncing to the Pi`);
  };
  $('#add').onclick = () => apply('#all', 'add');
  $('#del').onclick = () => apply('#have', 'del');
  render();
}

// ---- station ----------------------------------------------------------------------------
async function station() {
  const st = site.station || {};
  const cfg = st.config || {};
  $('#tab').innerHTML = `<div class="grid cols-2">
    <div class="card"><h2>Station</h2><table>
      <tr><th>Status</th><td>${st.online ? '<span class="up">online</span>' : '<span class="down">offline</span>'} (last push ${esc(st.last_seen_at || 'never')})</td></tr>
      <tr><th>Time zone</th><td>${esc(st.timezone)}</td></tr><tr><th>Location</th><td>${st.lat ?? ''}, ${st.lon ?? ''}</td></tr>
      <tr><th>Analyzing now</th><td>${esc(st.analyzing_now || '')}</td></tr><tr><th>Backlog</th><td>${st.backlog_files ?? ''} files in StreamData</td></tr>
      <tr><th>Disk used</th><td>${st.disk_used_pct ?? ''}%</td></tr><tr><th>BirdNET-Pi</th><td>${esc(st.pi_version || '')}</td></tr><tr><th>Agent</th><td>${esc(st.agent_version || '')}</td></tr>
      ${Object.entries(cfg).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      <p class="help">Analysis settings (confidence, sensitivity, overlap, model, privacy, disk purge) still live in birdnet.conf on the Pi; this page shows what the Pi reports.</p></div>
    <div class="card"><h2>Services on the Pi</h2><p class="help">Each button queues a command the agent runs with systemctl.</p>
      <table>${['birdnet_analysis', 'birdnet_recording', 'chart_viewer', 'spectrogram_viewer', 'livestream', 'birdnet_cloud_agent'].map((s) => `<tr><th>${s}</th><td class="row"><button data-s="${s}" data-k="restart_service">Restart</button><button data-s="${s}" data-k="stop_service">Stop</button><button data-s="${s}" data-k="start_service">Start</button></td></tr>`).join('')}</table>
      <h3 style="margin-top:1rem">Maintenance</h3><div class="row"><button data-k="sync_lists">Re-sync species lists to the Pi</button><button data-k="resync">Re-push everything from the Pi</button><button data-k="run" data-n="disk_species_count">Disk usage by species</button></div>
      <pre id="out" hidden></pre></div></div>`;
  $('#tab').onclick = async (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const r = await adminApi('/api/v1/admin/commands', { kind: b.dataset.k, service: b.dataset.s, name: b.dataset.n });
    toast(`Queued command #${r.queued}`);
    if (b.dataset.k === 'run') pollResult(r.queued);
  };
  async function pollResult(id) {
    const out = $('#out'); out.hidden = false; out.textContent = 'Waiting for the Pi...';
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { items } = await adminApi('/api/v1/admin/commands', undefined, 'GET');
      const c = items.find((x) => x.id === id);
      if (c && c.status !== 'pending' && c.status !== 'taken') { const res = JSON.parse(c.result || 'null'); out.textContent = res?.out ?? JSON.stringify(res, null, 2); return; }
    }
    out.textContent = 'No answer yet; check the command log.';
  }
}

async function commands() {
  const { items } = await adminApi('/api/v1/admin/commands', undefined, 'GET');
  $('#tab').innerHTML = `<div class="card"><table><thead><tr><th>#</th><th>Kind</th><th>Payload</th><th>Status</th><th>Created</th><th>Finished</th><th>Result</th></tr></thead><tbody>
    ${items.map((c) => `<tr><td>${c.id}</td><td>${esc(c.kind)}</td><td><code>${esc(c.payload).slice(0, 120)}</code></td><td class="${c.status === 'failed' ? 'down' : c.status === 'done' ? 'up' : ''}">${c.status}</td><td>${esc(c.created_at)}</td><td>${esc(c.finished_at || '')}</td><td><code>${esc(c.result || '').slice(0, 160)}</code></td></tr>`).join('')}</tbody></table></div>`;
}
