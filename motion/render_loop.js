#!/usr/bin/env node
// Stage-visual loop renderer (Motion Graphics & Video Synthesis Division).
//
// Reads a loop spec (see loop_spec.example.json), computes a frame-exact
// rotation of Main logo / Kalantara / tiered sponsor slides, renders it with
// ffmpeg cross-fades into a seamless infinite loop, and verifies the seam.
//
//   node motion/render_loop.js <spec.json> --plan            # timing table only, no rendering
//   node motion/render_loop.js <spec.json> --placeholders    # render with labelled placeholder cards
//   node motion/render_loop.js <spec.json> --scale 0.25      # quick low-res preview
//   node motion/render_loop.js <spec.json> --formats prores,mp4,hap
//
// Seamless-loop method: render slides S0..Sn-1 plus a second copy of S0, with
// a cross-fade between each. Then cut exactly one period P out of that chain,
// starting d frames into S0 (d = transition length). The frame after the last
// output frame is then identical to the first one, so the file loops with no
// visible seam. The renderer checks this with PSNR after every render.
//
// Screen-time accounting: a slide "owns" the screen from the midpoint of its
// incoming transition to the midpoint of its outgoing one. The owned times of
// all slides add up to the loop period exactly.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TRANSITIONS = new Set(['fade', 'fadeblack', 'fadewhite', 'dissolve', 'pixelize', 'radial', 'circleopen', 'circleclose',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'hblur', 'fadegrays', 'distance']);

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const VALUED = new Set(['--scale', '--formats', '--out', '--name']);
const specPath = argv.find((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1])) || 'motion/loop_spec.json';

function fail(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

// ---------- plan ----------
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function tc(frames, fps) {
  const s = Math.floor(frames / fps), f = frames % fps;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

function buildPlan(spec) {
  const errors = [];
  const fps = spec.canvas?.fps;
  if (!Number.isInteger(fps) || fps <= 0) errors.push('canvas.fps must be a positive integer (e.g. 50 or 60)');
  const P = Math.round((spec.loop?.seconds || 0) * fps);
  const d = Math.round((spec.transition?.seconds || 0) * fps);
  const cycles = spec.cycles || 2;
  const alloc = spec.allocation || {};
  const sum = (alloc.main || 0) + (alloc.kalantara || 0) + (alloc.sponsors || 0);
  if (Math.abs(sum - 1) > 1e-6) errors.push(`allocation must add up to 1.0 (got ${sum})`);
  if (d < Math.round(0.4 * fps)) errors.push('transition.seconds must be at least 0.4 s (no hard cuts or flash-like changes on LED walls)');
  if (!spec.elements?.main?.file || !spec.elements?.kalantara?.file) errors.push('elements.main.file and elements.kalantara.file are required');
  const tiers = spec.sponsorTiers || [];
  if (errors.length) fail('Spec errors:\n  - ' + errors.join('\n  - '));

  // Sponsor entries and how many sponsor blocks each appears in.
  const blocks = 2 * cycles;
  const entries = [];
  tiers.forEach((t, ti) => {
    const dfltApps = ti === 0 ? blocks : ti === 1 ? Math.ceil(blocks / 2) : 1;
    const apps = Math.min(blocks, Math.max(1, t.appearances || dfltApps));
    (t.sponsors || []).forEach((s, j) => entries.push({ ...s, tier: t.tier, tierRank: ti, weight: t.weight, apps, j }));
  });
  const blockSlides = Array.from({ length: blocks }, () => []);
  for (const e of entries) {
    const stride = blocks / e.apps;
    for (let k = 0; k < e.apps; k++) blockSlides[(Math.floor(k * stride) + e.j) % blocks].push(e);
  }
  for (const b of blockSlides) b.sort((x, y) => x.tierRank - y.tierRank || x.j - y.j);

  // Exact (fractional) owned time per slide, then largest-remainder rounding to whole frames.
  const wsum = entries.reduce((n, e) => n + e.weight, 0);
  const slides = [];
  for (let c = 0; c < cycles; c++) {
    slides.push({ cat: 'main', name: spec.elements.main.name || 'Resonance of Indonesia (main logo)', file: spec.elements.main.file, exact: (P * alloc.main) / cycles });
    for (const e of blockSlides[2 * c]) slides.push({ cat: 'sponsor', tier: e.tier, name: e.name, file: e.file, exact: (P * alloc.sponsors * e.weight) / wsum / e.apps });
    slides.push({ cat: 'kalantara', name: spec.elements.kalantara.name || 'Kalantara (theme identity)', file: spec.elements.kalantara.file, exact: (P * alloc.kalantara) / cycles });
    for (const e of blockSlides[2 * c + 1]) slides.push({ cat: 'sponsor', tier: e.tier, name: e.name, file: e.file, exact: (P * alloc.sponsors * e.weight) / wsum / e.apps });
  }
  if (!entries.length) { // no sponsors yet: main and Kalantara share the whole loop in their ratio
    const tot = slides.reduce((n, s) => n + s.exact, 0);
    for (const s of slides) s.exact *= P / tot;
  }
  for (const s of slides) s.frames = Math.floor(s.exact);
  let rest = P - slides.reduce((n, s) => n + s.frames, 0);
  [...slides].sort((a, b) => (b.exact % 1) - (a.exact % 1)).slice(0, rest).forEach((s) => s.frames++);

  const minOwned = Math.max(Math.round((spec.minHoldSeconds || 3) * fps), d + 1);
  const tooShort = slides.filter((s) => s.frames < minOwned);
  if (tooShort.length) {
    fail(`${tooShort.length} slide(s) would be on screen for less than the minimum hold (${(minOwned / fps).toFixed(2)} s), e.g. "${tooShort[0].name}" at ${(tooShort[0].frames / fps).toFixed(2)} s.\n` +
      '  Fix: lengthen loop.seconds, reduce cycles, raise the sponsors share, or group lower-tier logos onto shared boards.');
  }
  let t = 0;
  const mod = (n) => ((n % P) + P) % P;
  for (const s of slides) {
    s.start = t; t += s.frames; s.clip = s.frames + d;
    // Times in the rendered file (which begins d frames into the first slide):
    s.fileFadeIn = mod(s.start - d);                 // incoming transition begins
    s.fileOwned = mod(s.start - Math.floor(d / 2));  // slide takes over (transition midpoint)
  }
  return { fps, P, d, slides, cycles, alloc };
}

function printPlan(plan, spec) {
  const { fps, P, d, slides } = plan;
  console.log(`\nLoop: ${(P / fps).toFixed(2)} s = ${P} frames @ ${fps} fps · transition ${spec.transition.type || 'fade'} ${(d / fps).toFixed(2)} s (${d} f) · ${slides.length} slides`);
  console.log('\n #  plan start   in file*     owned            category         name');
  slides.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}  ${tc(s.start, fps)}  ${tc(s.fileOwned, fps)}  ${(s.frames / fps).toFixed(2).padStart(6)} s ${String(s.frames).padStart(5)} f  ${(s.cat + (s.tier ? '/' + s.tier : '')).padEnd(16)} ${s.name}`));
  console.log('  * timecode in the rendered file where the slide takes over the screen (transition midpoint)');
  const by = (pred) => slides.filter(pred).reduce((n, s) => n + s.frames, 0);
  console.log('\nScreen-time totals (target → actual):');
  for (const cat of ['main', 'kalantara', 'sponsors']) {
    const actual = by((s) => (cat === 'sponsors' ? s.cat === 'sponsor' : s.cat === cat));
    const target = P * (plan.alloc[cat] || 0);
    console.log(`  ${cat.padEnd(10)} ${(target / fps).toFixed(2).padStart(7)} s → ${(actual / fps).toFixed(2).padStart(7)} s  (${((actual / P) * 100).toFixed(2)}%, ${actual - Math.round(target) >= 0 ? '+' : ''}${actual - Math.round(target)} f)`);
  }
  const tiers = [...new Set(slides.filter((s) => s.tier).map((s) => s.tier))];
  for (const tier of tiers) {
    const names = [...new Set(slides.filter((s) => s.tier === tier).map((s) => s.name))];
    for (const n of names) {
      const own = slides.filter((s) => s.name === n && s.tier === tier);
      console.log(`  ${('· ' + tier).padEnd(10)} ${(own.reduce((x, s) => x + s.frames, 0) / fps).toFixed(2).padStart(7)} s  ×${own.length}  ${n}`);
    }
  }
  console.log(`  ${'total'.padEnd(10)} ${(by(() => true) / fps).toFixed(2).padStart(7)} s  (must equal loop: ${by(() => true) === P ? 'OK' : 'MISMATCH'})`);
}

function writeCsv(plan, file) {
  const rows = [['index', 'plan_start_timecode', 'file_fade_in_timecode', 'file_takeover_timecode', 'owned_frames', 'owned_seconds', 'category', 'tier', 'name', 'file']];
  plan.slides.forEach((s, i) => rows.push([i + 1, tc(s.start, plan.fps), tc(s.fileFadeIn, plan.fps), tc(s.fileOwned, plan.fps), s.frames, (s.frames / plan.fps).toFixed(3), s.cat, s.tier || '', s.name, s.file]));
  fs.writeFileSync(file, rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n');
}

// ---------- ffmpeg helpers ----------
function run(cmd, args, quiet = true) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) fail(`${cmd} not found. Install it first (macOS: brew install ffmpeg).`);
  if (r.status !== 0) fail(`${cmd} failed:\n${(r.stderr || '').split('\n').slice(-15).join('\n')}`);
  if (!quiet) process.stdout.write(r.stdout);
  return r;
}

function makePlaceholder(file, text, sub, w, h) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019");
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=#20283a:s=${w}x${h}`, '-vf',
    `drawbox=x=0:y=0:w=iw:h=ih:color=#8fa3c8:t=6,drawtext=text='PLACEHOLDER':fontcolor=#8fa3c8:fontsize=${Math.round(h / 9)}:x=(w-tw)/2:y=h*0.2,` +
    `drawtext=text='${esc(text)}':fontcolor=white:fontsize=${Math.round(h / 7)}:x=(w-tw)/2:y=(h-th)/2,` +
    `drawtext=text='${esc(sub)}':fontcolor=#c9d2e3:fontsize=${Math.round(h / 12)}:x=(w-tw)/2:y=h*0.72`, '-frames:v', '1', file]);
}

function imageSize(file) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return { w, h };
}

// ---------- render ----------
function render(plan, spec, opts) {
  const { fps, P, d, slides } = plan;
  const scale = Number(opts.scale || 1);
  const even4 = (n) => Math.max(16, Math.round(n / 4) * 4);
  const W = even4(spec.canvas.width * scale), H = even4(spec.canvas.height * scale);
  const safe = spec.canvas.safeArea || 0.8;
  const SW = even4(W * safe), SH = even4(H * safe);
  const bg = spec.canvas.background || '#000000';
  const formats = (opts.formats || 'prores,mp4').split(',').map((f) => f.trim()).filter(Boolean);
  const name = opts.name || slug(spec.name || path.basename(specPath, '.json'));
  const outDir = path.resolve(ROOT, opts.out || 'motion/renders');
  const workDir = path.resolve(ROOT, 'motion/work');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  // Resolve sources (or make labelled placeholder cards).
  const warnings = [];
  for (const s of slides) {
    if (opts.placeholders) {
      s.src = path.join(workDir, 'placeholders', slug(`${s.cat}_${s.tier || ''}_${s.name}`) + '.png');
      if (!fs.existsSync(s.src)) makePlaceholder(s.src, s.name, s.cat === 'sponsor' ? `Sponsor · ${s.tier}` : s.cat === 'main' ? 'Main event logo' : 'Theme identity', 1600, 600);
    } else {
      s.src = path.resolve(ROOT, s.file);
      if (!fs.existsSync(s.src)) fail(`Missing asset for "${s.name}": ${s.file}\n  (use --placeholders for a dry run before final assets exist)`);
      if (/\.(png|jpe?g|tiff?|webp)$/i.test(s.src)) {
        const { w, h } = imageSize(s.src);
        const fit = Math.min(SW / w, SH / h);
        if (fit > 1.001) warnings.push(`"${s.name}" is ${w}x${h}; it will be upscaled ×${fit.toFixed(2)} to fill the safe area. Ask the Designer for a larger master.`);
      }
    }
  }

  const all = [...slides, { ...slides[0], copy: true }]; // S0 again at the end, for the seamless wrap
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const s of all) {
    if (/\.(mov|mp4|mkv|webm)$/i.test(s.src)) args.push('-stream_loop', '-1', '-i', s.src);
    else args.push('-loop', '1', '-framerate', String(fps), '-i', s.src);
  }
  const g = [];
  all.forEach((s, i) => {
    g.push(`color=c=${bg}:s=${W}x${H}:r=${fps},trim=end_frame=${s.clip}[bg${i}]`);
    g.push(`[${i}:v]fps=${fps},scale=${SW}:${SH}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba[lg${i}]`);
    g.push(`[bg${i}][lg${i}]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv444p,setsar=1,trim=end_frame=${s.clip},setpts=PTS-STARTPTS[s${i}]`);
  });
  const trFor = (s) => {
    const t = (spec.transition.byCategory || {})[s.cat] || spec.transition.type || 'fade';
    if (!TRANSITIONS.has(t)) fail(`Unknown transition "${t}". Use one of: ${[...TRANSITIONS].join(', ')}`);
    return t;
  };
  let cur = 's0', acc = all[0].clip;
  for (let k = 1; k < all.length; k++) {
    const offset = ((acc - d) / fps).toFixed(6);
    g.push(`[${cur}][s${k}]xfade=transition=${trFor(all[k])}:duration=${(d / fps).toFixed(6)}:offset=${offset}[x${k}]`);
    acc += all[k].clip - d;
    cur = `x${k}`;
  }
  const a = d; // cut point: d frames into S0, clear of both fades
  g.push(`[${cur}]split=${formats.length + 1}${formats.map((_, i) => `[o${i}]`).join('')}[chk]`);
  formats.forEach((_, i) => g.push(`[o${i}]trim=start_frame=${a}:end_frame=${a + P},setpts=PTS-STARTPTS[out${i}]`));
  g.push(`[chk]select='eq(n\\,${a})+eq(n\\,${a + P})',setpts=N/(${fps}*TB)[seam]`);
  args.push('-filter_complex', g.join(';'));
  const outputs = [];
  formats.forEach((f, i) => {
    const base = path.join(outDir, `${name}_${W}x${H}_${fps}p`);
    if (f === 'prores') { outputs.push(base + '_prores422hq.mov'); args.push('-map', `[out${i}]`, '-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', '-r', String(fps), outputs.at(-1)); }
    else if (f === 'mp4') { outputs.push(base + '_h264.mp4'); args.push('-map', `[out${i}]`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(fps), '-r', String(fps), '-movflags', '+faststart', outputs.at(-1)); }
    else if (f === 'hap') { outputs.push(base + '_hapq.mov'); args.push('-map', `[out${i}]`, '-c:v', 'hap', '-format', 'hap_q', '-r', String(fps), outputs.at(-1)); }
    else fail(`Unknown format "${f}" (use prores, mp4, hap)`);
  });
  const seamPattern = path.join(workDir, 'seam_%d.png');
  args.push('-map', '[seam]', '-frames:v', '2', '-fps_mode', 'passthrough', seamPattern);

  console.log(`\nRendering ${W}x${H} @ ${fps} fps → ${formats.join(', ')} …`);
  const t0 = Date.now();
  run('ffmpeg', args);
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // ---------- QA ----------
  const qa = [];
  const psnr = spawnSync('ffmpeg', ['-hide_banner', '-i', path.join(workDir, 'seam_1.png'), '-i', path.join(workDir, 'seam_2.png'), '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /average:(inf|[\d.]+)/.exec(psnr.stderr || '');
  const seamDb = m ? (m[1] === 'inf' ? Infinity : Number(m[1])) : NaN;
  qa.push({ check: 'Seam: frame after the last frame equals the first frame', pass: seamDb === Infinity || seamDb > 60, detail: `PSNR ${seamDb === Infinity ? '∞ (identical)' : seamDb.toFixed(1) + ' dB'}` });
  for (const out of outputs) {
    const pr = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_packets,pix_fmt', '-of', 'json', out]);
    const st = JSON.parse(pr.stdout).streams[0];
    const frames = Number(st.nb_read_packets);
    qa.push({ check: `${path.basename(out)}: ${st.codec_name} ${st.pix_fmt}`, pass: st.width === W && st.height === H && st.r_frame_rate === `${fps}/1` && frames === P,
      detail: `${st.width}x${st.height}, ${st.r_frame_rate} fps, ${frames} frames (expected ${P})` });
  }
  qa.push({ check: 'Screen time adds up to the loop period exactly', pass: slides.reduce((n, s) => n + s.frames, 0) === P, detail: `${P} frames` });
  writeCsv(plan, path.join(outDir, `${name}_timing.csv`));
  const report = [`# QA report: ${name}`, '', `Spec: ${specPath}${opts.placeholders ? ' (PLACEHOLDER render, not for show use)' : ''}`, `Rendered: ${new Date().toISOString()}`, '',
    '| Check | Result | Detail |', '|---|---|---|', ...qa.map((q) => `| ${q.check} | ${q.pass ? 'PASS' : 'FAIL'} | ${q.detail} |`),
    ...(warnings.length ? ['', '## Warnings', ...warnings.map((w) => `- ${w}`)] : []), '', `Timing table: ${name}_timing.csv`, ''].join('\n');
  fs.writeFileSync(path.join(outDir, `${name}_qa.md`), report);
  console.log('\nQA:');
  for (const q of qa) console.log(`  ${q.pass ? '✔' : '✖'} ${q.check} (${q.detail})`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  console.log(`\nOutputs in ${path.relative(ROOT, outDir)}/: ${outputs.map((o) => path.basename(o)).join(', ')}, ${name}_timing.csv, ${name}_qa.md`);
  if (qa.some((q) => !q.pass)) process.exit(2);
}

// ---------- main ----------
const specFile = path.resolve(ROOT, specPath);
if (!fs.existsSync(specFile)) fail(`Spec not found: ${specPath}. Start from motion/loop_spec.example.json.`);
let spec;
try { spec = JSON.parse(fs.readFileSync(specFile, 'utf8')); } catch (e) { fail(`Spec is not valid JSON: ${e.message}`); }
const plan = buildPlan(spec);
printPlan(plan, spec);
if (flag('--plan')) process.exit(0);
render(plan, spec, { placeholders: flag('--placeholders'), scale: opt('--scale'), formats: opt('--formats'), out: opt('--out'), name: opt('--name') });
