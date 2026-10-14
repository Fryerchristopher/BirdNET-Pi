import { api, site, el, esc, $, $$, hhmm, pct, fmtDate, plural, photoBox, spectrogram, playButton, playPill, emptyToday } from '../app.js';

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function heardStrip(levels, nowMonth) {
  return `<div><div class="heard">${levels.map((v, i) => `<div class="lv${v} ${i === nowMonth ? 'now' : ''}" title="${esc(MONTH_LETTERS[i])}"></div>`).join('')}</div>
    <div class="heard-l">${MONTH_LETTERS.map((l) => `<span>${l}</span>`).join('')}</div></div>`;
}

export function plate(p, { big = false, nowMonth }) {
  const art = el(`<article class="plate ${big ? 'big' : ''}">
    <div class="pslot"></div>
    <div class="body">
      <div><a class="name" href="/species/${p.slug}">${esc(p.com_name)}</a><div class="sci">${esc(p.sci_name)}</div></div>
      <div class="clip"></div>
      ${heardStrip(p.levels, nowMonth)}
      <div class="foot"><span>${p.today ? `${p.today} today, ${p.week} this week` : `${p.week} this week`}</span><span class="muted">${esc(p.presence)}</span></div>
    </div></article>`);
  const ph = photoBox(p.sci_name, { href: `/species/${p.slug}`, clip: p.best, alt: p.com_name });
  $('.pslot', art).replaceWith(ph.box);
  const spec = spectrogram(p.best?.png ?? null);
  $('.clip', art).append(playButton('play36', p.best?.audio ?? null, spec, `Play ${p.com_name}`), spec);
  return art;
}

export async function render(main) {
  main.innerHTML = `<section><h1 class="h1">This week at the station</h1><p class="lede">${esc(site?.tagline || '')}</p></section><div class="skel-plates">${'<div class="skel skel-plate"></div>'.repeat(4)}</div>`;
  const d = await api('/api/v1/journal/home');
  const nowMonth = Number(d.today.slice(5, 7)) - 1;
  const ts = d.today_stats;
  const condText = d.conditions ? d.conditions.summary : null;
  const cmp = d.comparison;
  const h = d.hero;

  main.innerHTML = `
    <section><h1 class="h1">This week at the station</h1><p class="lede">${esc(site?.tagline || '')}</p></section>
    ${h ? `<section class="hero">
      <div class="hero-l">
        <div class="label">Most heard this week</div>
        <div>
          <a class="name h1-big serif" href="/species/${h.slug}">${esc(h.com_name)}</a>
          <div class="sci">${esc(h.sci_name)}</div>
          <p class="reading">${esc(h.presence)}. ${h.today ? `Heard ${plural(h.today, 'time')} today.` : 'Not heard yet today.'}</p>
        </div>
        <div class="hero-clip">
          <div class="specslot"></div>
          <div class="row"><span class="pillslot"></span><span class="num">${h.best ? `${h.best.date === d.today ? 'Today' : fmtDate(h.best.date)} ${hhmm(h.best.time)}, ${pct(h.best.confidence)} confidence` : 'No recording yet'}</span></div>
        </div>
      </div>
      <div class="mosaic">
        ${mosaicCell('Most heard', d.mosaic.most, 'most')}
        ${mosaicCell('Runner-up', d.mosaic.runner_up, 'runner')}
        ${mosaicCell('Rarest this week', d.mosaic.rarest, 'rare')}
        <div class="tile">
          <div class="head">${ts.detections ? `Today so far: ${plural(ts.detections, 'detection')} of ${plural(ts.species, 'species', 'species')}.` : esc(emptyToday(d.sun))}</div>
          <div class="blk">${condText ? `<div><b>${esc(condText)}</b></div>` : ''}<div>${d.sun.sunrise ? `Sunrise ${d.sun.sunrise}, sunset ${d.sun.sunset}` : ''}</div></div>
          <div class="blk"><div><b>${esc(cmp.yesterday_label)}</b>, ${esc(cmp.yesterday_detail)}</div>${cmp.typical_label ? `<div><b>${esc(cmp.typical_label)}</b></div>` : ''}</div>
          <div class="foot"><a href="/today">Today</a></div>
        </div>
      </div>
    </section>` : `<section class="section"><p class="empty">Nothing has been heard in the last seven days.${d.sun.sunrise ? ` Sunrise at the station is at ${d.sun.sunrise}.` : ''}</p></section>`}

    <section class="section">
      <div class="sec-head ruled"><h2 class="h2">This week's birds</h2><span class="muted">${d.plates.length ? `${plural(d.plates.length, 'species', 'species')}, ${fmtDate(d.week.from)} to ${fmtDate(d.week.to)}.` : ''}</span></div>
      <div class="plates"></div>
    </section>

    <section class="newquiet">
      <div class="new"><h2 class="h2 lake">New this week</h2><p class="lede">Heard this week but not last week.</p>
        ${d.new_this_week.map((s) => `<div class="row"><a class="n" href="/species/${s.slug}">${esc(s.com_name)}</a><span class="note">${s.returning ? 'Back since' : 'First heard'} ${fmtDate(s.first_date)}</span></div>`).join('') || '<p class="muted">No new arrivals this week.</p>'}
      </div>
      <div class="quiet"><h2 class="h2">Quiet this week</h2><p class="lede">Heard last week, not since.</p>
        ${d.quiet_this_week.map((s) => `<div class="row"><span class="n">${esc(s.com_name)}</span><span class="note">Last heard ${fmtDate(s.last_date)}</span></div>`).join('') || '<p class="muted">Everyone from last week is still around.</p>'}
      </div>
    </section>

    <section class="todaystrip panel">
      <p>${ts.detections ? `Today so far: ${plural(ts.detections, 'detection')} of ${plural(ts.species, 'species', 'species')}. The first was at ${hhmm(ts.first_time)}, the latest at ${hhmm(ts.latest_time)}.` : esc(emptyToday(d.sun))}${condText ? ` <span class="muted">${esc(condText)}.</span>` : ''}</p>
      <a class="pill-outline" href="/today">Today</a>
    </section>`;

  if (h) {
    const spec = spectrogram(h.best?.png ?? null, { conifer: true });
    $('.specslot', main).replaceWith(spec);
    $('.pillslot', main).replaceWith(playPill('Hear it', h.best?.audio ?? null, spec));
    for (const [key, sp] of [['most', d.mosaic.most], ['runner', d.mosaic.runner_up], ['rare', d.mosaic.rarest]]) {
      if (!sp) continue;
      const fig = $(`.mosaic figure.${key}`, main);
      const ph = photoBox(sp.sci_name, { href: `/species/${sp.slug}`, clip: sp.best, alt: sp.com_name });
      $('.pslot', fig).replaceWith(ph.box);
      $('figcaption', fig).replaceWith(ph.credit);
    }
  }
  const grid = $('.plates', main);
  const uniform = localStorage.getItem('fj-plates') === 'uniform';
  d.plates.forEach((p, i) => grid.append(plate(p, { big: i === 0 && !uniform, nowMonth })));
  if (!d.plates.length) grid.innerHTML = '<p class="muted">No detections in the last seven days.</p>';
}

function mosaicCell(label, sp, cls) {
  if (!sp) return `<figure class="${cls}"><div class="cap"><b>${label}</b></div><div class="photo empty"></div><figcaption class="credit"></figcaption></figure>`;
  return `<figure class="${cls}"><div class="cap"><b>${label}</b> <span class="n">${esc(sp.com_name)}</span> <span class="w">${sp.week} this week</span></div><div class="pslot"></div><figcaption class="credit"></figcaption></figure>`;
}
