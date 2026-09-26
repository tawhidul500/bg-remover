// Pure pixel operations shared by preview and export rendering. No DOM access here,
// so the same code runs in tests and in the browser.
import type { Adjustments, InputTransform } from "./types";

export const isNeutral = (a: Adjustments) =>
  !a.exposure && !a.contrast && !a.saturation && !a.temperature && !a.tint && !a.highlights && !a.shadows && !a.sharpness;

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Apply colour adjustments in place to straight-alpha RGBA data.
 * Order: exposure → temperature/tint → shadows/highlights → contrast → saturation → sharpness.
 * Alpha is never modified; fully transparent pixels are skipped.
 */
export function applyAdjustments(data: Uint8ClampedArray, w: number, h: number, a: Adjustments): void {
  if (isNeutral(a)) return;
  const exp = Math.pow(2, (a.exposure / 100) * 2);
  const tR = 1 + (a.temperature / 100) * 0.25 + (a.tint / 100) * 0.06;
  const tG = 1 - (a.tint / 100) * 0.18;
  const tB = 1 - (a.temperature / 100) * 0.25 + (a.tint / 100) * 0.06;
  const con = a.contrast >= 0 ? 1 + (a.contrast / 100) * 1.5 : 1 + a.contrast / 100;
  const sat = 1 + a.saturation / 100;
  const sh = (a.shadows / 100) * 0.45 * 255;
  const hl = (a.highlights / 100) * 0.45 * 255;
  const n = w * h * 4;
  for (let i = 0; i < n; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i] * exp * tR;
    let g = data[i + 1] * exp * tG;
    let b = data[i + 2] * exp * tB;
    if (sh || hl) {
      const L = Math.min(1, Math.max(0, (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255));
      const off = sh * (1 - L) * (1 - L) + hl * L * L;
      r += off; g += off; b += off;
    }
    if (con !== 1) {
      r = (r - 128) * con + 128; g = (g - 128) * con + 128; b = (b - 128) * con + 128;
    }
    if (sat !== 1) {
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = L + (r - L) * sat; g = L + (g - L) * sat; b = L + (b - L) * sat;
    }
    data[i] = clamp255(r); data[i + 1] = clamp255(g); data[i + 2] = clamp255(b);
  }
  if (a.sharpness > 0) sharpen(data, w, h, (a.sharpness / 100) * 1.5);
}

/** Alpha-weighted 3×3 unsharp mask (transparent neighbours don't darken edges). */
export function sharpen(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] === 0) continue;
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          const wa = src[j + 3];
          sr += src[j] * wa; sg += src[j + 1] * wa; sb += src[j + 2] * wa; sw += wa;
        }
      }
      if (!sw) continue;
      data[i] = clamp255(src[i] + amount * (src[i] - sr / sw));
      data[i + 1] = clamp255(src[i + 1] + amount * (src[i + 1] - sg / sw));
      data[i + 2] = clamp255(src[i + 2] + amount * (src[i + 2] - sb / sw));
    }
  }
}

/** One horizontal+vertical box-blur pass on a single channel (stride = channels). */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, ch: number): void {
  const tmp = new Float32Array(src.length);
  const div = 2 * r + 1;
  for (let c = 0; c < ch; c++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let k = -r; k <= r; k++) acc += src[(row + Math.min(w - 1, Math.max(0, k))) * ch + c];
      for (let x = 0; x < w; x++) {
        tmp[(row + x) * ch + c] = acc / div;
        const add = Math.min(w - 1, x + r + 1), sub = Math.max(0, x - r);
        acc += src[(row + add) * ch + c] - src[(row + sub) * ch + c];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * ch + c];
      for (let y = 0; y < h; y++) {
        dst[(y * w + x) * ch + c] = acc / div;
        const add = Math.min(h - 1, y + r + 1), sub = Math.max(0, y - r);
        acc += tmp[(add * w + x) * ch + c] - tmp[(sub * w + x) * ch + c];
      }
    }
  }
}

/** Approximate Gaussian blur (3 box passes) of a single-channel Uint8 buffer. */
export function blurChannel(buf: Uint8Array | Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf.length);
  if (radius < 0.5) { out.set(buf); return out; }
  const r = Math.max(1, Math.round(radius / 1.8));
  let a = Float32Array.from(buf);
  let b = new Float32Array(buf.length);
  for (let p = 0; p < 3; p++) { boxPass(a, b, w, h, r, 1); [a, b] = [b, a]; }
  for (let i = 0; i < out.length; i++) out[i] = a[i];
  return out;
}

/** Premultiplied RGBA blur (no dark halos at transparent edges). */
export function blurRGBA(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
  if (radius < 0.5) return;
  const r = Math.max(1, Math.round(radius / 1.8));
  const n = w * h;
  let a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const al = data[i * 4 + 3] / 255;
    a[i * 4] = data[i * 4] * al; a[i * 4 + 1] = data[i * 4 + 1] * al; a[i * 4 + 2] = data[i * 4 + 2] * al; a[i * 4 + 3] = data[i * 4 + 3];
  }
  let b = new Float32Array(n * 4);
  for (let p = 0; p < 3; p++) { boxPass(a, b, w, h, r, 4); [a, b] = [b, a]; }
  for (let i = 0; i < n; i++) {
    const al = a[i * 4 + 3];
    const k = al > 0 ? 255 / al : 0;
    data[i * 4] = a[i * 4] * k; data[i * 4 + 1] = a[i * 4 + 1] * k; data[i * 4 + 2] = a[i * 4 + 2] * k; data[i * 4 + 3] = al;
  }
}

/** Separable max (dilate) or min (erode) filter with square radius r, O(n·r) but bounded r. */
export function morph(mask: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const pick = dilate ? Math.max : Math.min;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = mask[row + x];
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let k = x0; k <= x1; k++) v = pick(v, mask[row + k]);
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = tmp[y * w + x];
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let k = y0; k <= y1; k++) v = pick(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Expand/contract then feather the mask. Returns a new buffer. */
export function refineMask(mask: Uint8Array, w: number, h: number, expand: number, feather: number): Uint8Array {
  let m = mask;
  if (expand) m = morph(mask, w, h, Math.min(40, Math.abs(Math.round(expand))), expand > 0);
  if (feather > 0) return new Uint8Array(blurChannel(m, w, h, feather).buffer);
  return m === mask ? mask : m;
}

export interface BrushDab {
  x: number; y: number; radius: number; hardness: number; opacity: number;
}

/**
 * Paint one dab into the stroke buffer (max-combined) and update the live mask from base.
 * erase: mask = base·(1−s); restore: mask = base + (255−base)·s. Returns the dirty rect.
 */
export function paintDab(
  mask: Uint8Array, base: Uint8Array, stroke: Uint8Array, w: number, h: number, d: BrushDab, erase: boolean,
): [number, number, number, number] | null {
  const r = Math.max(0.5, d.radius);
  const x0 = Math.max(0, Math.floor(d.x - r)), x1 = Math.min(w - 1, Math.ceil(d.x + r));
  const y0 = Math.max(0, Math.floor(d.y - r)), y1 = Math.min(h - 1, Math.ceil(d.y + r));
  if (x0 > x1 || y0 > y1) return null;
  const hard = Math.min(0.999, Math.max(0, d.hardness));
  const inner = r * hard;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y);
      if (dist > r) continue;
      let f = dist <= inner ? 1 : 1 - (dist - inner) / (r - inner);
      f = f * f * (3 - 2 * f); // smoothstep falloff
      const s = Math.round(255 * f * d.opacity);
      const i = y * w + x;
      if (s <= stroke[i]) continue;
      stroke[i] = s;
      const b = base[i];
      mask[i] = erase ? Math.round((b * (255 - s)) / 255) : Math.round(b + ((255 - b) * s) / 255);
    }
  }
  return [x0, y0, x1, y1];
}

/**
 * Remap a working-space mask from one input transform to another (rotate / flip /
 * crop / resize). Each new working pixel is traced back to the oriented original
 * and then forward into the old working space, so turning, flipping or trimming
 * keeps the cut-out instead of discarding it. Pixels with no correspondent in the
 * old image remain transparent unless a preserved `fallback` mask is supplied.
 */
export interface MaskRect { x0: number; y0: number; x1: number; y1: number }

export function transformMaskForInput(
  src: Uint8Array, srcW: number, srcH: number,
  prev: InputTransform, next: InputTransform,
  origW: number, origH: number,
  /** When writing brush edits back, keep reserve pixels outside the edited region. */
  opts: { fallback?: Uint8Array; region?: MaskRect } = {},
): Uint8Array {
  const dstW = next.width, dstH = next.height;
  const dst = opts.fallback?.length === dstW * dstH ? opts.fallback.slice() : new Uint8Array(dstW * dstH);
  if (!srcW || !srcH || !dstW || !dstH || !origW || !origH) return dst;

  const cxP = prev.crop.x * origW, cyP = prev.crop.y * origH;
  const cwP = Math.max(1e-6, prev.crop.w * origW), chP = Math.max(1e-6, prev.crop.h * origH);
  const swapP = prev.rotate === 90 || prev.rotate === 270;
  const dwP = swapP ? prev.height : prev.width, dhP = swapP ? prev.width : prev.height;
  const thP = (prev.rotate * Math.PI) / 180, cosP = Math.cos(thP), sinP = Math.sin(thP);
  const fxP = prev.flipH ? -1 : 1, fyP = prev.flipV ? -1 : 1;

  const cxN = next.crop.x * origW, cyN = next.crop.y * origH;
  const cwN = Math.max(1e-6, next.crop.w * origW), chN = Math.max(1e-6, next.crop.h * origH);
  const swapN = next.rotate === 90 || next.rotate === 270;
  const dwN = swapN ? next.height : next.width, dhN = swapN ? next.width : next.height;
  const thN = (next.rotate * Math.PI) / 180, cosN = Math.cos(thN), sinN = Math.sin(thN);
  const fxN = next.flipH ? -1 : 1, fyN = next.flipV ? -1 : 1;
  const halfWn = next.width / 2, halfHn = next.height / 2;
  const halfWp = prev.width / 2, halfHp = prev.height / 2;
  const halfDwN = dwN / 2, halfDhN = dhN / 2, halfDwP = dwP / 2, halfDhP = dhP / 2;

  for (let dy = 0; dy < dstH; dy++) {
    const wy = dy + 0.5;
    for (let dx = 0; dx < dstW; dx++) {
      const wx = dx + 0.5;
      // New working -> oriented original (inverse of buildWorking).
      const pxN = wx - halfWn, pyN = wy - halfHn;
      const rxN = pxN * cosN + pyN * sinN;
      const ryN = -pxN * sinN + pyN * cosN;
      const lxN = rxN * fxN, lyN = ryN * fyN;
      const ox = cxN + ((lxN + halfDwN) / dwN) * cwN;
      const oy = cyN + ((lyN + halfDhN) / dhN) * chN;
      // Original -> old working (forward of buildWorking).
      const lxP = ((ox - cxP) / cwP) * dwP - halfDwP;
      const lyP = ((oy - cyP) / chP) * dhP - halfDhP;
      const sx = lxP * fxP, sy = lyP * fyP;
      const pxP = sx * cosP - sy * sinP;
      const pyP = sx * sinP + sy * cosP;
      const wxP = pxP + halfWp, wyP = pyP + halfHp;
      const o = dy * dstW + dx;
      if (wxP < 0 || wxP > srcW || wyP < 0 || wyP > srcH) continue;
      // For a brush stroke, don't resample untouched reserve pixels on every dab:
      // this preserves fine edges and pixels hidden by the current trim.
      if (opts.region && (wxP < opts.region.x0 - 1 || wxP > opts.region.x1 + 2 ||
        wyP < opts.region.y0 - 1 || wyP > opts.region.y1 + 2)) continue;
      const fx = Math.min(srcW - 1, Math.max(0, wxP - 0.5));
      const fy = Math.min(srcH - 1, Math.max(0, wyP - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(srcW - 1, x0 + 1), y1 = Math.min(srcH - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const a = src[y0 * srcW + x0] * (1 - tx) + src[y0 * srcW + x1] * tx;
      const b = src[y1 * srcW + x0] * (1 - tx) + src[y1 * srcW + x1] * tx;
      dst[o] = Math.round(a * (1 - ty) + b * ty);
    }
  }
  return dst;
}

/** Bilinear resample of a single-channel mask. */
export function resampleMask(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = Math.round(a * (1 - ty) + b * ty);
    }
  }
  return out;
}

/**
 * Multiply the alpha channel of straight RGBA data by a same-size erase map
 * (255 = keep, 0 = remove). Used to apply brush edits to the shadow layer.
 */
export function applyEraseToAlpha(data: Uint8ClampedArray, erase: Uint8Array): void {
  const n = Math.min(erase.length, data.length >> 2);
  for (let i = 0; i < n; i++) data[i * 4 + 3] = Math.round((data[i * 4 + 3] * erase[i]) / 255);
}

/** Bounding box of pixels whose alpha exceeds threshold (RGBA data). */
export function alphaBBox(data: Uint8ClampedArray, w: number, h: number, threshold = 8) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > threshold) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

/** Compute exact dimensions respecting aspect lock and limits. */
export function fitDims(w: number, h: number, maxSide: number, maxPixels: number): { width: number; height: number } {
  let s = Math.min(1, maxSide / Math.max(w, h));
  if (w * h * s * s > maxPixels) s = Math.sqrt(maxPixels / (w * h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export function validateDims(w: number, h: number, maxSide: number, maxPixels: number): string | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return "Width and height must be whole numbers of at least 1 px.";
  if (w > maxSide || h > maxSide) return `Each side must be at most ${maxSide} px.`;
  if (w * h > maxPixels) return `That is ${(w * h / 1e6).toFixed(1)} MP; the limit is ${(maxPixels / 1e6).toFixed(1)} MP to stay within browser canvas memory.`;
  return null;
}
