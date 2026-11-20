// Editor wiring: state, photo ingest, crop, ratio/layout/preset, export, debug 200px.
// A `?shot=` query sets up a fixed scene for a screenshot instead (./shots.js).
import { renderCover, renderDebug200, layoutRects, RATIOS, PRESETS, LAYOUTS, makeDemoPhoto } from './render.js';
import { runShot } from './shots.js';

const $ = (id) => document.getElementById(id);
const canvas = $('cover');
const status = $('status');

const state = {
  ratio: '1:1',
  layout: 'straddle',
  preset: 'vice',
  caption: 'SUNSET HEIST',
  kicker: 'VICE CITY',
  micro: 'A COVER MADE WITH SUNSET COVER MAKER',
  fontMode: 'auto', // auto | anton | archivo
  photos: [], // {img, name, demo}
  panels: [], // {photoIndex, scale, ox, oy} — one per layout slot, up to 4
  selected: 0,
  showSelection: false, // draw the selected panel's outline on the preview only
};

function panelCount() {
  return layoutRects(state.layout, 1080, 1080).length;
}

function ensurePanels() {
  const n = 4;
  while (state.panels.length < n) state.panels.push({ photoIndex: -1, scale: 1, ox: 0, oy: 0 });
}

function demoState() {
  ensurePanels();
  state.photos = [0, 1, 2, 3].map((s) => ({ img: makeDemoPhoto(s), name: 'demo-' + (s + 1), demo: true }));
  state.panels.forEach((p, i) => { p.photoIndex = i % 4; p.scale = 1; p.ox = 0; p.oy = 0; });
}

// The renderer's state: panels carry the resolved photo image.
function renderState() {
  return {
    ratio: state.ratio,
    layout: state.layout,
    preset: state.preset,
    caption: state.caption,
    kicker: state.kicker,
    micro: state.micro,
    fontMode: state.fontMode,
    panels: layoutRects(state.layout, 1080, 1080).map((_, i) => {
      const p = state.panels[i] || { photoIndex: -1, scale: 1, ox: 0, oy: 0 };
      const ph = state.photos[p.photoIndex];
      return { photo: ph ? ph.img : null, scale: p.scale, ox: p.ox, oy: p.oy };
    }),
  };
}

let redrawQueued = false;
function redraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    const rs = renderState();
    const out = renderCover(rs, state.ratio);
    canvas.width = out.width; canvas.height = out.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(out, 0, 0);
    // Selected panel outline (preview only, never in the export).
    if (state.showSelection) {
      const rects = layoutRects(state.layout, canvas.width, canvas.height);
      const r = rects[state.selected];
      if (r) {
        ctx.strokeStyle = '#ff7a2f';
        ctx.lineWidth = 3;
        ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
      }
    }
    renderChips();
  });
}

// Thumbnail data URL for a photo (canvas, ImageBitmap or HTMLImageElement).
function thumbURL(img) {
  if (img instanceof HTMLCanvasElement) return img.toDataURL('image/jpeg', 0.7);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const s = Math.min(1, 56 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

function renderChips() {
  const strip = $('photoStrip');
  strip.innerHTML = '';
  state.photos.forEach((ph, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (state.panels[state.selected] && state.panels[state.selected].photoIndex === i ? ' on' : '');
    const img = document.createElement('img');
    img.src = thumbURL(ph.img);
    img.alt = ph.name;
    chip.appendChild(img);
    chip.appendChild(document.createTextNode(ph.name.length > 14 ? ph.name.slice(0, 13) + '…' : ph.name));
    const x = document.createElement('button');
    x.className = 'x'; x.type = 'button'; x.textContent = '×'; x.title = 'Remove photo';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      removePhoto(i);
    });
    chip.appendChild(x);
    chip.addEventListener('click', () => assignPhoto(i));
    strip.appendChild(chip);
  });
  const sel = state.panels[state.selected];
  $('cropBox').hidden = !sel;
  if (sel) {
    $('cropName').textContent = String(state.selected + 1);
    $('zoom').value = String(sel.scale || 1);
  }
}

function assignPhoto(i) {
  ensurePanels();
  const p = state.panels[state.selected];
  p.photoIndex = i; p.scale = 1; p.ox = 0; p.oy = 0;
  redraw();
}

function removePhoto(i) {
  state.photos.splice(i, 1);
  state.panels.forEach((p) => {
    if (p.photoIndex === i) { p.photoIndex = state.photos.length ? 0 : -1; p.scale = 1; p.ox = 0; p.oy = 0; }
    else if (p.photoIndex > i) p.photoIndex -= 1;
  });
  if (!state.photos.length) demoState();
  redraw();
}

// Photo ingest: downscale on load to 2000px max, store as ImageBitmap.
async function loadPhotoFile(file) {
  const bmp = await createImageBitmap(file);
  const max = 2000;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (s >= 1) return bmp;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

async function ingestFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  ensurePanels();
  // Drop demo photos the first time real photos arrive.
  if (state.photos.every((p) => p.demo)) {
    state.photos = [];
    state.panels.forEach((p) => { p.photoIndex = -1; });
  }
  for (const file of list) {
    const img = await loadPhotoFile(file);
    const idx = state.photos.push({ img, name: file.name, demo: false }) - 1;
    // Auto-assign in order to panels, cover-fit centred.
    const slot = state.panels.findIndex((p) => p.photoIndex === -1);
    const target = slot === -1 ? state.panels.length - 1 : slot;
    state.panels[target] = { photoIndex: idx, scale: 1, ox: 0, oy: 0 };
    state.selected = target;
  }
  status.textContent = list.length + ' photo' + (list.length > 1 ? 's' : '') + ' loaded';
  redraw();
}

$('photo').addEventListener('change', (e) => ingestFiles(e.target.files));
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  $('dropLabel').classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  $('dropLabel').classList.remove('over');
}));
document.addEventListener('drop', (e) => ingestFiles(e.dataTransfer.files));

// Panel selection + crop: click to select, drag to pan, wheel to zoom.
let drag = null;
function toExport(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}
function hitPanel(p) {
  const rects = layoutRects(state.layout, canvas.width, canvas.height);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return i;
  }
  return -1;
}
canvas.addEventListener('pointerdown', (e) => {
  const p = toExport(e);
  const i = hitPanel(p);
  if (i === -1) return;
  state.selected = i;
  state.showSelection = true;
  drag = { x: p.x, y: p.y, ox: state.panels[i].ox, oy: state.panels[i].oy };
  canvas.setPointerCapture(e.pointerId);
  renderChips();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toExport(e);
  const panel = state.panels[state.selected];
  panel.ox = drag.ox + (p.x - drag.x);
  panel.oy = drag.oy + (p.y - drag.y);
  redraw();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const panel = state.panels[state.selected];
  panel.scale = Math.min(4, Math.max(1, panel.scale * (e.deltaY < 0 ? 1.08 : 0.93)));
  $('zoom').value = String(panel.scale);
  redraw();
}, { passive: false });
$('zoom').addEventListener('input', (e) => {
  state.panels[state.selected].scale = parseFloat(e.target.value);
  redraw();
});
$('resetPanel').addEventListener('click', () => {
  const p = state.panels[state.selected];
  p.scale = 1; p.ox = 0; p.oy = 0;
  $('zoom').value = '1';
  redraw();
});

// Controls: ratio, layout, preset, text.
$('ratioSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ratio]');
  if (!b) return;
  state.ratio = b.dataset.ratio;
  document.querySelectorAll('#ratioSeg button').forEach((x) => x.classList.toggle('on', x === b));
  redraw();
});
$('layoutRow').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-layout]');
  if (!b) return;
  state.layout = b.dataset.layout;
  document.querySelectorAll('#layoutRow button').forEach((x) => x.classList.toggle('on', x === b));
  state.selected = 0;
  redraw();
});
$('gradeRow').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-preset]');
  if (!b) return;
  state.preset = b.dataset.preset;
  document.querySelectorAll('#gradeRow button').forEach((x) => x.classList.toggle('on', x === b));
  redraw();
});
$('caption').addEventListener('input', (e) => { state.caption = e.target.value; redraw(); });
$('kicker').addEventListener('input', (e) => { state.kicker = e.target.value; redraw(); });
$('micro').addEventListener('input', (e) => { state.micro = e.target.value; redraw(); });
$('oneWord').addEventListener('change', (e) => {
  state.fontMode = e.target.checked ? 'archivo' : 'auto';
  redraw();
});

// Fonts: block export until the display fonts are ready.
let fontsReady = null;
function ensureFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load('400 128px Anton'),
      document.fonts.load('400 118px "Archivo Black"'),
      document.fonts.load('600 26px Manrope'),
      document.fonts.load('500 18px Manrope'),
    ]).then(() => document.fonts.ready);
  }
  return fontsReady;
}

async function exportCover(ratioKey) {
  const btn = { '1:1': $('exp11'), '4:5': $('exp45'), '16:9': $('exp169') }[ratioKey];
  btn.disabled = true;
  status.textContent = 'Preparing fonts…';
  try {
    await ensureFonts();
    const rs = renderState();
    const out = renderCover(rs, ratioKey);
    const ratio = RATIOS[ratioKey];
    status.textContent = 'Rendering ' + ratio.label + '…';
    await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    out.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cover-${ratio.w}x${ratio.h}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      status.textContent = 'Saved cover-' + ratio.w + 'x' + ratio.h + '.png';
      btn.disabled = false;
    }, 'image/png');
  } catch (err) {
    status.textContent = 'Export failed: ' + err.message;
    btn.disabled = false;
  }
}
$('exp11').addEventListener('click', () => exportCover('1:1'));
$('exp45').addEventListener('click', () => exportCover('4:5'));
$('exp169').addEventListener('click', () => exportCover('16:9'));

// Debug 200px render: judge this, not the 1080 preview.
function showDebug200() {
  const rs = renderState();
  const small = renderDebug200(rs);
  const dc = $('debugCanvas');
  dc.width = small.width; dc.height = small.height;
  dc.getContext('2d').drawImage(small, 0, 0);
  $('debugBox').hidden = false;
}
$('debug200').addEventListener('click', showDebug200);
$('debugClose').addEventListener('click', () => { $('debugBox').hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    showDebug200();
  }
});

// Screenshot scenes.
const shot = new URLSearchParams(location.search).get('shot');
if (shot) {
  runShot(shot, new URLSearchParams(location.search), {
    state, demoState, ingestFiles, redraw, renderState, loadPhotoFile,
    setSelected: (i) => { state.selected = i; renderChips(); },
    showSizes: () => { $('sizesStrip').hidden = false; },
  });
} else {
  demoState();
  redraw();
}
