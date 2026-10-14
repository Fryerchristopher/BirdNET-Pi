import { api, el, esc, $, $$ } from '../app.js';

export async function render(main) {
  main.innerHTML = `<h1 class="h1">Find a bird heard at the station</h1><p class="lede">Loading the list</p>`;
  const { items, total } = await api('/api/v1/journal/species', { ttl: 300_000 });
  const sorted = [...items].sort((a, b) => a.com_name.localeCompare(b.com_name));
  const byL = new Map();
  for (const s of sorted) { const L = s.com_name[0].toUpperCase(); if (!byL.has(L)) byL.set(L, []); byL.get(L).push(s); }
  const letters = [...byL.keys()].sort();
  main.innerHTML = `
    <h1 class="h1">Find a bird heard at the station</h1>
    <p class="lede">${total} species heard here, A to Z.</p>
    <div class="bigsearch"><span class="mag"></span><input type="search" placeholder="Common or scientific name" aria-label="Common or scientific name" autocomplete="off"></div>
    <section class="qres hidden" style="margin-top:24px"><div class="muted" style="font-size:14px" id="qcount"></div><div class="results"></div></section>
    <nav class="letters" aria-label="Letter index">${letters.map((L) => `<button data-l="${L}">${L}</button>`).join('')}</nav>
    ${letters.map((L) => `<section class="az" id="L-${L}"><div class="L">${L}</div><div class="items">${byL.get(L).map((s) => `<a href="/species/${s.slug}"><span class="n">${esc(s.com_name)}</span><span class="w">${s.week ? s.week + ' this week' : ''}</span></a>`).join('')}</div></section>`).join('')}`;
  $('.letters', main).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const t = $(`#L-${b.dataset.l}`, main); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 16, behavior: 'smooth' }); };
  const input = $('input', main), res = $('.qres', main), grid = $('.results', main), count = $('#qcount', main);
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { res.classList.add('hidden'); return; }
    const hits = sorted.filter((s) => s.com_name.toLowerCase().includes(q) || s.sci_name.toLowerCase().includes(q));
    count.textContent = `${hits.length} ${hits.length === 1 ? 'bird matches' : 'birds match'}`;
    grid.innerHTML = hits.map((s) => `<a href="/species/${s.slug}"><span class="n">${esc(s.com_name)}</span><span class="s">${esc(s.sci_name)}</span></a>`).join('');
    res.classList.remove('hidden');
  };
  input.focus();
}
