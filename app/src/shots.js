// Fixed scenes for screenshots. `window.__shotReady` is set once painted.
// ?shot=cover  — the exported cover alone, full-bleed (screenshot 1).
// ?shot=editor — the editor with a real photo loaded (screenshot 2).
// ?shot=crop   — a panel selected (outline + zoom slider) plus the same cover
//                in all three sizes as a strip beside it (screenshot 3).
// ?shot=range  — four exported covers in a 2x2 grid, four layouts/grades
//                (screenshot 4).
import { renderCover, RATIOS, makeDemoPhoto } from './render.js';

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

async function samplePhoto(api, name) {
  const img = await loadImage(`samples/${name}.jpg`);
  const bmp = await createImageBitmap(img);
  return { img: bmp, name, demo: false };
}

export async function runShot(shot, query, api) {
  const { state } = api;
  const photoName = query.get('photo') ?? 'pier';
  const caption = query.get('caption') ?? 'Sunset Heist';
  const kicker = query.get('kicker') ?? 'Vice City';
  const micro = query.get('micro') ?? 'A cover made with Sunset Cover Maker';
  const preset = query.get('preset') ?? 'vice';
  const layout = query.get('layout') ?? 'straddle';
  const ratio = query.get('ratio') ?? '1:1';

  // Fonts first: a cover exported before the display fonts load is wrong.
  await Promise.all([
    document.fonts.load('400 128px Anton'),
    document.fonts.load('400 118px "Archivo Black"'),
    document.fonts.load('600 26px Manrope'),
    document.fonts.load('500 18px Manrope'),
  ]);
  await document.fonts.ready;

  state.caption = caption; state.kicker = kicker; state.micro = micro;
  state.preset = preset; state.layout = layout; state.ratio = ratio;
  document.getElementById('caption').value = caption;
  document.getElementById('kicker').value = kicker;
  document.getElementById('micro').value = micro;
  document.querySelectorAll('#ratioSeg button').forEach((b) => b.classList.toggle('on', b.dataset.ratio === ratio));
  document.querySelectorAll('#layoutRow button').forEach((b) => b.classList.toggle('on', b.dataset.layout === layout));
  document.querySelectorAll('#gradeRow button').forEach((b) => b.classList.toggle('on', b.dataset.preset === preset));

  if (shot === 'range') {
    document.body.classList.add('shot-range');
    const stage = document.getElementById('stage');
    stage.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:center;justify-items:center;width:100%;max-width:1180px;';
    const combos = [
      { layout: 'straddle', preset: 'vice', caption: 'SUNSET HEIST', ratio: '1:1' },
      { layout: 'triptych', preset: 'neon', caption: 'NEON NIGHTS', ratio: '4:5' },
      { layout: 'band', preset: 'heat', caption: 'HEAT WAVE', ratio: '16:9' },
      { layout: 'quad', preset: 'mint', caption: 'MINT DUSK', ratio: '1:1' },
    ];
    const ph = await samplePhoto(api, photoName);
    const ph2 = await samplePhoto(api, photoName === 'pier' ? 'boulevard' : 'pier');
    for (const c of combos) {
      const rs = {
        ratio: c.ratio, layout: c.layout, preset: c.preset,
        caption: c.caption, kicker: 'VICE CITY', micro: 'A COVER MADE WITH SUNSET COVER MAKER',
        fontMode: 'auto',
        panels: [0, 1, 2, 3].map((i) => ({ photo: (i % 2 ? ph2 : ph).img, scale: 1, ox: 0, oy: 0 })),
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

  // cover / editor / crop: load the sample photo into every panel.
  api.demoState();
  const ph = await samplePhoto(api, photoName);
  const ph2 = await samplePhoto(api, photoName === 'pier' ? 'boulevard' : 'pier');
  if (shot === 'cover') {
    // Three distinct panels: boulevard sunset (hero), pier, demo skyline — a real
    // multi-panel poster, not one photo cropped three ways.
    state.photos = [ph2, ph, { img: makeDemoPhoto(1), name: 'demo-skyline', demo: true }];
    state.panels.forEach((p, i) => { p.photoIndex = i % 3; p.scale = 1; p.ox = 0; p.oy = 0; });
    // Pan the boulevard hero so her face stays in frame; pan the pier photo
    // down so his face clears the caption straddling the gutter.
    state.panels[0].oy = 170;
    state.panels[1].oy = 70;
    api.redraw();
    document.body.classList.add('shot-cover');
    ready();
    return;
  }
  state.photos = [ph];
  state.panels.forEach((p) => { p.photoIndex = 0; p.scale = 1; p.ox = 0; p.oy = 0; });
  api.redraw();

  if (shot === 'crop') {
    document.body.classList.add('shot-crop');
    api.setSelected(0);
    state.showSelection = true;
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
