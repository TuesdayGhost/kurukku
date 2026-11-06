// 本番の組み立て：edit.json の編集表どおりに、素材フォルダの動画・声・差し込みをつないで mp4 にする。
// 実行：node tools/demo-video/assemble.mjs <素材フォルダ> [出力mp4]
// 素材フォルダ：V01_open.mov … N1*.wav（take 番号つきは最初に見つかったもの）… HATO_A*.mp4 …。差し込みは out/inserts/*.mp4（render-inserts.mjs で先に作る）
// 字幕は ASS で焼き込む。声は区間の開始秒に重ねる。keepAudio の素材は元の音を残す。
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.resolve(process.argv[2] || "kurukku-video");
const outFile = path.resolve(process.argv[3] || path.join(repo, "tools/demo-video/out/kurukku-demo.mp4"));
const work = path.join(repo, "tools/demo-video/out/work"); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
const E = JSON.parse(fs.readFileSync(path.join(repo, "tools/demo-video/edit.json"), "utf8"));
const { fps, width: W, height: H } = E; const bg = E.bg.replace("#", "0x");
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const find = (stem) => { const files = fs.readdirSync(srcDir).filter((f) => f.startsWith(stem)).sort(); return files.length ? path.join(srcDir, files[0]) : null; };
const resolveSrc = (s) => s.startsWith("insert:") ? path.join(repo, "tools/demo-video/out/inserts", s.slice(7) + ".mp4") : s.startsWith("docs/") ? path.join(repo, s) : find(s) || find(s.replace(/\.\w+$/, ""));
// 映像は上の 1920×900 に収め、下の 180px は字幕の帯（映像と字幕が重ならないように）
const BAND = 180;
const vf = `scale=${W}:${H - BAND}:force_original_aspect_ratio=decrease,pad=${W}:${H - BAND}:(ow-iw)/2:(oh-ih)/2:color=${bg},pad=${W}:${H}:0:0:color=0x14181c,fps=${fps},format=yuv420p,setsar=1`;

// 1. 区間ごとに同じ形（1920x1080・30fps・音あり）の中間ファイルにする
const parts = []; let t = 0; const subs = []; const voices = []; const missing = [];
for (const [i, s] of E.segments.entries()) {
  const src = resolveSrc(s.src); const out = path.join(work, `p${String(i).padStart(2, "0")}.mp4`);
  if (!src || !fs.existsSync(src)) { missing.push(s.src); }
  const isImage = src && /\.(png|jpg|jpeg)$/i.test(src);
  if (!src || !fs.existsSync(src)) {
    ff(["-f", "lavfi", "-i", `color=c=${bg}:s=${W}x${H}:r=${fps}`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(s.dur), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", out]);
  } else if (isImage) {
    ff(["-loop", "1", "-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(s.dur), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", out]);
  } else {
    // 音は必ず区間の長さぴったりにそろえる（素材の音が短くても長くても、無音で埋める／切る）
    const hasAudio = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", src]).toString().includes("audio");
    const useSrcAudio = s.keepAudio && hasAudio;
    const fc = `[0:v]${vf},tpad=stop_mode=clone:stop_duration=${s.dur},trim=0:${s.dur},setpts=PTS-STARTPTS[v];` +
      (useSrcAudio ? `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${s.dur},asetpts=PTS-STARTPTS[a]` : `[1:a]atrim=0:${s.dur},asetpts=PTS-STARTPTS[a]`);
    ff(["-ss", String(s.in || 0), "-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", String(s.dur), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-ar", "48000", out]);
  }
  parts.push(out);
  for (const [a, b, text] of s.subs || []) subs.push([t + a, t + Math.min(b, s.dur), text]);
  for (const [stem, at] of s.voice || []) { const f = find(stem); if (f) voices.push([f, t + at]); else missing.push(stem); }
  console.log(`${String(i).padStart(2)} ${fmt(t)}  ${s.name}  (${s.dur}s)${src && fs.existsSync(src) ? "" : "  ※素材なし → 地の色"}`);
  t += s.dur;
}
function fmt(x) { return `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`; }
console.log(`合計 ${fmt(t)}（${t}秒）`); if (missing.length) console.log("見つからない素材:", [...new Set(missing)].join(", "));

// 2. つなぐ
fs.writeFileSync(path.join(work, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
const joined = path.join(work, "joined.mp4");
ff(["-f", "concat", "-safe", "0", "-i", path.join(work, "list.txt"), "-c", "copy", joined]);

// 3. 字幕（ASS）
const ts = (x) => { const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = (x % 60).toFixed(2).padStart(5, "0"); return `${h}:${String(m).padStart(2, "0")}:${s}`; };
const ass = [`[Script Info]`, `ScriptType: v4.00+`, `PlayResX: ${W}`, `PlayResY: ${H}`, `WrapStyle: 2`, ``, `[V4+ Styles]`,
  `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`,
  `Style: Sub,Zen Kaku Gothic New,46,&H00FFFFFF,&H00FFFFFF,&H00141414,&H00141414,-1,0,0,0,100,100,0,0,1,0,0,2,80,80,34,1`, ``, `[Events]`, `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`,
  ...subs.map(([a, b, text]) => `Dialogue: 0,${ts(a)},${ts(b)},Sub,,0,0,0,,${text.replace(/\n/g, "\\N")}`)].join("\n");
const assFile = path.join(work, "subs.ass"); fs.writeFileSync(assFile, ass);
fs.writeFileSync(outFile.replace(/\.mp4$/, ".srt"), subs.map(([a, b, text], i) => `${i + 1}\n${ts(a).replace(".", ",")}0 --> ${ts(b).replace(".", ",")}0\n${text}\n`).join("\n"));

// 4. 声を重ねて書き出す
const inputs = ["-i", joined]; const chains = []; const mix = ["[0:a]"];
voices.forEach(([f, at], i) => { inputs.push("-i", f); chains.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)}[v${i}]`); mix.push(`[v${i}]`); });
const fc = [...chains, `${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0[a]`, `[0:v]ass='${assFile.replace(/'/g, "\\'")}'[v]`].join(";");
ff([...inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outFile]);
const ad = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=duration", "-of", "csv=p=0", outFile]).toString().trim();
console.log("→", outFile, `${(fs.statSync(outFile).size / 1e6).toFixed(1)}MB  映像 ${t}s / 音 ${Number(ad).toFixed(1)}s`);
