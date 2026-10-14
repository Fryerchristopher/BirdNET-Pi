import { api, site, el, esc, $, $$, hhmm, pct, plural, longDate, fmtDate, spectrogram, playButton, openRecording, emptyToday } from '../app.js';

const p2 = (n) => String(n).padStart(2, '0');

export async function render(main, { arg: date }) {
  const isDay = !!date;
  main.innerHTML = `<h1 class="h1">${isDay ? esc(longDate(date)) : 'Today'}</h1><p class="today-lede muted">Loading</p>`;
  const d = await api(`/api/v1/journal/day/${date || 'today'}`);
  const st = d.stats, sun = d.sun, c = d.comparison, w = d.conditions;
  const sunriseH = sun.sunrise ? Number(sun.sunrise.slice(0, 2)) : 6, sunsetH = sun.sunset ? Number(sun.sunset.slice(0, 2)) : 19;
  const nowH = d.now_hour;
  const maxTotal = Math.max(1, ...d.species.map((s) => s.total));
  const lede = st.detections
    ? `${plural(st.detections, 'detection')} of ${plural(st.species, 'species', 'species')}${d.is_today ? ' so far today' : ''}. The first was at ${hhmm(st.first_time)}${d.is_today ? '' : `, the last at ${hhmm(st.latest_time)}`}.`
    : d.is_today ? emptyToday(sun) : 'No birds were heard on this day.';

  main.innerHTML = `
    <h1 class="h1">${isDay ? esc(longDate(date)) : 'Today'}</h1>
    <p class="today-lede">${esc(lede)}</p>
    ${isDay ? `<div class="daynav"><a class="pill-neutral" href="/day/${d.prev}">Previous day</a>${d.next ? `<a class="pill-neutral" href="${d.next === site?.today ? '/today' : '/day/' + d.next}">Next day</a>` : ''}<a class="pill-neutral" href="/archive/${date.slice(0, 7)}">Archive</a></div>` : ''}
    <div class="today-stack">
      <section class="cond-grid">
        <div class="panel lake-top">
          <div class="top"><h2 class="serif">Conditions at the station</h2>${site?.weather_url ? `<a href="${esc(site.weather_url)}">${esc(site.weather_label || 'Weather')}</a>` : ''}</div>
          <div class="figs">
            <div><div class="v">${w?.temp_f != null ? w.temp_f + '°F' : '&ndash;'}</div><div class="l">Temperature</div></div>
            <div><div class="v">${w ? esc(capFirst(w.wind_text)) : '&ndash;'}</div><div class="l">Wind</div></div>
            <div><div class="v">${w ? (w.rain_today_in ? w.rain_today_in.toFixed(2) + ' in' : 'None') : '&ndash;'}</div><div class="l">Rain today</div></div>
            <div><div class="v">${sun.sunrise ?? '&ndash;'}</div><div class="l">Sunrise</div></div>
            <div><div class="v">${sun.sunset ?? '&ndash;'}</div><div class="l">Sunset</div></div>
          </div>
          ${!w ? `<div class="note">${d.is_today ? 'No weather station is linked.' : 'Past conditions are not kept here.'}</div>` : w.stale ? '<div class="note">The weather station has not reported recently.</div>' : ''}
        </div>
        <div class="panel lake-top">
          <h2 class="serif">Compared with other days</h2>
          <div class="cmp"><span class="a">${esc(c.yesterday_label.replace('yesterday', isDay ? 'the day before' : 'yesterday'))}</span><span class="b">${esc(c.yesterday_detail)}</span></div>
          ${c.typical_label ? `<div class="cmp"><span class="a">${esc(c.typical_label)}</span><span class="b">${esc(c.typical_detail)}</span></div>` : '<div class="note">A typical range appears once the station has a year of history for these dates.</div>'}
        </div>
      </section>

      <section class="dotgrid panel conifer-top">
        <div class="sec-head"><h2 class="h2">Who sang when</h2>
          <div class="legend"><span><i style="width:8px;height:8px"></i><i style="width:14px;height:14px"></i><i style="width:22px;height:22px"></i>Dot size is calls in that hour</span><span><i class="night"></i>Night</span>${sun.sunrise ? `<span><i class="sunl"></i>Sunrise ${sun.sunrise}, sunset ${sun.sunset}</span>` : ''}</div></div>
        <div class="hint">Hover a dot for the count. Click it to hear those calls.</div>
        <div class="dg-scroll"><div class="dg">
          ${sun.sunrise_frac != null ? `<div class="sun" style="left:calc(var(--dg-name) + (100% - var(--dg-fixed)) * ${sun.sunrise_frac})"></div><div class="sun" style="left:calc(var(--dg-name) + (100% - var(--dg-fixed)) * ${sun.sunset_frac})"></div>` : ''}
          <div class="hrow"><span></span>${[...Array(24).keys()].map((h) => `<span class="${h === nowH ? 'now' : ''}">${p2(h)}</span>`).join('')}<span class="end">${d.is_today ? 'Today' : 'Day'}</span></div>
          <div class="rows"></div>
        </div></div>
        <div class="dg-sel hidden"></div>
      </section>

      <section class="hbh"><h2 class="h2">Hour by hour</h2><div class="hrows"></div></section>
    </div>`;

  // dot grid rows
  const rows = $('.dg .rows', main);
  const hint = $('.hint', main);
  const defaultHint = 'Hover a dot for the count. Click it to hear those calls.';
  for (const s of d.species) {
    const row = el(`<div class="row"><div class="nm"><a href="/species/${s.slug}">${esc(s.com_name)}</a></div></div>`);
    s.hours.forEach((n, h) => {
      const night = h < sunriseH || h > sunsetH;
      const past = !d.is_today || h <= nowH;
      const size = n ? Math.round(7 + Math.sqrt(n / d.max_cell) * 20) : past ? 3 : 0;
      const title = n ? `${s.com_name}, ${p2(h)}:00 to ${p2(h + 1)}:00, ${plural(n, 'call')}` : '';
      const cell = el(`<button class="cell ${night ? 'night' : ''} ${n ? 'has' : ''}" ${title ? `title="${esc(title)}" aria-label="${esc(title)}"` : 'tabindex="-1" aria-hidden="true"'}><i style="width:${size}px;height:${size}px"></i></button>`);
      if (n) {
        cell.onmouseenter = () => (hint.textContent = title);
        cell.onmouseleave = () => (hint.textContent = defaultHint);
        cell.onclick = () => selectCell(cell, s, h, n);
      }
      row.append(cell);
    });
    row.append(el(`<div class="tot"><div class="bar"><div style="width:${(s.total / maxTotal) * 100}%"></div></div><b>${s.total}</b></div>`));
    rows.append(row);
  }
  if (!d.species.length) rows.append(el(`<p class="muted" style="padding:12px 0">${d.is_today ? 'Nothing yet. The grid fills in as the day goes on.' : 'Nothing was heard on this day.'}</p>`));
  // auto-scroll so the first active hours are in view
  const sc = $('.dg-scroll', main);
  requestAnimationFrame(() => { if (sc.scrollWidth > sc.clientWidth) { const firstH = Math.min(...d.species.flatMap((s) => s.hours.map((n, h) => (n ? h : 99))), 5); const colW = (sc.scrollWidth - (window.innerWidth < 760 ? 220 : 350)) / 24; sc.scrollLeft = Math.max(0, colW * Math.max(0, firstH - 1)); } });

  const selBox = $('.dg-sel', main);
  let selected = null;
  async function selectCell(cell, s, h, n) {
    if (selected === cell) { selected.classList.remove('sel'); selected = null; selBox.classList.add('hidden'); return; }
    selected?.classList.remove('sel');
    selected = cell; cell.classList.add('sel');
    selBox.classList.remove('hidden');
    selBox.innerHTML = `<div class="top"><div><span class="n">${esc(s.com_name)}</span> <span class="muted">${p2(h)}:00 to ${p2(h + 1)}:00, ${plural(n, 'call')}</span></div><button class="pill-neutral">Close</button></div><div class="clips"><p class="muted">Loading</p></div>`;
    $('button', selBox).onclick = () => { selected?.classList.remove('sel'); selected = null; selBox.classList.add('hidden'); };
    const r = await api(`/api/v1/journal/clips?date=${d.date}&sci=${encodeURIComponent(s.sci_name)}&hour=${h}&limit=12`);
    fillClips($('.clips', selBox), r.items);
    selBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // hour by hour, newest first
  const hb = $('.hrows', main);
  const hoursWithData = [...Array(24).keys()].filter((h) => d.species.some((s) => s.hours[h])).reverse();
  for (const h of hoursWithData) {
    const chips = d.species.map((s) => [s, s.hours[h]]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
    const row = el(`<div class="hrow2"><div class="lbl">${p2(h)}:00</div><div class="chips">${chips.map(([s, n]) => `<button class="chip" data-sci="${esc(s.sci_name)}" data-name="${esc(s.com_name)}">${esc(s.com_name)} <strong>${n}</strong></button>`).join('')}</div></div>`);
    row.onclick = async (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      let box = $('.chip-clips', row);
      if (chip.classList.contains('open')) { chip.classList.remove('open'); box?.remove(); return; }
      $$('.chip.open', row).forEach((x) => x.classList.remove('open'));
      chip.classList.add('open');
      if (!box) { box = el('<div class="chip-clips"><div class="clips"></div></div>'); row.append(box); }
      $('.clips', box).innerHTML = '<p class="muted">Loading</p>';
      const r = await api(`/api/v1/journal/clips?date=${d.date}&sci=${encodeURIComponent(chip.dataset.sci)}&hour=${h}&limit=12`);
      fillClips($('.clips', box), r.items);
    };
    hb.append(row);
  }
  if (!hoursWithData.length) hb.innerHTML = '<p class="muted">Nothing to show yet.</p>';
}

function capFirst(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

export function fillClips(grid, items) {
  grid.innerHTML = '';
  if (!items.length) { grid.innerHTML = '<p class="muted">No clips on file for this hour.</p>'; return; }
  items.forEach((c, i) => {
    const card = el(`<div class="clipcard"><span class="pslot"></span><div class="specslot"></div><div class="m"><b>${hhmm(c.time)}</b><span>${pct(c.confidence)}</span></div></div>`);
    const spec = spectrogram(c.png);
    $('.specslot', card).replaceWith(spec);
    $('.pslot', card).replaceWith(playButton('play36', c.audio, spec));
    $('.m', card).style.cursor = 'pointer';
    $('.m', card).onclick = () => openRecording(items, i, { returnTo: card });
    grid.append(card);
  });
}
