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

let announcing = 0;
/** お知らせの音を鳴らしている最中か（おしゃべり鳩は黙る） */
export function isBusy() { return announcing > 0; }

/** チャイムを times 回鳴らしてから読み上げる。順番待ちで実行する */
export function announce({ times = 2, text = "" } = {}) {
  announcing++;
  queue = queue.then(async () => {
    try {
      for (let i = 0; i < times; i++) {
        await chimeOnce();
        if (i < times - 1) await wait(800);
      }
      if (text) { await wait(400); await speakNow(text); }
    } catch (_) { /* 音が出せなくても表示は続ける */ }
    finally { announcing--; }
  });
  return queue;
}

// ---------- おしゃべり鳩：意味のない優しい鳴き声（11/3 決定） ----------
// 音源は未決のため、録音なしで合成した鳩の声で仮置き。あとで録音ファイルに差し替えられる。
// 各音は [開始秒, 長さ, 始めの高さHz, 終わりの高さHz, 大きさ, ふるえ(Hz)]
export const COOS = [
  { text: "ぽぽ……",      notes: [[0, 0.22, 390, 360, 0.5, 0], [0.32, 0.34, 370, 330, 0.45, 0]] },
  { text: "くるっくー！", notes: [[0, 0.28, 400, 440, 0.45, 28], [0.36, 0.12, 470, 470, 0.4, 0], [0.56, 0.62, 500, 360, 0.55, 0]] },
  { text: "んー？ ぽ？",  notes: [[0, 0.5, 320, 430, 0.45, 6], [0.66, 0.16, 460, 480, 0.45, 0]] },
  { text: "くるる……",    notes: [[0, 0.7, 380, 340, 0.4, 24]] },
];

function cooNote(t0, [start, dur, f1, f2, vol, trem]) {
  const t = t0 + start;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * 0.6, t + 0.04);
  g.gain.setValueAtTime(vol * 0.6, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  // 喉を鳴らすような小さなふるえ
  let lfo = null;
  if (trem) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = trem;
    const lg = ctx.createGain();
    lg.gain.value = vol * 0.25;
    lfo.connect(lg).connect(g.gain);
    lfo.start(t); lfo.stop(t + dur);
  }
  // こもった柔らかい音にする
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 900;
  o.connect(g).connect(lp).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

/** 鳴き声を1つ鳴らす。鳴らせたら、その鳴き声（text）を返す。お知らせ中・準備前は null */
export function coo(index = Math.floor(Math.random() * COOS.length)) {
  if (!isReady() || isBusy()) return null;
  const c = COOS[index % COOS.length];
  const t0 = ctx.currentTime + 0.02;
  for (const n of c.notes) cooNote(t0, n);
  return c;
}
