// Photo editor page and routes: title, in-rotation flag, and the photo's framing and
// tone. Like a phone's crop tool, the frame stays put (shaped like the target panel's
// photo area, rounded on the 3.98") and the photo moves, zooms and rotates under it.
// Live dithered previews of both panels. Edits are stored per photo and applied at
// render time (non-destructive).
import type { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Db } from "../db.js";
import { getPhotoInfo, loadPhoto, updatePhoto, getPhotoStyle, EDIT_RANGES, DEFAULT_EDITS } from "../data/photos.js";
import { rotate, coverResize } from "../render/image.js";
import { rgbPng } from "../render/pack.js";
import { PANELS } from "../panels.js";
import { photoArea } from "../screens/photo.js";

export function photoEditorRoutes(app: Hono, db: Db): void {
  // Rotated source, downscaled for the editor view.
  app.get("/photos/:id/source.png", (c) => {
    const p = loadPhoto(db, Number(c.req.param("id")));
    if (!p) return c.notFound();
    const img = rotate(p.image, Number(c.req.query("rotate") ?? 0) | 0);
    const k = Math.min(1, (c.req.query("thumb") ? 200 : 900) / Math.max(img.width, img.height)); // ?thumb: small, for pickers
    const out = k < 1 ? coverResize(img, Math.round(img.width * k), Math.round(img.height * k)) : img;
    return c.body(rgbPng(out) as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
  });

  app.post("/admin/photos/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!getPhotoInfo(db, id)) return c.json({ error: "没有这张照片" }, 404);
    const b = await c.req.json().catch(() => ({})) as { title?: unknown; enabled?: unknown; edits?: unknown };
    updatePhoto(db, id, {
      title: typeof b.title === "string" ? b.title : undefined,
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      edits: b.edits,
    });
    return c.json({ ok: true });
  });

  app.get("/photos/:id/edit", (c) => {
    const p = getPhotoInfo(db, Number(c.req.param("id")));
    if (!p) return c.notFound();
    const panels = [PANELS.se0398, PANELS.hink42_bwr];
    // the frame shape to edit for (each screen chooses its style in 内容 → 相框)
    const style = c.req.query("style") === "full" || c.req.query("style") === "frame" ? c.req.query("style") as "full" | "frame" : getPhotoStyle(db);
    // the frame shapes: each panel's photo area in the current style (see screens/photo.ts)
    const targets = panels.map((pn) => {
      const a = photoArea(pn, style);
      return { id: pn.id, name: `${pn.name.split(" ")[0]} ${style === "frame" ? "画框" : "满屏"}`, aspect: a.w / a.h, radius: a.radius / a.w };
    });
    const sliders = Object.entries(EDIT_RANGES).map(([k, r]) => html`<label class="slider">
        <span>${r.label}</span><input type="range" name="${k}" min="${r.min}" max="${r.max}" step="${r.step}">
        <output id="o-${k}"></output></label>`);
    const state = JSON.stringify({ id: p.id, title: p.title, enabled: p.enabled, edits: p.edits, defaults: DEFAULT_EDITS, targets });
    return c.html(html`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>编辑照片</title>
<style>
  :root { color-scheme: light dark; --fg:#1d1d1f; --bg:#fafaf7; --mute:#6b6b6b; --line:#e2e0d8; --acc:#b3342f; }
  @media (prefers-color-scheme: dark) { :root { --fg:#ecebe6; --bg:#17171a; --mute:#9a9a9a; --line:#2c2c30; } }
  body { margin:0; padding:16px; font:14px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; color:var(--fg); background:var(--bg); }
  h1 { font-size:20px; margin:0 0 12px } a { color:inherit }
  .layout { display:grid; grid-template-columns:minmax(0,3fr) minmax(260px,2fr); gap:24px; align-items:start }
  @media (max-width:760px) { .layout { grid-template-columns:1fr } }
  .stage { position:relative; overflow:hidden; width:100%; height:min(62vh, 560px); touch-action:none; user-select:none;
           border-radius:8px; background:#dcd7cb; cursor:grab }
  .stage.dragging { cursor:grabbing }
  .stage img { position:absolute; display:block; max-width:none; pointer-events:none }
  .frame { position:absolute; pointer-events:none; box-shadow:0 0 0 1px #fffc, 0 0 0 9999px #000a }
  .frame::before, .frame::after { content:""; position:absolute; inset:33.33% 0; border-top:1px solid #fff5; border-bottom:1px solid #fff5 }
  .frame::after { inset:0 33.33%; border:0; border-left:1px solid #fff5; border-right:1px solid #fff5 }
  .guide { position:absolute; pointer-events:none; border:1px dashed #ffffffb0 }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0 }
  button, select, input[type=text] { font:inherit; padding:7px 12px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--fg) }
  button { cursor:pointer } button.primary { background:var(--fg); color:var(--bg); border-color:var(--fg) }
  input[type=text] { flex:1; min-width:0 }
  .slider { display:grid; grid-template-columns:7.5em 1fr 3.5em; gap:8px; align-items:center; margin:6px 0 }
  .slider output { text-align:right; font-variant-numeric:tabular-nums; color:var(--mute) }
  input[type=range] { width:100%; accent-color:var(--acc) }
  fieldset { border:1px solid var(--line); border-radius:10px; padding:8px 14px 12px; margin:0 0 14px } legend { color:var(--mute); padding:0 6px }
  .previews { display:flex; flex-wrap:wrap; gap:16px; margin-top:16px } .previews figure { margin:0 }
  .previews img { image-rendering:pixelated; border:1px solid var(--line); max-width:100% }
  figcaption, .note { color:var(--mute); font-size:12px } #status { color:var(--mute) }
</style></head><body>
<h1><a href="/photos">← 相册</a>　编辑照片</h1>
<div class="layout">
  <div>
    <div class="stage" id="stage"><img id="src" alt="照片"><div class="guide" id="guide"></div><div class="frame" id="frame"></div></div>
    <div class="row">
      <button id="rotl" title="逆时针旋转 90°">⟲ 左转</button><button id="rotr" title="顺时针旋转 90°">⟳ 右转</button>
      <button id="cover" title="照片铺满画框">铺满</button><button id="contain" title="整张照片放进画框，空白处留白">完整显示</button>
      <select id="target" title="按哪块屏的画框取景">${targets.map((t) => html`<option value="${t.id}">按 ${t.name} 取景</option>`)}</select>
    </div>
    <label class="slider"><span>缩放</span><input type="range" id="zoom" min="-100" max="150" step="1"><output id="o-zoom"></output></label>
    <p class="note">画框固定，拖动照片移动；滚轮、双指捏合或"缩放"滑块放大缩小（1.00× = 刚好铺满）。超出照片的部分在屏上是纸白色。
    虚线是另一块屏能看到的范围。处理顺序：旋转 → 裁剪 → 缩放 → 调色 → 锐化 → 抖动。</p>
  </div>
  <div>
    <fieldset><legend>信息</legend>
      <div class="row"><input type="text" id="title" maxlength="40" placeholder="标题"></div>
    </fieldset>
    <fieldset><legend>调整</legend>${sliders}
      <div class="row"><button id="reset">恢复默认</button></div>
    </fieldset>
    <div class="row"><button class="primary" id="save">保存</button><span id="status"></span></div>
  </div>
</div>
<div class="previews">${panels.map((pn) => html`<figure><img id="pv-${pn.id}" width="${pn.width < 600 ? pn.width * 2 : pn.width}" alt="${pn.name}">
  <figcaption>${pn.name} 抖动预览（${style === "frame" ? "画框" : "满屏"}样式，<a href="?style=${style === "frame" ? "full" : "frame"}">看${style === "frame" ? "满屏" : "画框"}</a>）</figcaption></figure>`)}</div>
<script>
const S = ${raw(state.replace(/</g, "\\u003c"))};
const PANELS = ${raw(JSON.stringify(panels.map((pn) => ({ id: pn.id, scale: pn.width < 600 ? 2 : 1 }))))};
${raw(EDITOR_JS)}
</script>
</body></html>`);
  });
}

// Client script (plain JS, no template placeholders inside).
const EDITOR_JS = String.raw`
let e = JSON.parse(JSON.stringify(S.edits));
const $ = (id) => document.getElementById(id);
const img = $('src'), frame = $('frame'), guide = $('guide'), stage = $('stage');
$('title').value = S.title;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── tone sliders ──
const sliders = [...document.querySelectorAll('.slider input[name]')];
const fmt = (k, v) => k === 'brightness' ? (v > 0 ? '+' : '') + v : Number(v).toFixed(2);
function syncSliders() { for (const s of sliders) { s.value = e[s.name]; $('o-' + s.name).textContent = fmt(s.name, e[s.name]); } }
for (const s of sliders) s.addEventListener('input', () => { e[s.name] = Number(s.value); $('o-' + s.name).textContent = fmt(s.name, s.value); changed(); });
$('reset').onclick = () => { for (const s of sliders) e[s.name] = S.defaults[s.name]; syncSliders(); changed(); };
$('title').oninput = changed;

// ── framing: e.crop is the frame's rectangle in fractions of the rotated photo ──
let nat = null; // rotated photo size in px (aspect is all that matters)
const target = () => S.targets.find((t) => t.id === $('target').value) || S.targets[0];
const A = () => target().aspect; // frame w/h in px
const hFor = (w) => w * nat.w / (A() * nat.h); // crop height (fraction) for a crop width at the frame's aspect
function coverW() { const w = 1; return hFor(w) <= 1 ? 1 : A() * nat.h / nat.w; } // crop width that just fills
function containW() { return hFor(1) >= 1 ? 1 : A() * nat.h / nat.w; } // crop width that shows the whole photo
function setCrop(cx, cy, w) { // keeps the frame's centre on the photo and the zoom in range
  w = clamp(w, coverW() / 8, Math.min(4, 4 * A() * nat.h / nat.w));
  const h = hFor(w);
  e.crop = { x: clamp(cx, 0, 1) - w / 2, y: clamp(cy, 0, 1) - h / 2, w, h };
}
const centre = () => [e.crop.x + e.crop.w / 2, e.crop.y + e.crop.h / 2];

function frameRect() { // the fixed frame in stage px
  const W = stage.clientWidth, H = stage.clientHeight, a = A();
  let fw = W * 0.86, fh = fw / a;
  if (fh > H * 0.86) { fh = H * 0.86; fw = fh * a; }
  return { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
}
function draw() {
  if (!nat) return;
  const F = frameRect(), k = F.w / (e.crop.w * nat.w); // stage px per photo px
  Object.assign(img.style, { left: F.x - e.crop.x * nat.w * k + 'px', top: F.y - e.crop.y * nat.h * k + 'px',
                             width: nat.w * k + 'px', height: nat.h * k + 'px' });
  Object.assign(frame.style, { left: F.x + 'px', top: F.y + 'px', width: F.w + 'px', height: F.h + 'px',
                               borderRadius: target().radius * F.w + 'px' });
  // the other panel's visible part: centre crop of this frame to its aspect
  const o = S.targets.find((t) => t !== target());
  if (o && Math.abs(o.aspect - A()) > 0.005) {
    const gw = o.aspect > A() ? F.w : F.h * o.aspect, gh = o.aspect > A() ? F.w / o.aspect : F.h;
    Object.assign(guide.style, { display: 'block', left: F.x + (F.w - gw) / 2 + 'px', top: F.y + (F.h - gh) / 2 + 'px', width: gw + 'px', height: gh + 'px' });
  } else guide.style.display = 'none';
  const z = coverW() / e.crop.w;
  $('zoom').value = clamp(Math.round(Math.log2(z) * 50), -100, 150);
  $('o-zoom').textContent = z.toFixed(2) + '×';
}
function zoomBy(f) { const [cx, cy] = centre(); setCrop(cx, cy, e.crop.w / f); draw(); changed(); }
$('zoom').oninput = () => zoomBy((e.crop.w / coverW()) * Math.pow(2, Number($('zoom').value) / 50));
// Fill the frame from where the photo is now (no re-centring): e.g. a portrait photo moved
// up or down keeps that height and goes full width; then keep the frame on the photo.
$('cover').onclick = () => {
  const [cx, cy] = centre();
  setCrop(cx, cy, coverW());
  e.crop.x = clamp(e.crop.x, Math.min(0, 1 - e.crop.w), Math.max(0, 1 - e.crop.w));
  e.crop.y = clamp(e.crop.y, Math.min(0, 1 - e.crop.h), Math.max(0, 1 - e.crop.h));
  draw(); changed();
};
$('contain').onclick = () => { setCrop(0.5, 0.5, containW()); draw(); changed(); };
$('target').onchange = () => { const [cx, cy] = centre(); setCrop(cx, cy, e.crop.w); draw(); changed(); };
stage.addEventListener('wheel', (ev) => { ev.preventDefault(); zoomBy(Math.pow(1.0015, -ev.deltaY)); }, { passive: false });
window.addEventListener('resize', draw);

let first = true;
img.onload = () => {
  nat = { w: img.naturalWidth, h: img.naturalHeight };
  const [cx, cy] = centre();
  setCrop(cx, cy, e.crop.w); // bring older / free-aspect crops to the frame's aspect
  if (first) { first = false; changed(); }
  draw();
};
function loadSource() { img.src = '/photos/' + S.id + '/source.png?rotate=' + e.rotate; }
function turn(d) { // rotate the photo under the fixed frame, keeping the same spot and zoom
  const [cx, cy] = centre(), wpx = e.crop.w * nat.w;
  const c2 = d > 0 ? [1 - cy, cx] : [cy, 1 - cx];
  nat = { w: nat.h, h: nat.w };
  setCrop(c2[0], c2[1], wpx / nat.w);
  e.rotate = (e.rotate + d + 4) % 4;
  loadSource(); changed();
}
$('rotl').onclick = () => turn(-1); $('rotr').onclick = () => turn(1);

// drag = move the photo; two fingers = pinch zoom
const pointers = new Map();
let drag = null;
const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
function startMove(x, y) { drag = { x, y, c: centre(), k: frameRect().w / (e.crop.w * nat.w) }; }
stage.addEventListener('pointerdown', (ev) => {
  if (!nat) return;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  stage.setPointerCapture(ev.pointerId); ev.preventDefault(); stage.classList.add('dragging');
  if (pointers.size === 2) drag = { pinch: dist(), c: centre(), w: e.crop.w };
  else startMove(ev.clientX, ev.clientY);
});
stage.addEventListener('pointermove', (ev) => {
  if (!drag || !pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (drag.pinch) { if (pointers.size === 2) setCrop(drag.c[0], drag.c[1], drag.w * drag.pinch / dist()); }
  else setCrop(drag.c[0] - (ev.clientX - drag.x) / (drag.k * nat.w), drag.c[1] - (ev.clientY - drag.y) / (drag.k * nat.h), e.crop.w);
  draw();
});
function endDrag(ev) {
  pointers.delete(ev.pointerId);
  if (!drag) return;
  if (pointers.size === 1) { const [p] = [...pointers.values()]; startMove(p.x, p.y); return; }
  if (pointers.size === 0) { drag = null; stage.classList.remove('dragging'); changed(); }
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// ── live previews (debounced) ──
let timer = 0;
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const q = new URLSearchParams({ screen: 'photo', photo: S.id, edits: JSON.stringify(e), title: $('title').value });
    for (const p of PANELS) $('pv-' + p.id).src = '/preview/' + p.id + '.png?scale=' + p.scale + '&' + q;
    $('status').textContent = '';
  }, 300);
}

$('save').onclick = async () => {
  $('status').textContent = '保存中…';
  const r = await fetch('/admin/photos/' + S.id, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: $('title').value, edits: e }) });
  $('status').textContent = r.ok ? '已保存，设备下次刷新时生效' : '保存失败';
};

syncSliders(); loadSource();
`;
