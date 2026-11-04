// 鳩の音と読み上げ。ブラウザは人が一度触るまで音を出させないため、
// unlock() を最初のタップで呼ぶ。鳴らす処理は順番待ちにして、音が重ならないようにする。

const RATE = 22050;

let ctx = null;
let ready = false;
let jaVoice = null;
let queue = Promise.resolve();

// ---------- お知らせの音（11/4 決定：3種類から家族が選ぶ。ブラウザで合成） ----------
// chime        : 通知音（ピン・ポーンの2音のベル）
// pigeon_clock : 鳩時計（笛のような「ポッ・ポー」）
// pendulum     : 振り子時計（低い「ボーン」。回数で時刻と取り違えないよう、いつも1回だけ）
const TAU = 2 * Math.PI;
const KINDS = {
  chime: {
    label: "通知音", len: 2.4,
    render(out) {
      for (const [f, at] of [[659.25, 0], [523.25, 0.5]]) {
        const start = Math.floor(at * RATE);
        for (let i = start; i < out.length; i++) {
          const t = (i - start) / RATE;
          const env = Math.min(1, t / 0.008) * Math.exp(-t * 2.6);
          out[i] += 0.32 * env * (Math.sin(TAU * f * t) + 0.25 * Math.sin(2 * TAU * f * t) + 0.08 * Math.sin(3 * TAU * f * t));
        }
      }
    },
  },
  pigeon_clock: {
    label: "鳩時計", len: 1.5,
    render(out) {
      let seed = 1;
      const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
      for (const [f, at, dur] of [[784, 0, 0.2], [622.25, 0.32, 0.55]]) {
        const start = Math.floor(at * RATE), end = Math.min(out.length, start + Math.floor(dur * RATE));
        let breath = 0;
        for (let i = start; i < end; i++) {
          const t = (i - start) / RATE;
          const env = Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.08);
          const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * t);
          breath = breath * 0.9 + noise() * 0.1;     // 笛の息の音（こもらせたノイズ）
          out[i] += 0.3 * env * (Math.sin(TAU * f * vib * t) + 0.18 * Math.sin(2 * TAU * f * t)) + 0.05 * env * breath;
        }
      }
    },
  },
  pendulum: {
    label: "振り子時計", len: 5, once: true,
    render(out) {
      // 少しずれた高さの音を重ねて、鐘のうなりを出す
      const partials = [[196, 1.0, 0.8], [197.4, 0.6, 0.8], [392, 0.35, 1.4], [541, 0.25, 2.0], [588, 0.12, 2.4], [1058, 0.06, 3.5]];
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        const attack = Math.min(1, t / 0.005);
        let v = 0;
        for (const [f, a, d] of partials) v += a * Math.exp(-t * d) * Math.sin(TAU * f * t);
        out[i] = 0.22 * attack * v;
      }
    },
  },
};
const sampleCache = {};
let chimeKind = "chime";

function synth(kind) {
  if (!sampleCache[kind]) {
    const k = KINDS[kind] || KINDS.chime;
    const out = new Float32Array(Math.floor(RATE * k.len));
    k.render(out);
    sampleCache[kind] = out;
  }
  return sampleCache[kind];
}

/** 家の設定のお知らせの音を使う */
export function setChimeKind(kind) { if (KINDS[kind]) chimeKind = kind; }
export const CHIME_KINDS = Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }));

function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const ja = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
  jaVoice = ja.find((v) => v.localService) || ja[0] || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

/** 試しに鳴らすための、合成した音の波形（テスト用） */
export function samplesFor(kind) { return synth(kind); }

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

async function chimeOnce(kind = chimeKind) {
  if (!ctx) return;
  if (ctx.state !== "running") await ctx.resume();
  const samples = synth(kind);
  const len = samples.length / RATE;
  const b = ctx.createBuffer(1, samples.length, RATE);
  b.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = 0.85;
  src.connect(g).connect(ctx.destination);
  src.start();
  await new Promise((r) => { src.onended = r; setTimeout(r, len * 1000 + 300); });
}

function speakNow(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    // 端末の声のまま、少しだけ高く・ゆっくり（11/4 決定。聞き取りやすさを優先し、変えすぎない）
    u.lang = "ja-JP"; u.rate = 0.9; u.pitch = 1.1;
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

/** お知らせの音を times 回鳴らしてから読み上げる（振り子時計はいつも1回）。順番待ちで実行する */
export function announce({ times = 2, text = "", kind = chimeKind } = {}) {
  announcing++;
  if (KINDS[kind]?.once) times = Math.min(times, 1);
  queue = queue.then(async () => {
    try {
      for (let i = 0; i < times; i++) {
        await chimeOnce(kind);
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
