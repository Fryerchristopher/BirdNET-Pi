/*
 * Spectrogram page. Two modes, as on the Pi:
 *   live    Web Audio analyser drawing a scrolling spectrogram of the live
 *           stream, with the Pi's detection labels overlaid at the second
 *           they occurred. Needs settings.stream_url (the Pi's icecast
 *           exposed through a Cloudflare Tunnel, with CORS allowed).
 *   legacy  the most recent spectrogram.png the Pi pushed, refreshed every
 *           RECORDING_LENGTH seconds. Used when there is no stream.
 */
import { renderShell, api, el, esc, $, every, params } from './app.js';

const site = await renderShell('Spectrogram');
const s = site.settings || {};
const rl = Number(s.recording_length || 15);
const main = $('#main');
const legacy = !s.stream_url || params.get('legacy') === '1' || /iPhone/.test(navigator.userAgent);

if (legacy) {
  main.innerHTML = `<div class="card"><h2>Currently Analyzing</h2><div id="img"><p class="muted">Waiting for the Pi to push a spectrogram...</p></div>
    ${!s.stream_url ? '<p class="help">Live mode needs a public stream URL (Admin &gt; Settings &gt; Live stream URL). Until then this page shows the image the Pi generates for each recording.</p>' : ''}</div>`;
  const refresh = async () => {
    const l = await api('/api/v1/live');
    if (!l.spectrogram) return;
    $('#img').innerHTML = `<img src="${l.spectrogram.url}?t=${Date.parse(l.spectrogram.uploaded)}" style="width:100%" alt="spectrogram"><p class="muted">${esc(l.analyzing_now || '')} &middot; ${new Date(l.spectrogram.uploaded).toLocaleTimeString()}</p>`;
  };
  await refresh();
  every(rl * 1000, refresh);
} else {
  main.innerHTML = `<div class="card">
    <div class="row between">
      <div class="row"><button id="start" class="primary">Start</button>
        <label>Gain <input type="range" id="gain" min="0" max="250" value="100"></label>
        <label><input type="checkbox" id="comp"> Compression</label></div>
      <a class="btn" href="?legacy=1">Image mode</a>
    </div>
    <canvas id="c" class="live-canvas"></canvas>
    <audio id="player" crossorigin="anonymous" preload="none" src="${esc(s.stream_url)}"></audio>
    <p class="help">Labels come from the Pi's analysis of the same audio and are placed where that second scrolled to.</p>
  </div>`;
  const canvas = $('#c');
  const ctx = canvas.getContext('2d');
  const audio = $('#player');
  let ac, analyser, gain, comp, data, raf, started = false, frames = 0, t0 = 0, fps = 30;
  const resize = () => { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; ctx.fillStyle = 'hsl(280,100%,10%)'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
  resize();
  window.onresize = resize;

  const draw = () => {
    raf = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);
    const w = canvas.width, h = canvas.height;
    ctx.drawImage(canvas, -1, 0);
    const bins = data.length;
    for (let i = 0; i < bins; i++) {
      const rat = data[i] / 255;
      const y = h - Math.round((i / bins) * h);
      ctx.fillStyle = `hsl(${(rat * 120 + 280) % 360}, 100%, ${10 + 70 * rat}%)`;
      ctx.fillRect(w - 1, y, 1, Math.ceil(h / bins) + 1);
    }
    frames++;
    if (frames % 60 === 0) { const now = performance.now(); fps = 60000 / (now - t0); t0 = now; }
  };

  $('#start').onclick = async () => {
    if (started) { audio.pause(); cancelAnimationFrame(raf); started = false; $('#start').textContent = 'Start'; return; }
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (!analyser) {
      const src = ac.createMediaElementSource(audio);
      gain = ac.createGain();
      comp = ac.createDynamicsCompressor();
      Object.assign(comp, {});
      comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12; comp.attack.value = 0; comp.release.value = .25;
      analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      data = new Uint8Array(analyser.frequencyBinCount);
      src.connect(gain);
      wire();
      analyser.connect(ac.destination);
    }
    await ac.resume();
    audio.load();
    await audio.play().catch((e) => alert('Could not play the stream: ' + e.message + '\nThe stream must allow cross-origin audio (Access-Control-Allow-Origin).'));
    started = true;
    $('#start').textContent = 'Stop';
    t0 = performance.now();
    draw();
  };
  function wire() {
    gain.disconnect();
    if ($('#comp').checked) { gain.connect(comp); comp.connect(analyser); } else gain.connect(analyser);
  }
  $('#gain').oninput = (e) => { if (gain) gain.gain.value = e.target.value / 50; };
  $('#comp').onchange = () => { if (gain) wire(); };

  // Labels from the Pi's sidecar, placed at x = width - (delay - start) * fps.
  let lastSidecar = '';
  every(1000, async () => {
    if (!started) return;
    const l = await api('/api/v1/live');
    if (!l.live || l.live.file_name === lastSidecar) return;
    lastSidecar = l.live.file_name;
    const delay = l.live.age_seconds;
    let y = 20;
    ctx.font = '15px sans-serif';
    for (const d of l.live.detections) {
      const x = canvas.width - (delay - d.start) * fps;
      ctx.globalAlpha = Math.max(.2, d.confidence);
      ctx.fillStyle = '#fff';
      ctx.fillText(d.common_name, Math.max(2, x), y);
      ctx.globalAlpha = 1;
      y = y >= 80 ? 20 : y + 15;
    }
  });
}
