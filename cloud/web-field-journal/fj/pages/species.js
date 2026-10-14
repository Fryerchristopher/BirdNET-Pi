import { api, site, el, esc, $, $$, hhmm, pct, fmtDate, MONTHS, photoBox, photosFor, creditHtml, spectrogram, playButton, playPill, openRecording } from '../app.js';

const p2 = (n) => String(n).padStart(2, '0');

export async function render(main, { arg: slug }) {
  main.innerHTML = '<div class="skel-page"><div class="skel skel-h1"></div><div class="skel skel-p"></div><div class="skel skel-block"></div></div>';
  let d;
  try { d = await api(`/api/v1/journal/species/${encodeURIComponent(slug)}`); } catch (e) {
    main.innerHTML = `<a class="crumb" href="/">This week at the station</a><h1 class="h1 sp-h1">Not heard here</h1><p class="lede">No detections match "${esc(slug)}". <a href="/species">Find a bird heard at the station.</a></p>`;
    return;
  }
  document.title = `${d.com_name}, ${site?.site_name || ''}`;
  const nowMonth = Number(d.today_date.slice(5, 7)) - 1;
  const maxH = Math.max(1, ...d.hours);
  const sun = d.sun;
  const lastHeard = d.last_date === d.today_date ? `Today, ${d.last_time}` : `${fmtDate(d.last_date, { year: true })}, ${d.last_time}`;

  main.innerHTML = `
    <a class="crumb" href="/">This week at the station</a>
    <h1 class="h1-big sp-h1">${esc(d.com_name)}</h1>
    <div class="sp-sci">${esc(d.sci_name)}</div>

    <section class="sp-main">
      <div class="sp-left">
        <div class="mainslot"></div>
        <div class="credit mainc"></div>
        <div class="gallery"></div>
      </div>
      <aside class="sp-aside">
        <h2 class="h2-panel">Heard at the station</h2>
        <div class="fact"><span class="muted">First heard</span><span class="v"><b>${fmtDate(d.first_date, { year: true })}</b></span></div>
        <div class="fact"><span class="muted">Last heard</span><span class="v"><b>${esc(lastHeard)}</b></span></div>
        <div class="fact"><span class="muted">Total</span><span class="v"><b>${d.total.toLocaleString()}</b> <small>detections</small></span></div>
        <div class="fact"><span class="muted">Usual time</span><span class="v"><b>${p2(d.usual.from)}:00 to ${p2(d.usual.to)}:00</b></span></div>
        <p class="reading">${esc(d.presence)}. ${esc(d.usual.text)}.</p>
        <div class="morebox panel lake-top">
          <div class="top"><h2 class="serif">More birds this week</h2><a class="rnd40" href="/species" aria-label="Search all birds heard at the station" title="Search all birds"><span class="mag"></span></a></div>
          <div class="rows">${d.more_this_week.map((m) => `<a href="/species/${m.slug}"><span class="n">${esc(m.com_name)}</span><span class="w">${m.week} this week</span></a>`).join('') || '<p class="muted" style="margin:8px 0 0">Nothing else this week.</p>'}</div>
          <a class="linkbtn lake all" href="/species">All birds heard at the station</a>
        </div>
      </aside>
    </section>

    <section class="section">
      <div class="sec-head"><h2 class="h2">Heard here through the year</h2><span class="muted" style="font-size:14px">Detections by month, averaged across years.</span></div>
      <div class="months">${d.levels.map((v, i) => `<div><div class="cell lv${v} ${i === nowMonth ? 'now' : ''}"></div><div class="lbl ${i === nowMonth ? 'now' : ''}">${MONTHS[i]}</div></div>`).join('')}</div>
    </section>

    <section class="section">
      <div class="sec-head"><h2 class="h2">When it sings</h2><span class="muted" style="font-size:14px">Share of detections by hour, all time.${sun.sunrise ? ` Sunrise ${sun.sunrise}, sunset ${sun.sunset} today.` : ''}</span></div>
      <div class="hours">
        ${d.hours.map((v, i) => `<div class="bar" style="height:${(v / maxH) * 100}%" title="${p2(i)}:00, ${v} detections"></div>`).join('')}
        ${sun.sunrise_frac != null ? `<div class="sun" style="left:${sun.sunrise_frac * 100}%"><span>Sunrise</span></div><div class="sun" style="left:${sun.sunset_frac * 100}%"><span>Sunset</span></div>` : ''}
      </div>
      <div class="hours-x"><span>Midnight</span><span>6 am</span><span>Noon</span><span>6 pm</span><span>Midnight</span></div>
    </section>

    <section class="section">
      <div class="sec-head"><h2 class="h2">Recordings from the station</h2><a class="linkbtn" href="/species/${d.slug}#all" id="showall">Show all recordings</a></div>
      <div class="recs"></div>
      <div id="all"></div>
    </section>

    <section class="learn"><span class="t">Learn more</span><a href="${esc(d.links.all_about_birds)}" target="_blank" rel="noopener">All About Birds</a><a href="${esc(d.links.wikipedia)}" target="_blank" rel="noopener">Wikipedia</a><a href="${esc(d.links.ebird)}" target="_blank" rel="noopener">eBird</a></section>`;

  // Main photo with the Best recording button, and the gallery.
  const best = d.best[0] ?? null;
  const ph = photoBox(d.sci_name, { clip: best, alt: d.com_name });
  ph.box.classList.add('main');
  const bestSpec = spectrogram(null); // the button plays; the playhead is shown in the card below if open
  if (best?.audio) ph.box.append(playPill('Best recording', best.audio, null, 'sm'));
  $('.mainslot', main).replaceWith(ph.box);
  $('.mainc', main).replaceWith(ph.credit);
  const gallery = $('.gallery', main);
  photosFor(d.sci_name).then((p) => {
    const caps = ['In flight', 'Foraging', 'Perched'];
    if (!p.gallery?.length) { gallery.remove(); return; }
    p.gallery.slice(0, 3).forEach((g, i) => {
      gallery.append(el(`<figure><a class="photo" href="${esc(g.photos_url)}" target="_blank" rel="noopener"><img src="${esc(g.image_url)}" alt="${esc(g.title || d.com_name)}" loading="lazy"></a><figcaption><span>${esc(g.title || caps[i])}</span><br>${creditHtml(g.credit)}</figcaption></figure>`));
    });
  });

  // Recording cards
  const recs = $('.recs', main);
  const clips = d.best;
  if (!clips.length) recs.innerHTML = '<p class="muted">No recordings have been uploaded for this bird yet.</p>';
  clips.forEach((c, i) => {
    const card = el(`<div class="rec" title="Open this recording"><div class="specslot"></div><div class="row"><span class="pslot"></span><div class="meta"><b>${c.date === d.today_date ? 'Today' : fmtDate(c.date, { year: true })}, ${hhmm(c.time)}</b><small>${pct(c.confidence)} confidence</small></div><span class="det">Details</span></div></div>`);
    const spec = spectrogram(c.png);
    $('.specslot', card).replaceWith(spec);
    $('.pslot', card).replaceWith(playButton('play40', c.audio, spec, `Play recording ${i + 1}`));
    card.onclick = (e) => { if (e.target.closest('button')) return; openRecording(clips, i, { returnTo: card }); };
    recs.append(card);
  });
  $('#showall', main).onclick = async (e) => {
    e.preventDefault();
    const box = $('#all', main);
    if (box.dataset.loaded) { box.scrollIntoView({ behavior: 'smooth' }); return; }
    box.dataset.loaded = '1';
    box.innerHTML = '<p class="muted" style="margin-top:24px">Loading all recordings</p>';
    const r = await api(`/api/v1/detections?sci=${encodeURIComponent(d.sci_name)}&available=1&limit=200`);
    const items = r.items.map((x) => ({ file_name: x.file_name, date: x.date, time: x.time, confidence: x.confidence, audio: `/media/${x.media_key}`, png: x.has_png ? `/media/${x.media_key}.png` : null, com_name: x.com_name, sci_name: x.sci_name }));
    box.innerHTML = `<div class="sec-head" style="margin-top:40px"><h2 class="h2-panel serif">All recordings</h2><span class="muted">${r.total} on file, newest first${r.total > 200 ? ', showing 200' : ''}</span></div><div class="clips"></div>`;
    const grid = $('.clips', box);
    items.forEach((c, i) => {
      const card = el(`<div class="clipcard"><span class="pslot"></span><div class="specslot"></div><div class="m"><b>${fmtDate(c.date)} ${hhmm(c.time)}</b><span>${pct(c.confidence)}</span></div></div>`);
      const spec = spectrogram(c.png);
      $('.specslot', card).replaceWith(spec);
      $('.pslot', card).replaceWith(playButton('play36', c.audio, spec));
      card.querySelector('.m').onclick = () => openRecording(items, i, { returnTo: card });
      card.querySelector('.m').style.cursor = 'pointer';
      grid.append(card);
    });
    box.scrollIntoView({ behavior: 'smooth' });
  };
}
