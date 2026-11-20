// Core renderer: one function renderCover(state, w, h) draws a finished cover.
// Three layers, separate: photo (cropped), grade (colour), type (drawn last,
// at final pixel size, after the grade). Never letter the photo, never grade
// the letters. Drawn at export size natively, never upscaled from a small canvas.
// One grade, one light direction (sun camera-left, low), one shadow.

export const RATIOS = {
  '1:1': { w: 1080, h: 1080, label: '1080 × 1080' },
  '4:5': { w: 1080, h: 1350, label: '1080 × 1350' },
  '16:9': { w: 1920, h: 1080, label: '1920 × 1080' },
};

export const PRESETS = {
  // dark: the shadow-lift multiply alpha (dark violet). Mint's is lower and its
  // dark stop lighter, so an already-dark photo does not crush to black.
  vice: { name: 'Vice sunset', stops: [[0, '#ff7a2f'], [0.5, '#ff3d6e'], [1, '#2a0b3d']], contrast: 1.16, dark: 0.07, typeShadow: 'rgba(0,0,0,0.55)' },
  neon: { name: 'Neon night', stops: [[0, '#00e5ff'], [0.55, '#ff2fd0'], [1, '#1b0b2e']], contrast: 1.24, dark: 0.07, typeShadow: 'rgba(255,47,208,0.5)' },
  heat: { name: 'Heat', stops: [[0, '#ffb02e'], [0.55, '#ff5a1e'], [1, '#7a0f1e']], contrast: 1.16, dark: 0.07, typeShadow: 'rgba(0,0,0,0.55)' },
  mint: { name: 'Mint dusk', stops: [[0, '#8ef0c8'], [0.55, '#3ec6a7'], [1, '#2e4a72']], contrast: 1.16, dark: 0.04, typeShadow: 'rgba(0,0,0,0.55)' },
};

// Sunset gradient strength (soft-light alpha). 0.65 is Superbot's original
// value; the whole-canvas unification below is stronger now, so 0.65 is
// enough for a bright daylight photo to read as sunset.
const SUNSET_ALPHA = 0.65;

export const LAYOUTS = {
  straddle: { name: 'Straddle', best: '1:1' },
  triptych: { name: 'Triptych', best: '4:5' },
  band: { name: 'Band', best: '16:9' },
  quad: { name: 'Quad', best: '1:1 · 4:5' },
};

// Seeded PRNG so the grain is identical on every render of the same cover.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let grainCanvas = null;
function getGrain() {
  if (grainCanvas) return grainCanvas;
  const rnd = mulberry32(20261120);
  grainCanvas = document.createElement('canvas');
  grainCanvas.width = 128; grainCanvas.height = 128;
  const g = grainCanvas.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 96 + Math.floor(rnd() * 64);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grainCanvas;
}

// Panel rects for a layout, in export px. u scales margin/gutter/type with width.
export function layoutRects(layout, W, H) {
  const u = W / 1080;
  const m = 26 * u, g = 14 * u;
  const ix = m, iy = m, iw = W - 2 * m, ih = H - 2 * m;
  if (layout === 'triptych') {
    const w = (iw - 2 * g) / 3;
    return [
      { x: ix, y: iy, w, h: ih },
      { x: ix + w + g, y: iy, w, h: ih },
      { x: ix + 2 * (w + g), y: iy, w, h: ih },
    ];
  }
  if (layout === 'band') {
    return [{ x: 0, y: 0, w: W, h: H }];
  }
  if (layout === 'quad') {
    const w = (iw - g) / 2, h = (ih - g) / 2;
    return [
      { x: ix, y: iy, w, h },
      { x: ix + w + g, y: iy, w, h },
      { x: ix, y: iy + h + g, w, h },
      { x: ix + w + g, y: iy + h + g, w, h },
    ];
  }
  // straddle (default): hero top, two below; 52:40 split of the height after the gutter.
  const heroH = (ih - g) * (52 / 92);
  const botH = ih - g - heroH;
  const w = (iw - g) / 2;
  return [
    { x: ix, y: iy, w: iw, h: heroH },
    { x: ix, y: iy + heroH + g, w, h: botH },
    { x: ix + w + g, y: iy + heroH + g, w, h: botH },
  ];
}

// Where the caption sits, per layout. Returns {x, y, align, maxW, size, font}.
// Anton starts at 128–152px (180px for the enormous triptych); Archivo Black
// (one-word titles) starts at 118px. Auto-fit shrinks from there until it fits.
function captionSpec(layout, W, H, rects, font) {
  const u = W / 1080;
  const m = 26 * u, g = 14 * u;
  const iw = W - 2 * m;
  const ab = font === 'Archivo Black';
  if (layout === 'triptych') {
    return { x: W / 2, y: H / 2, align: 'center', maxW: iw * 0.96, size: (ab ? 118 : 180) * u, font };
  }
  if (layout === 'band') {
    return { x: W / 2, y: H * 0.88, align: 'center', maxW: iw * 0.94, size: (ab ? 118 : 150) * u, font };
  }
  if (layout === 'quad') {
    const r = rects[2];
    return { x: r.x + g * 0.75, y: r.y + r.h - 30 * u, align: 'left', maxW: r.w * 2 - g * 0.5, size: (ab ? 118 : 128) * u, font };
  }
  // straddle: centred on the gutter line between hero and bottom row.
  const gy = rects[0].y + rects[0].h + g / 2;
  return { x: W / 2, y: gy, align: 'center', maxW: iw * 0.96, size: (ab ? 118 : 152) * u, font };
}

// Draw one photo into its panel, cover-fit, with pan/zoom, then the per-photo grade.
// Unification, in order, so a noon-daylight panel and a golden-hour panel read
// as one sunset poster: (1) sepia in the filter warms the photo while keeping
// whites white; (2) a warm soft-light pass warms the midtones (soft-light
// leaves highlights alone, so the white point survives); (3) the sunset
// gradient, soft-light; (4) a light shadow-lift multiply, per preset (Mint's
// is the lightest); (5) a sun push, screen; (6) a shared white-point lift,
// screen white, that puts the top end back to white after the multiply.
function drawPanel(ctx, rect, panel, preset) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const photo = panel.photo;
  if (photo) {
    const pw = photo.naturalWidth || photo.width, ph = photo.naturalHeight || photo.height;
    const base = Math.max(rect.w / pw, rect.h / ph);
    const s = base * (panel.scale || 1);
    const dw = pw * s, dh = ph * s;
    const dx = rect.x + (rect.w - dw) / 2 + (panel.ox || 0);
    const dy = rect.y + (rect.h - dh) / 2 + (panel.oy || 0);
    ctx.filter = `saturate(1.25) contrast(${preset.contrast}) brightness(0.98) sepia(0.35)`;
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = '#241a2e';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  // Warm soft-light: amber over the whole panel. Soft-light warms midtones
  // and leaves highlights alone, so a white vest stays white.
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = 'rgb(255,175,95)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Warm overlay: amber that also reaches the highlights, so a bright blue
  // sky warms instead of staying noon-blue. Overlay screens lights and
  // multiplies darks, so whites stay white.
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = 'rgb(255,175,95)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Sunset gradient, soft-light — per photo, top to bottom of the panel.
  const grad = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  for (const [o, c] of preset.stops) grad.addColorStop(o, c);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = SUNSET_ALPHA;
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Shadow lift: dark violet multiply, per preset (Mint's is the lightest).
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = preset.dark;
  ctx.fillStyle = 'rgb(24,6,30)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Sun push: radial screen at the horizon, camera-left and low, 0.18.
  const sx = rect.x + rect.w * 0.15, sy = rect.y + rect.h * 0.78;
  const sr = Math.max(rect.w, rect.h) * 0.62;
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
  sun.addColorStop(0, 'rgba(255,210,122,0.9)');
  sun.addColorStop(0.5, 'rgba(255,150,90,0.35)');
  sun.addColorStop(1, 'rgba(255,150,90,0)');
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = sun;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // White-point clamp (shared): a light screen of white puts the top end
  // back to white after the multiply, so a white vest reads as white, not grey.
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = 'rgb(255,255,255)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// Whole-canvas pass: vignette multiply 0.22, then generated grain overlay 0.06.
function wholeCanvasGrade(ctx, W, H) {
  const cx = W / 2, cy = H / 2;
  const r = Math.max(W, H) * 0.72;
  const vig = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  const pat = ctx.createPattern(getGrain(), 'repeat');
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Fit text to maxW by shrinking from startSize. Returns {size, lines}.
function fitText(ctx, text, font, startSize, maxW, maxLines) {
  let size = startSize;
  const words = text.split(/\s+/).filter(Boolean);
  for (;;) {
    ctx.font = `${size}px "${font}"`;
    ctx.letterSpacing = '-0.01em';
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if ((lines.length <= maxLines && ctx.measureText(lines.reduce((a, b) => a.length > b.length ? a : b, '')).width <= maxW) || size <= 24) {
      return { size, lines };
    }
    size -= 4;
  }
}

// Draw the type block (kicker, caption, micro) last, at final pixel size.
function drawType(ctx, state, W, H, rects) {
  const preset = PRESETS[state.preset] || PRESETS.vice;
  const u = W / 1080;
  const m = 26 * u;
  const oneWord = state.caption.trim().split(/\s+/).length === 1;
  // Caption face: auto picks Archivo Black for one-word titles, Anton otherwise;
  // the editor's checkbox can force Archivo Black.
  const captionFont = state.fontMode === 'archivo' ? 'Archivo Black'
    : state.fontMode === 'anton' ? 'Anton'
    : (oneWord ? 'Archivo Black' : 'Anton');
  const spec = captionSpec(state.layout, W, H, rects, captionFont);
  const caption = state.caption.trim().toUpperCase() || 'SUNSET HEIST';
  const shadow = preset.typeShadow;
  const off = 5 * u;

  // Caption: auto-fit, line-height 1.02, tracking -0.01em.
  const fit = fitText(ctx, caption, spec.font, spec.size, spec.maxW, 2);
  const lineH = fit.size * 1.02;
  const totalH = fit.lines.length * lineH;
  let cy = spec.y - totalH / 2; // centre the block on spec.y
  if (state.layout === 'quad') cy = spec.y - totalH; // bottom-left: block ends at spec.y
  if (state.layout === 'band') cy = spec.y - totalH / 2;

  // Scrim for quad: dark wash behind the bottom-left caption.
  if (state.layout === 'quad') {
    const r = rects[2];
    const sc = ctx.createLinearGradient(0, r.y + r.h * 0.35, 0, r.y + r.h);
    sc.addColorStop(0, 'rgba(10,10,10,0)');
    sc.addColorStop(1, 'rgba(10,10,10,0.72)');
    ctx.fillStyle = sc;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  // Band: bottom 24% solid black + thin rule above the type.
  if (state.layout === 'band') {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, H * 0.76, W, H * 0.24);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(W * 0.06, H * 0.76 - 2 * u, W * 0.88, 2 * u);
  }

  ctx.textAlign = spec.align;
  ctx.textBaseline = 'middle';
  const kx = spec.align === 'left' ? spec.x : W / 2;
  // Kicker above the caption.
  if (state.kicker && state.kicker.trim()) {
    ctx.font = `600 ${26 * u}px Manrope`;
    ctx.letterSpacing = '0.24em';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(state.kicker.trim().toUpperCase(), kx, cy - 26 * u);
  }
  // Caption: stroke 7px #0a0a0a, fill white, one hard shadow (5,5).
  ctx.font = `${fit.size}px "${spec.font}"`;
  ctx.letterSpacing = '-0.01em';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7 * u;
  ctx.strokeStyle = '#0a0a0a';
  ctx.shadowColor = shadow;
  ctx.shadowOffsetX = off; ctx.shadowOffsetY = off; ctx.shadowBlur = 0;
  fit.lines.forEach((line, i) => {
    ctx.strokeText(line, spec.x, cy + lineH * i + lineH / 2);
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#ffffff';
  fit.lines.forEach((line, i) => {
    ctx.fillText(line, spec.x, cy + lineH * i + lineH / 2);
  });
  // Micro line under the caption. Auto-shrinks to fit the canvas width so it
  // never clips mid-word, and gets the same backing treatment as the caption
  // (dark scrim band + outline) so it reads on any photo.
  if (state.micro && state.micro.trim()) {
    const microText = state.micro.trim().toUpperCase();
    const maxMicroW = W - 2 * m;
    let mSize = 18 * u;
    ctx.letterSpacing = '0.18em';
    for (;;) {
      ctx.font = `500 ${mSize}px Manrope`;
      if (ctx.measureText(microText).width <= maxMicroW || mSize <= 12 * u) break;
      mSize -= 1;
    }
    const my = cy + totalH + 22 * u;
    const mw = ctx.measureText(microText).width;
    const mx = spec.align === 'left' ? spec.x : W / 2;
    // Scrim band behind the micro line.
    const padX = 14 * u, padY = 8 * u;
    const bx = (spec.align === 'left' ? mx : mx - mw / 2) - padX;
    const by = my - mSize / 2 - padY;
    ctx.fillStyle = 'rgba(10,10,10,0.55)';
    ctx.beginPath();
    ctx.roundRect(bx, by, mw + 2 * padX, mSize + 2 * padY, 6 * u);
    ctx.fill();
    // Outline + fill, like the caption.
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = '#0a0a0a';
    ctx.strokeText(microText, mx, my);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(microText, mx, my);
  }
  ctx.letterSpacing = '0px';
}

// The renderer: render(state, ratio) -> canvas. Draws a finished cover from state.
export function renderCover(state, ratioKey) {
  const ratio = RATIOS[ratioKey] || RATIOS['1:1'];
  const W = ratio.w, H = ratio.h;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  const preset = PRESETS[state.preset] || PRESETS.vice;
  const rects = layoutRects(state.layout, W, H);
  const panels = state.panels || [];
  rects.forEach((rect, i) => {
    drawPanel(ctx, rect, panels[i] || { photo: null, scale: 1, ox: 0, oy: 0 }, preset);
  });
  wholeCanvasGrade(ctx, W, H);
  drawType(ctx, state, W, H, rects);
  return canvas;
}

// Debug render at 200px wide: judge this, not the 1080 preview.
export function renderDebug200(state) {
  const ratio = RATIOS[state.ratio] || RATIOS['1:1'];
  const full = renderCover(state, state.ratio);
  const w = 200, h = Math.round(200 * ratio.h / ratio.w);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(full, 0, 0, w, h);
  return canvas;
}

// No generated demo panels: every panel shows a real photo (the three samples
// under app/samples/), so no screenshot can ever show a gradient placeholder.
