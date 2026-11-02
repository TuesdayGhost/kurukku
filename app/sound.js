// 鳩の音と読み上げ。ブラウザは人が一度触るまで音を出させないため、
// unlock() を最初のタップで呼ぶ。鳴らす処理は順番待ちにして、音が重ならないようにする。

const RATE = 22050;
const NOTES = [{ f: 659.25, t: 0 }, { f: 523.25, t: 0.5 }];
const CHIME_LEN = 2.4;

let ctx = null;
let samples = null;
let ready = false;
let jaVoice = null;
let queue = Promise.resolve();

function synth() {
  const n = Math.floor(RATE * CHIME_LEN);
  const out = new Float32Array(n);
  for (const note of NOTES) {
    const start = Math.floor(note.t * RATE);
    for (let i = start; i < n; i++) {
      const t = (i - start) / RATE;
      const env = Math.min(1, t / 0.008) * Math.exp(-t * 2.6);
      out[i] += 0.32 * env * (Math.sin(2 * Math.PI * note.f * t) + 0.25 * Math.sin(4 * Math.PI * note.f * t) + 0.08 * Math.sin(6 * Math.PI * note.f * t));
    }
  }
  return out;
}

function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const ja = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
  jaVoice = ja.find((v) => v.localService) || ja[0] || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export function isReady() {
  return ready && ctx && ctx.state === "running";
}

/** タップの中で呼ぶ。成功したら true */
export async function unlock() {
  try {
    if (navigator.audioSession) { try { navigator.audioSession.type = "playback"; } catch (_) { /* 未対応 */ } }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) ctx = new AC();
    if (!samples) samples = synth();
    await ctx.resume();
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, RATE);
    s.connect(ctx.destination);
    s.start();
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0; u.lang = "ja-JP";
      speechSynthesis.speak(u);
      pickVoice();
    }
    ready = ctx.state === "running";
    return ready;
  } catch (_) {
    ready = false;
    return false;
  }
}

async function chimeOnce() {
  if (!ctx) return;
  if (ctx.state !== "running") await ctx.resume();
  const b = ctx.createBuffer(1, samples.length, RATE);
  b.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = 0.85;
  src.connect(g).connect(ctx.destination);
  src.start();
  await new Promise((r) => { src.onended = r; setTimeout(r, CHIME_LEN * 1000 + 300); });
}

function speakNow(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP"; u.rate = 0.9;
    if (jaVoice) u.voice = jaVoice;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    u.onend = finish; u.onerror = finish;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(finish, 15000);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** チャイムを times 回鳴らしてから読み上げる。順番待ちで実行する */
export function announce({ times = 2, text = "" } = {}) {
  queue = queue.then(async () => {
    try {
      for (let i = 0; i < times; i++) {
        await chimeOnce();
        if (i < times - 1) await wait(800);
      }
      if (text) { await wait(400); await speakNow(text); }
    } catch (_) { /* 音が出せなくても表示は続ける */ }
  });
  return queue;
}
