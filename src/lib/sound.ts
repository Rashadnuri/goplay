/** Synthesised stone sounds (Web Audio): no audio files to download, works offline, respects the user's volume. */
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx ??= new C();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}
function click(a: AudioContext, when: number, vol: number, freq: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, when); o.frequency.exponentialRampToValueAtTime(freq * 0.55, when + 0.09);
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);
  o.connect(g).connect(a.destination); o.start(when); o.stop(when + 0.12);
  // wooden "tick": short filtered noise
  const len = Math.floor(a.sampleRate * 0.03), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const n = a.createBufferSource(), nf = a.createBiquadFilter(), ng = a.createGain();
  nf.type = 'bandpass'; nf.frequency.value = 1800; ng.gain.value = vol * 0.6; n.buffer = buf; n.connect(nf).connect(ng).connect(a.destination); n.start(when);
}
export function playStone(volume: number) { const a = ac(); if (a && volume > 0) click(a, a.currentTime, 0.5 * volume, 320); }
export function playCapture(volume: number) { const a = ac(); if (a && volume > 0) { click(a, a.currentTime, 0.5 * volume, 320); click(a, a.currentTime + 0.09, 0.4 * volume, 250); click(a, a.currentTime + 0.17, 0.3 * volume, 200); } }
export function playAlert(volume: number) { const a = ac(); if (a && volume > 0) click(a, a.currentTime, 0.6 * volume, 660); }
