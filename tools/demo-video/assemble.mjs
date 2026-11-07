// 本番の組み立て：edit.json の編集表どおりに、素材フォルダの動画・声・差し込みをつないで mp4 にする。
// 実行：node tools/demo-video/assemble.mjs <素材フォルダ> [出力mp4] [--bgm 音楽.wav]
// 素材フォルダ：V01_open.mov … N1.wav … HATO_A.wav …。差し込みは out/inserts/*.mp4（render-inserts.mjs で先に作る）
// 演出（11/7）：縦長の素材はぼかした背景の上に置く／zoom でゆっくり寄る／side で左右に並べる／場面はクロスフェード／
//   lead で場面の頭に一行を大きく出す／字幕は下の帯に焼き込む／声は区間の開始秒に重ねる／--bgm は声の下で自動で小さくなる
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2); const bgmIdx = argv.indexOf("--bgm"); const bgm = bgmIdx >= 0 ? path.resolve(argv[bgmIdx + 1]) : null;
if (bgmIdx >= 0) argv.splice(bgmIdx, 2);
const srcDir = path.resolve(argv[0] || "kurukku-video");
const outFile = path.resolve(argv[1] || path.join(repo, "tools/demo-video/out/kurukku-demo.mp4"));
const work = path.join(repo, "tools/demo-video/out/work"); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
const E = JSON.parse(fs.readFileSync(path.join(repo, "tools/demo-video/edit.json"), "utf8"));
const { fps, width: W, height: H } = E; const BAND = 180, VH = H - BAND; const bg = E.bg.replace("#", "0x");
const XF = E.crossfade ?? 0.4;
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const probe = (f, sel, key) => execFileSync("ffprobe", ["-v", "error", ...(sel ? ["-select_streams", sel] : []), "-show_entries", key, "-of", "csv=p=0", f]).toString().trim();
const find = (stem) => { const files = fs.readdirSync(srcDir).filter((f) => f.startsWith(stem)).sort(); return files.length ? path.join(srcDir, files[0]) : null; };
const resolveSrc = (s) => s.startsWith("insert:") ? path.join(repo, "tools/demo-video/out/inserts", s.slice(7) + ".mp4") : s.startsWith("docs/") || s.startsWith("app/") ? path.join(repo, s) : find(s) || find(s.replace(/\.\w+$/, ""));
const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;

// 映像を幅w×高さhに収める。縦長や比率の違う素材は、同じ映像をぼかして広げた背景の上に置く
function fitChain(label, w, h, zoom) {
  const z = zoom ? `,zoompan=z='min(1+(${zoom.to}-1)*on/${zoom.frames},${zoom.to})':x='iw/2-(iw/zoom/2)+(${zoom.cx ?? 0.5}-0.5)*iw/zoom':y='ih/2-(ih/zoom/2)+(${zoom.cy ?? 0.5}-0.5)*ih/zoom':d=1:s=${w}x${h}:fps=${fps}` : "";
  return `[${label}]split=2[${label}a][${label}b];` +
    `[${label}a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=28,eq=brightness=-0.08:saturation=0.9[${label}bg];` +
    `[${label}b]scale=${w}:${h}:force_original_aspect_ratio=decrease[${label}fg];` +
    `[${label}bg][${label}fg]overlay=(W-w)/2:(H-h)/2:format=auto${z}[${label}out]`;
}

const parts = []; let t = 0; const subs = []; const notes = []; const voices = []; const missing = [];
for (const [i, s] of E.segments.entries()) {
  const src = resolveSrc(s.src); const out = path.join(work, `p${String(i).padStart(2, "0")}.mp4`);
  const ok = src && fs.existsSync(src); if (!ok) missing.push(s.src);
  const isImage = ok && /\.(png|jpg|jpeg)$/i.test(src);
  const zoom = s.zoom ? { ...s.zoom, frames: Math.round(s.dur * fps) } : null;
  if (!ok) {
    ff(["-f", "lavfi", "-i", `color=c=${bg}:s=${W}x${H}:r=${fps}`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(s.dur), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", out]);
  } else if (isImage) {
    const vf = `scale=${W}:${VH}:force_original_aspect_ratio=decrease,pad=${W}:${VH}:(ow-iw)/2:(oh-ih)/2:color=${bg},pad=${W}:${H}:0:0:color=0x1f2a24,fps=${fps},format=yuv420p,setsar=1`;
    ff(["-loop", "1", "-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(s.dur), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", out]);
  } else {
    const hasAudio = probe(src, "a", "stream=codec_type").includes("audio");
    const useSrcAudio = s.keepAudio && hasAudio;
    const inputs = ["-ss", String(s.in || 0), "-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
    const sp = s.speed || 1;   // 早回し（映像だけ。素材の音は使わない前提）
    let vchain;
    if (s.side) {   // 左右に並べる：左に side の素材、右に主の素材
      const side = resolveSrc(s.side.src); inputs.push("-ss", String(s.side.in || 0), "-i", side);
      const half = W / 2;
      vchain = `[2:v]setpts=PTS/${sp},fps=${fps},tpad=stop_mode=clone:stop_duration=${s.dur}[sv];${fitChain("sv", half, VH, null)};` +
        `[0:v]setpts=PTS/${sp},fps=${fps},tpad=stop_mode=clone:stop_duration=${s.dur}[mv];${fitChain("mv", half, VH, null)};` +
        `[svout][mvout]hstack=2[row];[row]pad=${W}:${H}:0:0:color=0x1f2a24,trim=0:${s.dur},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v]`;
    } else {
      vchain = `[0:v]setpts=PTS/${sp},fps=${fps},tpad=stop_mode=clone:stop_duration=${s.dur}[mv];${fitChain("mv", W, VH, zoom)};` +
        `[mvout]pad=${W}:${H}:0:0:color=0x1f2a24,trim=0:${s.dur},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v]`;
    }
    const achain = useSrcAudio ? `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${s.gain || 0}dB,apad,atrim=0:${s.dur},asetpts=PTS-STARTPTS[a]` : `[1:a]atrim=0:${s.dur},asetpts=PTS-STARTPTS[a]`;
    // 鳩の吹き出し：透明 PNG のコマ列を at 秒から重ねる（右下、帯の上）
    let bchain = "";
    if (s.bubble) {
      const [name, at] = s.bubble; const dir = path.join(repo, "tools/demo-video/out/bubbles", name);
      inputs.push("-framerate", String(fps), "-i", path.join(dir, "f%04d.png"));
      const bi = inputs.filter((x) => x === "-i").length - 1;
      vchain = vchain.replace("[v]", "[v0]");
      bchain = `;[${bi}:v]format=rgba,setpts=PTS+${at}/TB[bb];[v0][bb]overlay=W-w-40:${VH}-h-30:eof_action=pass[v]`;
    }
    ff([...inputs, "-filter_complex", `${vchain}${bchain};${achain}`, "-map", "[v]", "-map", "[a]", "-t", String(s.dur), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-ar", "48000", out]);
  }
  parts.push({ out, dur: s.dur });
  // クロスフェードで各区間は XF 秒ずつ早く始まる
  const start = i === 0 ? 0 : t - XF; t = start + s.dur;
  for (const [a, b, text] of s.subs || []) subs.push([start + a, start + Math.min(b, s.dur), text]);
  if (s.note) notes.push([start, start + s.dur, s.note]);
  for (const [stem, at] of s.voice || []) { const f = find(stem); if (f) voices.push([f, start + at]); else missing.push(stem); }
  console.log(`${String(i).padStart(2)} ${fmt(start)}  ${s.name}  (${s.dur}s)${ok ? "" : "  ※素材なし → 地の色"}`);
}
console.log(`合計 ${fmt(t)}（${t.toFixed(1)}秒）`); if (missing.length) console.log("見つからない素材:", [...new Set(missing)].join(", "));

// 2. クロスフェードでつなぐ（映像 xfade、音 acrossfade）
const inputs = parts.flatMap((p) => ["-i", p.out]); const chains = []; let vcur = "0:v", acur = "0:a", off = 0;
for (let i = 1; i < parts.length; i++) {
  off += parts[i - 1].dur - XF;
  chains.push(`[${vcur}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)}[v${i}]`, `[${acur}][${i}:a]acrossfade=d=${XF}:c1=tri:c2=tri[a${i}]`);
  vcur = `v${i}`; acur = `a${i}`;
}
const joined = path.join(work, "joined.mp4");
ff([...inputs, "-filter_complex", chains.join(";"), "-map", `[${vcur}]`, "-map", `[${acur}]`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", joined]);

// 3. 字幕（ASS）：下の帯の Sub と、場面の頭に大きく出す Lead
const ts = (x) => { const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = (x % 60).toFixed(2).padStart(5, "0"); return `${h}:${String(m).padStart(2, "0")}:${s}`; };
const escA = (s) => s.replace(/\n/g, "\\N");
const ass = [`[Script Info]`, `ScriptType: v4.00+`, `PlayResX: ${W}`, `PlayResY: ${H}`, `WrapStyle: 2`, ``, `[V4+ Styles]`,
  `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`,
  `Style: Sub,Zen Kaku Gothic New,46,&H00FFFFFF,&H00FFFFFF,&H00141414,&H00141414,-1,0,0,0,100,100,0,0,1,0,0,2,80,80,34,1`,
  `Style: Note,Zen Kaku Gothic New,26,&H00E9EDF1,&H00FFFFFF,&H0014181C,&H8014181C,0,0,0,0,100,100,0,0,3,8,0,9,0,40,30,1`,
  ``, `[Events]`, `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`,
  ...subs.map(([a, b, text]) => `Dialogue: 0,${ts(a)},${ts(b)},Sub,,0,0,0,,${escA(text)}`),
  ...notes.map(([a, b, text]) => `Dialogue: 1,${ts(a)},${ts(b)},Note,,0,0,0,,${escA(text)}`)].join("\n");
const assFile = path.join(work, "subs.ass"); fs.writeFileSync(assFile, ass);
fs.writeFileSync(outFile.replace(/\.mp4$/, ".srt"), subs.map(([a, b, text], i) => `${i + 1}\n${ts(a).replace(".", ",")}0 --> ${ts(b).replace(".", ",")}0\n${text}\n`).join("\n"));

// 4. 右上の判子、声と音楽を重ねて書き出す
const stamp = path.join(repo, "app/icon-192.png");
const vin = ["-i", joined, "-i", stamp]; const ain = []; const achains = []; const mix = ["[0:a]"]; let n = 2;
voices.forEach(([f, at], i) => { ain.push("-i", f); achains.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)}[v${i}]`); mix.push(`[v${i}]`); n++; });
let bgmChain = "";
if (bgm) { ain.push("-stream_loop", "-1", "-i", bgm); bgmChain = `;[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${t},volume=${E.bgmVolume ?? 0.18},afade=t=in:d=2,afade=t=out:st=${t - 3}:d=3[bgm];[mixed]asplit[m1][m2];[bgm][m2]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=900:makeup=1[duck];[m1][duck]amix=inputs=2:duration=first:normalize=0[a]`; }
const fc = [...achains, `${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0[${bgm ? "mixed" : "a"}]`].join(";") + bgmChain +
  `;[1:v]scale=64:64,format=rgba,colorchannelmixer=aa=0.55[st];[0:v][st]overlay=W-64-40:H-${BAND}+58[v0];[v0]ass='${assFile.replace(/'/g, "\\'")}'[v]`;
ff([...vin, ...ain, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outFile]);
const ad = probe(outFile, "a", "stream=duration");
console.log("→", outFile, `${(fs.statSync(outFile).size / 1e6).toFixed(1)}MB  映像 ${t.toFixed(1)}s / 音 ${Number(ad).toFixed(1)}s`);
