// Fixed scenes for screenshots. `window.__shotReady` is set once painted.
// One demo state for ALL FOUR screenshots (same caption, same three photos,
// same arrangement): caption SUNSET HEIST, kicker PALM COAST, Straddle, Vice,
// hero = boulevard sunset, lower panels = pier + sunset beach.
// ?shot=cover  — the exported cover alone, full-bleed (screenshot 1).
// ?shot=editor — the editor with real photos loaded (screenshot 2).
// ?shot=crop   — a panel selected (outline + drag handles + cursor + the zoom
//                control near the canvas) plus the same cover in all three
//                sizes as a strip beside it (screenshot 3).
// ?shot=range  — four exported covers in a 2x2 grid, four layouts/grades,
//                same photos + caption (screenshot 4).
import { renderCover, RATIOS } from './render.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function ready() {
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}

// The three shipped sample photos, in panel order: hero, lower-left, lower-right.
async function loadSamples() {
  const out = [];
  for (const name of ['boulevard', 'pier', 'sunset']) {
    const img = await loadImage(`samples/${name}.jpg`);
    const bmp = await createImageBitmap(img);
    out.push({ img: bmp, name, demo: false });
  }
  return out;
}

// Panel assignment for a layout, from the three samples. Straddle uses the
// tuned pans (boulevard hero so her face stays in frame; pier so his face
// clears the caption straddling the gutter). Band is one full-bleed panel:
// the boulevard photo is panned down so her face shows above the black band.
function panelsFor(layout, photos) {
  const [b, p, s] = photos;
  if (layout === 'band') return [{ photoIndex: 0, scale: 1, ox: 0, oy: 700 }];
  if (layout === 'quad') {
    return [
      { photoIndex: 0, scale: 1, ox: 0, oy: 0 },
      { photoIndex: 1, scale: 1, ox: 0, oy: 0 },
      { photoIndex: 2, scale: 1, ox: 0, oy: 0 },
      { photoIndex: 0, scale: 1, ox: 0, oy: 0 },
    ];
  }
  return [
    { photoIndex: 0, scale: 1, ox: 0, oy: layout === 'straddle' ? 170 : 0 },
    { photoIndex: 1, scale: 1, ox: 0, oy: layout === 'straddle' ? 70 : 0 },
    { photoIndex: 2, scale: 1, ox: 0, oy: 0 },
  ];
}

// Apply the single demo state to the editor: same caption, kicker, photos,
// arrangement for every shot.
function applyDemoState(api, photos, { layout = 'straddle', preset = 'vice', ratio = '1:1', caption = 'SUNSET HEIST', kicker = 'PALM COAST' } = {}) {
  const { state } = api;
  state.caption = caption;
  state.kicker = kicker;
  state.micro = 'A COVER MADE WITH SUNSET COVER MAKER';
  state.preset = preset;
  state.layout = layout;
  state.ratio = ratio;
  document.getElementById('caption').value = caption;
  document.getElementById('kicker').value = kicker;
  document.getElementById('micro').value = 'A COVER MADE WITH SUNSET COVER MAKER';
  document.querySelectorAll('#ratioSeg button').forEach((b) => b.classList.toggle('on', b.dataset.ratio === ratio));
  document.querySelectorAll('#layoutRow button').forEach((b) => b.classList.toggle('on', b.dataset.layout === layout));
  document.querySelectorAll('#gradeRow button').forEach((b) => b.classList.toggle('on', b.dataset.preset === preset));
  state.photos = photos;
  state.panels = panelsFor(layout, photos);
  while (state.panels.length < 4) state.panels.push({ photoIndex: -1, scale: 1, ox: 0, oy: 0 });
  state.selected = 0;
}

export async function runShot(shot, query, api) {
  const { state } = api;
  const caption = query.get('caption') ?? 'Sunset Heist';
  const kicker = query.get('kicker') ?? 'Palm Coast';

  // Fonts first: a cover exported before the display fonts load is wrong.
  await Promise.all([
    document.fonts.load('400 128px Anton'),
    document.fonts.load('400 118px "Archivo Black"'),
    document.fonts.load('600 26px Manrope'),
    document.fonts.load('500 18px Manrope'),
  ]);
  await document.fonts.ready;

  if (shot === 'range') {
    document.body.classList.add('shot-range');
    const stage = document.getElementById('stage');
    stage.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:center;justify-items:center;width:100%;max-width:1180px;';
    const combos = [
      { layout: 'straddle', preset: 'vice', ratio: '1:1' },
      { layout: 'triptych', preset: 'neon', ratio: '4:5' },
      { layout: 'band', preset: 'heat', ratio: '16:9' },
      { layout: 'quad', preset: 'mint', ratio: '1:1' },
    ];
    const photos = await loadSamples();
    for (const c of combos) {
      const panels = panelsFor(c.layout, photos).map((p) => ({
        photo: photos[p.photoIndex] ? photos[p.photoIndex].img : null,
        scale: p.scale, ox: p.ox, oy: p.oy,
      }));
      const rs = {
        ratio: c.ratio, layout: c.layout, preset: c.preset,
        caption, kicker, micro: 'A COVER MADE WITH SUNSET COVER MAKER',
        fontMode: 'auto', panels,
      };
      const full = renderCover(rs, c.ratio);
      // Fixed height per thumbnail so the 2x2 grid is uniform and fits the viewport.
      const th = 300;
      const tw = Math.round(th * full.width / full.height);
      const cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      cv.getContext('2d').drawImage(full, 0, 0, tw, th);
      cv.style.cssText = 'height:300px;width:auto;display:block;box-shadow:0 6px 24px rgba(0,0,0,0.5);';
      grid.appendChild(cv);
    }
    stage.appendChild(grid);
    ready();
    return;
  }

  // cover / editor / crop: the single demo state, three real photos.
  const photos = await loadSamples();
  applyDemoState(api, photos, { caption: caption.toUpperCase(), kicker: kicker.toUpperCase() });
  api.redraw();

  if (shot === 'cover') {
    document.body.classList.add('shot-cover');
    ready();
    return;
  }

  if (shot === 'crop') {
    document.body.classList.add('shot-crop');
    api.setSelected(0);
    state.showSelection = true;
    state.showCursor = true;
    api.redraw();
    // Bring the zoom slider + reset into view (the controls column scrolls).
    document.getElementById('cropBox').scrollIntoView({ block: 'nearest' });
    // Same cover in all three sizes, as a strip beside the editor.
    const strip = document.getElementById('sizesStrip');
    strip.innerHTML = '';
    strip.hidden = false;
    for (const key of ['1:1', '4:5', '16:9']) {
      const rs = api.renderState();
      const full = renderCover(rs, key);
      const th = 180;
      const tw = Math.round(th * full.width / full.height);
      const cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      cv.getContext('2d').drawImage(full, 0, 0, tw, th);
      const fig = document.createElement('figure');
      fig.appendChild(cv);
      const cap = document.createElement('figcaption');
      cap.textContent = RATIOS[key].label;
      fig.appendChild(cap);
      strip.appendChild(fig);
    }
  }
  ready();
}
