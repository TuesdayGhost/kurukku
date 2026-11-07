// 全面再構築版の組み立て（帯なし・1920×1080 いっぱい）。edit2.json の区間を並べ、区間ごとに overlays（透明PNGのコマ列）を重ね、
// クロスフェードでつなぎ、声と音楽を重ねる。先に render-inserts.mjs と render-overlays.mjs を走らせておく。
// 実行：node tools/demo-video/assemble2.mjs <素材フォルダ> <出力mp4> [--bgm 音楽.wav] [--edit edit2.json]
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2); const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const bgm = opt("--bgm", null); const editFile = opt("--edit", "edit2.json");
const srcDir = path.resolve(argv[0]); const outFile = path.resolve(argv[1]);
const work = path.join(repo, "tools/demo-video/out/work2"); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
const E = JSON.parse(fs.readFileSync(path.join(repo, "tools/demo-video", editFile), "utf8"));
const { fps, width: W, height: H } = E; const bg = E.bg.replace("#", "0x"); const XF = E.crossfade ?? 0.4;
const ovId = (o) => crypto.createHash("md5").update(JSON.stringify({ ...o, at: 0 })).digest("hex").slice(0, 10);
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const probe = (f, sel, key) => execFileSync("ffprobe", ["-v", "error", ...(sel ? ["-select_streams", sel] : []), "-show_entries", key, "-of", "csv=p=0", f]).toString().trim();
const find = (stem) => { const files = fs.readdirSync(srcDir).filter((f) => f.startsWith(stem)).sort(); return files.length ? path.join(srcDir, files[0]) : null; };
const resolveSrc = (s) => s.startsWith("insert:") ? path.join(repo, "tools/demo-video/out/inserts", s.slice(7) + ".mp4") : s.startsWith("docs/") || s.startsWith("app/") || s.startsWith("tools/") ? path.join(repo, s) : find(s) || find(s.replace(/\.\w+$/, ""));
const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;

// 映像を枠に収める。fit=cover は枠いっぱいに切る、contain はぼかした背景の上に置く。box は {x,y,w,h} で枠の中の一部に置く
function fitChain(label, box, fit, zoom, dur) {
  const { w, h } = box;
  const z = zoom ? `,zoompan=z='min(1+(${zoom.to}-1)*on/${Math.round(dur * fps)},${zoom.to})':x='iw/2-(iw/zoom/2)+(${zoom.cx ?? 0.5}-0.5)*iw/zoom':y='ih/2-(ih/zoom/2)+(${zoom.cy ?? 0.5}-0.5)*ih/zoom':d=1:s=${w}x${h}:fps=${fps}` : "";
  if (fit === "blur") return `[${label}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=40,eq=brightness=0.04:saturation=0.7[${label}out]`;
  if (fit === "cover") return `[${label}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}${z}[${label}out]`;
  return `[${label}]split=2[${label}a][${label}b];[${label}a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=30,eq=brightness=-0.06:saturation=0.85[${label}bg];` +
    `[${label}b]scale=${w}:${h}:force_original_aspect_ratio=decrease[${label}fg];[${label}bg][${label}fg]overlay=(W-w)/2:(H-h)/2:format=auto${z}[${label}out]`;
}

const parts = []; let t = 0; const voices = []; const missing = [];
for (const [i, s] of E.segments.entries()) {
  const out = path.join(work, `p${String(i).padStart(2, "0")}.mp4`);
  const layers = s.layers || [{ src: s.src, in: s.in, fit: s.fit, zoom: s.zoom, speed: s.speed, keepAudio: s.keepAudio, gain: s.gain }];
  const inputs = ["-f", "lavfi", "-i", `color=c=${s.bg ? s.bg.replace("#", "0x") : bg}:s=${W}x${H}:r=${fps}`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  let chain = []; let cur = "0:v"; let aud = `[1:a]atrim=0:${s.dur},asetpts=PTS-STARTPTS[a]`; let n = 2;
  for (const [j, L] of layers.entries()) {
    const src = resolveSrc(L.src); const ok = src && fs.existsSync(src); if (!ok) { missing.push(L.src); continue; }
    const box = L.box || { x: 0, y: 0, w: W, h: H }; const isImage = /\.(png|jpg|jpeg)$/i.test(src);
    if (isImage) inputs.push("-loop", "1", "-i", src); else inputs.push("-ss", String(L.in || 0), "-i", src);
    const sp = L.speed || 1; const lbl = `L${j}`;
    chain.push(`[${n}:v]${isImage ? "" : `setpts=PTS/${sp},`}fps=${fps},tpad=stop_mode=clone:stop_duration=${s.dur},trim=0:${s.dur},setpts=PTS-STARTPTS[${lbl}]`, fitChain(lbl, box, L.fit || (isImage ? "contain" : "contain"), L.zoom, s.dur));
    const alpha = L.fadeIn ? `,fade=t=in:st=0:d=${L.fadeIn}:alpha=1` : "";
    chain.push(`[${lbl}out]format=rgba${alpha}[${lbl}f]`, `[${cur}][${lbl}f]overlay=${box.x}:${box.y}:eof_action=pass${L.at ? `:enable='gte(t,${L.at})'` : ""}[v${j}]`); cur = `v${j}`;
    if (L.keepAudio && !isImage && probe(src, "a", "stream=codec_type").includes("audio")) aud = `[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${L.gain || 0}dB,apad,atrim=0:${s.dur},asetpts=PTS-STARTPTS[a]`;
    n++;
  }
  for (const [k, o] of (s.overlays || []).entries()) {
    const dir = path.join(repo, "tools/demo-video/out/ov", ovId(o)); if (!fs.existsSync(path.join(dir, "done"))) { missing.push(`overlay:${o.text}`); continue; }
    inputs.push("-framerate", String(fps), "-i", path.join(dir, "f%04d.png"));
    chain.push(`[${n}:v]format=rgba,setpts=PTS+${o.at || 0}/TB[o${k}]`, `[${cur}][o${k}]overlay=${o.x || 0}:${o.y || 0}:eof_action=pass[ov${k}]`); cur = `ov${k}`; n++;
  }
  chain.push(`[${cur}]trim=0:${s.dur},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v]`, aud);
  ff([...inputs, "-filter_complex", chain.join(";"), "-map", "[v]", "-map", "[a]", "-t", String(s.dur), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-ar", "48000", out]);
  parts.push({ out, dur: s.dur, xf: s.xf ?? XF });
  const start = i === 0 ? 0 : t - parts[i - 1].xf; t = start + s.dur;
  for (const [stem, at] of s.voice || []) { const f = find(stem); if (f) voices.push([f, start + at]); else missing.push(stem); }
  console.log(`${String(i).padStart(2)} ${fmt(start)}  ${s.name}  (${s.dur}s)`);
}
console.log(`合計 ${fmt(t)}（${t.toFixed(1)}秒）`); if (missing.length) console.log("見つからない素材:", [...new Set(missing)].join(", "));

const inputs = parts.flatMap((p) => ["-i", p.out]); const chains = []; let vcur = "0:v", acur = "0:a", off = 0;
for (let i = 1; i < parts.length; i++) {
  const xf = parts[i - 1].xf; off += parts[i - 1].dur - xf;
  chains.push(`[${vcur}][${i}:v]xfade=transition=fade:duration=${xf}:offset=${off.toFixed(3)}[v${i}]`, `[${acur}][${i}:a]acrossfade=d=${xf}:c1=tri:c2=tri[a${i}]`); vcur = `v${i}`; acur = `a${i}`;
}
const joined = path.join(work, "joined.mp4");
ff([...inputs, "-filter_complex", chains.join(";"), "-map", `[${vcur}]`, "-map", `[${acur}]`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", joined]);

const vin = ["-i", joined]; const ain = []; const achains = []; const mix = ["[0:a]"]; let n = 1;
voices.forEach(([f, at], i) => { ain.push("-i", f); achains.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)}[v${i}]`); mix.push(`[v${i}]`); n++; });
let bgmChain = "";
if (bgm) { ain.push("-stream_loop", "-1", "-i", bgm); bgmChain = `;[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${t},volume=${E.bgmVolume ?? 0.16},afade=t=in:d=2,afade=t=out:st=${t - 3}:d=3[bgm];[mixed]asplit[m1][m2];[bgm][m2]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=900:makeup=1[duck];[m1][duck]amix=inputs=2:duration=first:normalize=0[a]`; }
const fc = [...achains, `${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0[${bgm ? "mixed" : "a"}]`].join(";") + bgmChain;
ff([...vin, ...ain, "-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outFile]);
console.log("→", outFile, `${(fs.statSync(outFile).size / 1e6).toFixed(1)}MB  映像 ${t.toFixed(1)}s / 音 ${Number(probe(outFile, "a", "stream=duration")).toFixed(1)}s`);
