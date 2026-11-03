// 프레임 검사·공유용 스틸·영상 프레임 추출 도구
//   node tools/capture.mjs stills  <outDir> <w> t1 t2 ...      지정 시각의 스틸 PNG
//   node tools/capture.mjs sheet   <outPng> <w> t0 dt n cols   연속 프레임 콘택트 시트
//   node tools/capture.mjs frames  <outDir> <w> fps            전 구간 프레임 (영상용)
//   node tools/capture.mjs wav     <outWav>                    합성 사운드 WAV
// PLAYWRIGHT_CORE 환경 변수로 playwright-core 경로를 바꿀 수 있다.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = require(pwPath);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, out, ...rest] = process.argv.slice(2);
if (!mode || !out) { console.error('usage: capture.mjs <stills|sheet|frames|wav> <out> ...'); process.exit(2); }

const w = mode === 'wav' ? 640 : +rest[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', e => { console.error('[pageerror]', e.message); });
const url = pathToFileURL(resolve(root, 'index.html')).href + `?w=${w}`;
await page.goto(url);
await page.evaluate(() => window.SEOL.ready);
const shot = t => page.evaluate(t => { window.SEOL.renderAt(t); return document.getElementById('view').toDataURL('image/png'); }, t);
const save = (p, data) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, Buffer.from(data.split(',')[1], 'base64')); };

if (mode === 'stills') {
  for (const t of rest.slice(1).map(Number)) { const p = resolve(out, `t${t.toFixed(2).padStart(5, '0')}.png`); save(p, await shot(t)); console.log(p); }
} else if (mode === 'sheet') {
  // 선택 인자 crop: x y w h (1920×1080 기준 좌표) — 작은 인물의 다리를 확대해 보기 위함
  const [, t0, dt, n, cols, ...crop] = rest.map(Number);
  const data = await page.evaluate(({ t0, dt, n, cols, crop }) => {
    const v = document.getElementById('view'), k = v.width / 1920;
    const [sx, sy, sw, sh] = crop.length === 4 ? crop.map(q => q * k) : [0, 0, v.width, v.height];
    const cw = crop.length === 4 ? sw : v.width / 2, ch = crop.length === 4 ? sh : v.height / 2, rows = Math.ceil(n / cols);
    const s = document.createElement('canvas'); s.width = cw * cols; s.height = ch * rows; const c = s.getContext('2d');
    c.font = '20px sans-serif'; c.fillStyle = '#c00';
    for (let i = 0; i < n; i++) { const t = t0 + dt * i; window.SEOL.renderAt(t); const x = (i % cols) * cw, y = Math.floor(i / cols) * ch; c.drawImage(v, sx, sy, sw, sh, x, y, cw, ch); c.fillText(t.toFixed(3), x + 8, y + 24); }
    return s.toDataURL('image/png');
  }, { t0, dt, n, cols, crop });
  save(resolve(out), data); console.log(resolve(out));
} else if (mode === 'frames') {
  // 선택 인자: 시작·끝 프레임 번호 (일부 구간만 다시 렌더링)
  const fps = +rest[1], N = Math.round(33 * fps), i0 = rest[2] ? +rest[2] : 0, i1 = rest[3] ? Math.min(N, +rest[3]) : N;
  mkdirSync(resolve(out), { recursive: true });
  for (let i = i0; i < i1; i++) { save(resolve(out, `f${String(i).padStart(5, '0')}.png`), await shot(i / fps)); if (i % 50 === 0) console.log(`frame ${i}/${N}`); }
} else if (mode === 'eval') {
  console.log(await page.evaluate(src => String((0, eval)(src)), rest[1]));
} else if (mode === 'wav') {
  const r = await page.evaluate(async () => { const { blob, peak } = await window.SEOL.wavBlob(); const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return { b64: btoa(s), peak }; });
  mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), Buffer.from(r.b64, 'base64')); console.log(resolve(out), 'peak', r.peak.toFixed(3));
}
await browser.close();
