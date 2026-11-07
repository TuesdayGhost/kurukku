// 鳩の音と読み上げ。ブラウザは人が一度触るまで音を出させないため、
// unlock() を最初のタップで呼ぶ。鳴らす処理は順番待ちにして、音が重ならないようにする。

const RATE = 22050;

let ctx = null;
let ready = false;
let jaVoice = null;
let queue = Promise.resolve();

// ---------- お知らせの音（11/4 決定：3種類から家族が選ぶ） ----------
// chime        : 通知音（ピン・ポーンの2音のベル）。ブラウザで合成
// pigeon_clock : 鳩時計。app/sounds/pigeon_clock.wav（「ポッ・ポー」が2回入っているので1回だけ再生）
// pendulum     : 振り子時計。app/sounds/pendulum.wav。時刻と取り違えないよう、いつも1回だけ
// 2つのファイルは葵依さんが Python で作成（11/4）。ファイルがなければ選べず、通知音で代わりに鳴らす。
// 合成した鳩時計・振り子時計は「幽霊」「お寺の鐘」のようだったため不採用（11/4 実機で確認）。
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
  pigeon_clock: { label: "鳩時計", file: "sounds/pigeon_clock.wav", once: true },
  pendulum: { label: "振り子時計", file: "sounds/pendulum.wav", once: true },
};
const sampleCache = {};
const fileBuffers = {};
const fileAvailable = {};
let chimeKind = "chime";

function synth(kind) {
  const k = KINDS[kind]?.render ? KINDS[kind] : KINDS.chime;
  const key = KINDS[kind]?.render ? kind : "chime";
  if (!sampleCache[key]) {
    const out = new Float32Array(Math.floor(RATE * k.len));
    k.render(out);
    sampleCache[key] = out;
  }
  return sampleCache[key];
}

/** 音のファイルがあるか確かめる（設定画面で、準備中の音を選べないようにするため） */
export async function checkFiles() {
  await Promise.all(Object.entries(KINDS).filter(([, k]) => k.file).map(async ([kind, k]) => {
    if (kind in fileAvailable) return;
    try { const r = await fetch(k.file, { method: "HEAD", cache: "no-store" }); fileAvailable[kind] = r.ok; }
    catch (_) { fileAvailable[kind] = false; }
  }));
  return CHIME_KINDS.map((c) => ({ ...c, available: !c.file || !!fileAvailable[c.value] }));
}

async function loadFile(kind) {
  if (fileBuffers[kind] !== undefined) return fileBuffers[kind];
  try {
    const r = await fetch(KINDS[kind].file);
    if (!r.ok) throw new Error("not found");
    fileBuffers[kind] = await ctx.decodeAudioData(await r.arrayBuffer());
  } catch (_) {
    fileBuffers[kind] = null;   // ファイルがなければ通知音で代わりに鳴らす
  }
  return fileBuffers[kind];
}

/** 家の設定のお知らせの音を使う */
export function setChimeKind(kind) { if (KINDS[kind]) chimeKind = kind; }
export const CHIME_KINDS = Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label, file: k.file || null }));

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
  let b = KINDS[kind]?.file ? await loadFile(kind) : null;
  if (!b) {
    const samples = synth(kind);
    b = ctx.createBuffer(1, samples.length, RATE);
    b.copyToChannel(samples, 0);
  }
  const len = b.duration;
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = 0.85;
  src.connect(g).connect(ctx.destination);
  playing.add(src);
  src.start();
  await new Promise((r) => { src.onended = r; setTimeout(r, len * 1000 + 300); });
  playing.delete(src);
}

// ---------- さわると止まる（11/4 決定。WCAG 2.2 SC 1.4.2 の「止める手段」） ----------
const playing = new Set();
let generation = 0;
/** 鳴っているお知らせの音と読み上げを止め、順番待ちも取りやめる */
export function stopAll() {
  generation++;
  for (const src of playing) { try { src.stop(); } catch (_) { /* もう止まっている */ } }
  playing.clear();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
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
    setTimeout(finish, Math.max(15000, text.length * 300));   // 長い文でも途中で終わった扱いにしない
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
  const gen = generation;
  queue = queue.then(async () => {
    try {
      for (let i = 0; i < times; i++) {
        if (gen !== generation) return;          // 止められたら、残りは鳴らさない
        await chimeOnce(kind);
        if (i < times - 1) await wait(800);
      }
      if (text && gen === generation) { await wait(400); if (gen === generation) await speakNow(text); }
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

// ---------- 「今日の予定を聞く」（11/5 決定） ----------
// 自分で始めた読み上げは、もう一度押すと止まる（SC 1.4.2）。お知らせ中は読まない。
let reading = false;
export function isReading() { return reading; }
/** 読み上げる。始められたら true（お知らせ中・すでに読んでいるときは false） */
export function readAloud(text) {
  if (isBusy() || reading) return false;
  reading = true;
  const gen = generation;
  speakNow(text).finally(() => { if (gen === generation || reading) reading = false; });
  return true;
}
/** 読み上げを止める */
export function stopReading() {
  if (!reading) return;
  reading = false;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
