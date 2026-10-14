import { api, site, el, esc, $, $$, plural, longDate, navigate } from '../app.js';

export async function render(main, { arg: ym }) {
  const month = ym || (site?.today || new Date().toISOString().slice(0, 10)).slice(0, 7);
  main.innerHTML = `<div class="arch-head"><h1 class="h1">Archive</h1></div><p class="lede">Loading</p>`;
  const d = await api(`/api/v1/journal/archive/${month}`);
  const params = new URLSearchParams(location.search);
  let selected = params.get('day');
  main.innerHTML = `
    <div class="arch-head">
      <h1 class="h1">Archive</h1>
      <div class="arch-nav">
        <a class="rnd40" href="/archive/${d.prev}" aria-label="Previous month" ${d.prev < d.first_month ? 'style="opacity:.35;pointer-events:none"' : ''}><span class="arrow-l"></span></a>
        <span class="t">${esc(d.title)}</span>
        ${d.next ? `<a class="rnd40" href="/archive/${d.next}" aria-label="Next month"><span class="arrow-r"></span></a>` : '<button class="rnd40" aria-label="Next month" disabled><span class="arrow-r"></span></button>'}
      </div>
    </div>
    <p class="lede">Each day shows how many species were heard. Darker days had more.</p>
    <section class="arch">
      <div class="cal">
        <div class="dow"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
        <div class="grid">${'<span></span>'.repeat(d.first_weekday)}${d.days.map((x) => dayCell(x, d)).join('')}</div>
        <div class="ramp"><span>Fewer species</span><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>More</span></div>
      </div>
      <aside class="arch-side panel lake-top"><div class="t2">Choose a day</div><p class="muted" style="margin:6px 0 0">See which birds were heard, then open the full day.</p></aside>
    </section>`;
  const grid = $('.grid', main);
  grid.onclick = (e) => { const b = e.target.closest('button.d'); if (!b || b.disabled) return; select(b.dataset.date); };
  async function select(date) {
    selected = date;
    history.replaceState(null, '', `/archive/${month}?day=${date}`);
    $$('button.d', grid).forEach((b) => b.classList.toggle('sel', b.dataset.date === date));
    const side = $('.arch-side', main);
    side.innerHTML = `<div class="t">${esc(longDate(date))}</div><div class="sum muted">Loading</div>`;
    const r = await api(`/api/v1/journal/archive/day/${date}`);
    side.innerHTML = `<div class="t">${esc(longDate(date))}</div>
      <div class="sum">${r.stats.detections ? `${plural(r.stats.species, 'species', 'species')}, ${plural(r.stats.detections, 'detection')}${r.is_today ? ' so far' : ''}` : 'Nothing was heard'}</div>
      <div class="rows">${r.top.map((t) => `<div><a class="n" href="/species/${t.slug}" style="text-decoration:none;color:inherit">${esc(t.com_name)}</a><span class="c">${t.n}</span></div>`).join('')}</div>
      <a class="pill-outline" href="${r.is_today ? '/today' : '/day/' + date}">${r.is_today ? 'Open today' : 'Open this day'}</a>`;
  }
  if (selected && /^\d{4}-\d{2}-\d{2}$/.test(selected)) select(selected);
}

function dayCell(x, d) {
  if (x.future) return `<button class="d off" disabled aria-label="${x.date}"><span class="dn">${x.day}</span><span class="n"></span></button>`;
  const lv = x.species === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((4 * x.species) / d.max_species)));
  const light = lv >= 3 && !document.documentElement.matches('[data-theme="dark"]') && !(window.matchMedia('(prefers-color-scheme: dark)').matches && !document.documentElement.dataset.theme);
  return `<button class="d lv${lv} ${light ? 'light' : ''} ${x.is_today ? 'today' : ''}" data-date="${x.date}" aria-label="${x.date}, ${plural(x.species, 'species', 'species')}"><span class="dn">${x.day}</span><span class="n">${x.species || ''}</span></button>`;
}
