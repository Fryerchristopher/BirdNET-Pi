import { api, site, el, esc, $, hhmm, photoBox, stopAll, cssVar } from '../app.js';

let timer = null;

export async function render(main) {
  clearInterval(timer);
  const hasStream = !!site?.stream_url;
  main.innerHTML = `
    <section class="live-top">
      <h1 class="h1">Listen live</h1>
      <p class="lede">The station microphone, as it hears the forest right now.</p>
      <button class="bigplay" aria-label="Start listening" ${hasStream ? '' : 'disabled style="opacity:.5"'}><span class="tri"></span></button>
      <div class="live-lbl">${hasStream ? 'Start listening' : 'Live audio is not published'}</div>
      <div class="live-note">${hasStream ? 'Audio starts when you press play' : 'The station only sends recordings, not a live stream. The spectrogram below is the most recent one it analyzed.'}</div>
      ${hasStream ? `<audio id="livea" crossorigin="anonymous" preload="none" src="${esc(site.stream_url)}"></audio>` : ''}
    </section>
    <section class="livepanel panel">
      <div class="wrap">
        <div class="y"><span>10 kHz</span><span>5</span><span>0</span></div>
        <div class="cv"><div class="box"><canvas id="livec"></canvas></div><div class="x"><span id="xl">12 seconds ago</span><span>Now</span></div></div>
      </div>
    </section>
    <section class="section">
      <div class="sec-head ruled"><h2 class="h2">Heard in the last 15 minutes</h2><span class="muted" id="upd"></span></div>
      <p class="reading" id="livemsg" style="margin-top:16px"></p>
      <div class="minis" id="minis"></div>
    </section>`;

  const canvas = $('#livec', main), ctx = canvas.getContext('2d');
  const resize = () => { canvas.width = canvas.clientWidth || 800; canvas.height = canvas.clientHeight || 300; ctx.fillStyle = cssVar('--surface'); ctx.fillRect(0, 0, canvas.width, canvas.height); };
  resize();
  window.addEventListener('resize', resize, { once: true });
  const stops = () => cssVar('--cmap').split(',').map((h) => h.trim());
  const colorFor = (rat) => { const s = stops(); const t = rat * (s.length - 1), k = Math.min(s.length - 2, Math.floor(t)), f = t - k; const a = hex(s[k]), b = hex(s[k + 1]); return `rgb(${a.map((v, i) => Math.round(v * (1 - f) + b[i] * f)).join(',')})`; };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  let ac, analyser, data, raf, on = false;
  const btn = $('.bigplay', main), lbl = $('.live-lbl', main), note = $('.live-note', main);
  if (hasStream) {
    const audio = $('#livea', main);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      const w = canvas.width, h = canvas.height;
      ctx.drawImage(canvas, -1, 0);
      // show 0..10 kHz: with a 48 kHz stream the bins cover 0..24 kHz, so use the lower ~42%
      const bins = Math.floor(data.length * (10000 / (ac.sampleRate / 2)));
      for (let i = 0; i < bins; i++) {
        const y = h - Math.round((i / bins) * h);
        ctx.fillStyle = colorFor(data[i] / 255);
        ctx.fillRect(w - 1, y, 1, Math.ceil(h / bins) + 1);
      }
    };
    btn.onclick = async () => {
      if (on) { audio.pause(); cancelAnimationFrame(raf); on = false; btn.innerHTML = '<span class="tri"></span>'; lbl.textContent = 'Start listening'; note.textContent = 'Audio starts when you press play'; btn.setAttribute('aria-label', 'Start listening'); return; }
      stopAll();
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (!analyser) { const src = ac.createMediaElementSource(audio); analyser = ac.createAnalyser(); analyser.fftSize = 2048; data = new Uint8Array(analyser.frequencyBinCount); src.connect(analyser); analyser.connect(ac.destination); }
      await ac.resume();
      audio.load();
      try { await audio.play(); } catch (e) { note.textContent = 'The stream could not start. It must allow cross-origin audio.'; return; }
      on = true;
      btn.innerHTML = '<span class="sq"></span>'; lbl.textContent = 'Stop listening'; note.textContent = 'Playing live from the station microphone'; btn.setAttribute('aria-label', 'Stop listening');
      draw();
    };
  } else {
    // image mode: show the latest spectrogram the Pi pushed
    const img = new Image();
    img.onload = () => { resize(); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); $('#xl', main).textContent = 'Latest recording'; };
    const load = async () => { const l = await api('/api/v1/live'); if (l.spectrogram) img.src = `${l.spectrogram.url}?t=${Date.parse(l.spectrogram.uploaded)}`; };
    load();
    timer = setInterval(() => { if (!document.hidden) { load(); refresh(); } }, 15000);
  }

  async function refresh() {
    const l = await api('/api/v1/journal/live');
    $('#upd', main).textContent = `Updated ${hhmm(l.now)}`;
    const minis = $('#minis', main), msg = $('#livemsg', main);
    minis.innerHTML = '';
    const list = l.recent.length ? l.recent.map((r) => ({ ...r, when: `Last heard ${hhmm(r.last_time)}` })) : l.last_heard.map((r) => ({ ...r, when: `Last heard ${r.date === site?.today ? hhmm(r.time) : r.date + ' ' + hhmm(r.time)}` }));
    if (l.recent.length) msg.textContent = '';
    else msg.textContent = l.last_heard.length ? `Nothing identified since ${l.last_detection_time}. Birds often go quiet by mid-morning. These were the last ones heard:` : 'Nothing has been identified yet.';
    for (const r of list) {
      const a = el(`<a class="mini" href="/species/${r.slug}"><span class="pslot"></span><span><span class="n">${esc(r.com_name)}</span><span class="w">${esc(r.when)}</span></span></a>`);
      const ph = photoBox(r.sci_name, { alt: r.com_name });
      $('.pslot', a).replaceWith(ph.box);
      minis.append(a);
    }
  }
  await refresh();
  if (hasStream) timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
}
