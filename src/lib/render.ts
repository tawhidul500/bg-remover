// Single rendering pipeline used for BOTH the interactive preview and full-resolution export.
// Preview simply renders at a smaller scale factor `k` (output px per canvas px); every
// distance (offsets, blur radii) is multiplied by k so the two match.
//
// Order:
// 1 decode+orient (createImageBitmap from-image) → 2 input transform (crop/rotate/flip/resize)
// 3 mask → 4 refine (expand/contract, feather) → 5 subject adjustments
// 6 subject placement + shadow → 7 background (+ background adjustments)
// 8 composite bg → shadow → subject → 9 global adjustments → 10 resize/encode (encode.ts)
import { alphaBBox, applyAdjustments, applyEraseToAlpha, blurChannel, blurRGBA, isNeutral, refineMask, resampleMask } from "./imageops";
import type { InputTransform, ProjectState } from "./types";

export type AnyCanvas = HTMLCanvasElement;

export function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) throw new Error("Your browser could not allocate a canvas of this size. Try smaller dimensions.");
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  return x;
}

/** Step 2: build the working image from the oriented original. */
export function buildWorking(src: CanvasImageSource & { width: number; height: number }, t: InputTransform): HTMLCanvasElement {
  const c = mkCanvas(t.width, t.height);
  const x = ctx2d(c);
  const cx = t.crop.x * src.width, cy = t.crop.y * src.height;
  const cw = Math.max(1, t.crop.w * src.width), ch = Math.max(1, t.crop.h * src.height);
  const swap = t.rotate === 90 || t.rotate === 270;
  const dw = swap ? t.height : t.width, dh = swap ? t.width : t.height;
  x.translate(t.width / 2, t.height / 2);
  x.rotate((t.rotate * Math.PI) / 180);
  x.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
  x.drawImage(src, cx, cy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  return c;
}

/** Oriented dims of the crop area before rotation-swap, used to derive working dims. */
export function inputAspect(srcW: number, srcH: number, t: Pick<InputTransform, "crop" | "rotate">): number {
  const w = t.crop.w * srcW, h = t.crop.h * srcH;
  return t.rotate === 90 || t.rotate === 270 ? h / w : w / h;
}

export interface RenderOptions {
  overlay?: boolean;
  /** Fill color painted below everything (flattening for JPG / opaque export). */
  flatten?: string | null;
}

export class Renderer {
  original: ImageBitmap | null = null;
  /** Full-resolution transformed source for preview/original mode. AI uses the smaller working canvas. */
  private originalWorking: HTMLCanvasElement | null = null;
  working: HTMLCanvasElement | null = null;
  private workingData: ImageData | null = null;
  mask: Uint8Array | null = null;
  maskVersion = 0;
  /** Shadow brush edits in canvas space: 255 = keep shadow, 0 = erased. Null = untouched. */
  shadowErase: Uint8Array | null = null;
  shadowEraseW = 0;
  shadowEraseH = 0;
  shadowVersion = 0;
  bgImage: ImageBitmap | null = null;
  private refined: { key: string; mask: Uint8Array } | null = null;
  private cutout: { key: string; canvas: HTMLCanvasElement; bbox: { x: number; y: number; w: number; h: number } | null } | null = null;
  private overlayC: { key: number; canvas: HTMLCanvasElement } | null = null;
  private shadowScaled: { key: string; buf: Uint8Array } | null = null;

  setOriginal(bm: ImageBitmap) { this.original = bm; }

  setInput(t: InputTransform) {
    if (!this.original) return;
    // Keep a full-resolution canvas for the original preview.
    // The working canvas remains optimized for AI segmentation.
    const fullScale = Math.max(1, this.original.width / t.width, this.original.height / t.height);
    this.originalWorking = buildWorking(this.original, {
      ...t,
      width: Math.max(1, Math.round(t.width * fullScale)),
      height: Math.max(1, Math.round(t.height * fullScale)),
    });
    this.working = buildWorking(this.original, t);
    this.workingData = ctx2d(this.working).getImageData(0, 0, t.width, t.height);
    this.cutout = null; this.overlayC = null;
  }

  setMask(m: Uint8Array | null) { this.mask = m; this.bumpMask(); }
  bumpMask() { this.maskVersion++; this.cutout = null; this.refined = null; }

  setShadowErase(m: Uint8Array | null, w = 0, h = 0) {
    this.shadowErase = m; this.shadowEraseW = w; this.shadowEraseH = h;
    this.shadowVersion++; this.shadowScaled = null;
  }
  bumpShadow() { this.shadowVersion++; this.shadowScaled = null; }

  /** Resample stored shadow edits to the current canvas size (after frame changes). */
  ensureShadowDims(w: number, h: number) {
    if (!this.shadowErase) return;
    if (this.shadowEraseW === w && this.shadowEraseH === h && this.shadowErase.length === w * h) return;
    this.shadowErase = resampleMask(this.shadowErase, this.shadowEraseW, this.shadowEraseH, w, h);
    this.shadowEraseW = w; this.shadowEraseH = h;
    this.shadowVersion++; this.shadowScaled = null;
  }

  shadowEraseScaled(W: number, H: number): Uint8Array {
    const key = `${this.shadowVersion}|${W}x${H}`;
    if (this.shadowScaled?.key !== key) {
      const se = this.shadowErase!;
      this.shadowScaled = {
        key,
        buf: se.length === W * H ? se : resampleMask(se, this.shadowEraseW, this.shadowEraseH, W, H),
      };
    }
    return this.shadowScaled.buf;
  }

  get ww() { return this.working?.width ?? 1; }
  get wh() { return this.working?.height ?? 1; }

  refinedMask(expand: number, feather: number): Uint8Array | null {
    if (!this.mask) return null;
    const key = `${this.maskVersion}|${expand}|${feather}`;
    if (this.refined?.key !== key) this.refined = { key, mask: refineMask(this.mask, this.ww, this.wh, expand, feather) };
    return this.refined.mask;
  }

  /** Step 3–4: working image with refined alpha applied. */
  getCutout(state: ProjectState) {
    if (!this.working || !this.workingData) return null;
    const key = `${this.maskVersion}|${state.refine.expand}|${state.refine.feather}`;
    if (this.cutout?.key === key) return this.cutout;
    const m = this.refinedMask(state.refine.expand, state.refine.feather);
    if (!m) {
      this.cutout = { key, canvas: this.working, bbox: { x: 0, y: 0, w: this.ww, h: this.wh } };
      return this.cutout;
    }
    const c = mkCanvas(this.ww, this.wh);
    const id = new ImageData(new Uint8ClampedArray(this.workingData.data), this.ww, this.wh);
    const d = id.data;
    for (let i = 0, j = 3; i < m.length; i++, j += 4) d[j] = Math.round((d[j] * m[i]) / 255);
    ctx2d(c).putImageData(id, 0, 0);
    this.cutout = { key, canvas: c, bbox: alphaBBox(d, this.ww, this.wh) };
    return this.cutout;
  }

  /** Apply subject transform to a context scaled by k. */
  private subjectMatrix(x: CanvasRenderingContext2D, state: ProjectState, k: number) {
    const { canvas: cv, subject: s } = state;
    const base = Math.min(cv.width / this.ww, cv.height / this.wh) * s.scale;
    x.translate(s.x * cv.width * k, s.y * cv.height * k);
    x.rotate((s.rotation * Math.PI) / 180);
    x.scale(base * k * (s.flipH ? -1 : 1), base * k * (s.flipV ? -1 : 1));
    x.translate(-this.ww / 2, -this.wh / 2);
  }

  /** Map a point in canvas (composition) coords to working/mask coords. */
  canvasToMask(state: ProjectState, px: number, py: number): { x: number; y: number; scale: number } {
    const { canvas: cv, subject: s } = state;
    const base = Math.min(cv.width / this.ww, cv.height / this.wh) * s.scale;
    let dx = px - s.x * cv.width, dy = py - s.y * cv.height;
    const a = (-s.rotation * Math.PI) / 180;
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    dx = (rx / base) * (s.flipH ? -1 : 1); dy = (ry / base) * (s.flipV ? -1 : 1);
    return { x: dx + this.ww / 2, y: dy + this.wh / 2, scale: base };
  }

  private drawBackground(x: CanvasRenderingContext2D, state: ProjectState, W: number, H: number, k: number) {
    const bg = state.background;
    switch (bg.type) {
      case "color": x.fillStyle = bg.color; x.fillRect(0, 0, W, H); break;
      case "linear": {
        const a = (bg.gradient.angle * Math.PI) / 180;
        const hl = Math.abs((W / 2) * Math.sin(a)) + Math.abs((H / 2) * Math.cos(a));
        const vx = Math.sin(a) * hl, vy = -Math.cos(a) * hl;
        const g = x.createLinearGradient(W / 2 - vx, H / 2 - vy, W / 2 + vx, H / 2 + vy);
        g.addColorStop(0, bg.gradient.from); g.addColorStop(1, bg.gradient.to);
        x.fillStyle = g; x.fillRect(0, 0, W, H); break;
      }
      case "radial": {
        const g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
        g.addColorStop(0, bg.gradient.from); g.addColorStop(1, bg.gradient.to);
        x.fillStyle = g; x.fillRect(0, 0, W, H); break;
      }
      case "original":
      case "blur": {
        if (!this.working) break;
        x.save(); this.subjectMatrix(x, state, k); x.drawImage(this.working, 0, 0); x.restore();
        if (bg.type === "blur" && bg.blur > 0) {
          const id = x.getImageData(0, 0, W, H); blurRGBA(id.data, W, H, bg.blur * k); x.putImageData(id, 0, 0);
        }
        break;
      }
      case "image": {
        const im = bg.image;
        x.fillStyle = im.fill; x.fillRect(0, 0, W, H);
        if (!this.bgImage) break;
        const sw = this.bgImage.width * im.crop.w, sh = this.bgImage.height * im.crop.h;
        const sx = this.bgImage.width * im.crop.x, sy = this.bgImage.height * im.crop.y;
        const fit = im.fit === "cover" ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
        const s = fit * im.scale;
        x.save();
        x.translate(W / 2 + (im.x * W) / 2, H / 2 + (im.y * H) / 2);
        x.rotate((im.rotation * Math.PI) / 180);
        x.drawImage(this.bgImage, sx, sy, sw, sh, (-sw * s) / 2, (-sh * s) / 2, sw * s, sh * s);
        x.restore();
        if (im.brightness || im.blur > 0) {
          const id = x.getImageData(0, 0, W, H);
          if (im.blur > 0) blurRGBA(id.data, W, H, im.blur * k);
          if (im.brightness) {
            const f = 1 + im.brightness / 100; const d = id.data;
            for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * f; d[i + 1] = d[i + 1] * f; d[i + 2] = d[i + 2] * f; }
          }
          x.putImageData(id, 0, 0);
        }
        break;
      }
      default: break;
    }
  }

  /** Render the full composition at scale k. Returns a canvas of round(canvas.w·k) × round(canvas.h·k). */
  render(state: ProjectState, k: number, opts: RenderOptions = {}): HTMLCanvasElement {
    const W = Math.max(1, Math.round(state.canvas.width * k)), H = Math.max(1, Math.round(state.canvas.height * k));
    const out = mkCanvas(W, H);
    const ox = ctx2d(out);
    const cut = this.getCutout(state);
    if (!cut) return out;

    // 5–6: subject layer + subject adjustments
    const subj = mkCanvas(W, H);
    const sx = ctx2d(subj);
    sx.save(); this.subjectMatrix(sx, state, k); sx.drawImage(cut.canvas, 0, 0); sx.restore();
    if (!isNeutral(state.adjust.subject)) {
      const id = sx.getImageData(0, 0, W, H); applyAdjustments(id.data, W, H, state.adjust.subject); sx.putImageData(id, 0, 0);
    }

    // 7: background layer + background adjustments
    const bgc = mkCanvas(W, H);
    const bx = ctx2d(bgc);
    this.drawBackground(bx, state, W, H, k);
    if (state.background.type !== "transparent" && !isNeutral(state.adjust.background)) {
      const id = bx.getImageData(0, 0, W, H); applyAdjustments(id.data, W, H, state.adjust.background); bx.putImageData(id, 0, 0);
    }

    // 8: composite
    if (opts.flatten) { ox.fillStyle = opts.flatten; ox.fillRect(0, 0, W, H); }
    ox.drawImage(bgc, 0, 0);
    const hasMask = !!this.mask;
    const sh = state.shadow;
    this.ensureShadowDims(state.canvas.width, state.canvas.height);
    const erase = this.shadowErase ? this.shadowEraseScaled(W, H) : null;
    if (hasMask && sh.contact.enabled && cut.bbox) {
      const cc = mkCanvas(W, H);
      const cx2 = ctx2d(cc);
      this.drawContact(cx2, state, k, cut.bbox);
      if (erase) {
        const id = cx2.getImageData(0, 0, W, H);
        applyEraseToAlpha(id.data, erase);
        cx2.putImageData(id, 0, 0);
      }
      ox.drawImage(cc, 0, 0);
    }
    if (hasMask && sh.drop.enabled) {
      const d = sh.drop;
      const shc = mkCanvas(W, H);
      const shx = ctx2d(shc);
      const spread = d.spread / 100;
      const a = (d.angle * Math.PI) / 180;
      const offX = Math.cos(a) * d.distance * k, offY = Math.sin(a) * d.distance * k;
      const cx = state.subject.x * W, cy = state.subject.y * H;
      shx.translate(cx + offX, cy + offY); shx.scale(spread, spread); shx.translate(-cx, -cy);
      shx.drawImage(subj, 0, 0);
      shx.setTransform(1, 0, 0, 1, 0, 0);
      shx.globalCompositeOperation = "source-in";
      shx.fillStyle = d.color; shx.fillRect(0, 0, W, H);
      if (d.blur > 0) {
        const id = shx.getImageData(0, 0, W, H);
        const al = new Uint8Array(W * H);
        for (let i = 0; i < al.length; i++) al[i] = id.data[i * 4 + 3];
        const bl = blurChannel(al, W, H, d.blur * k);
        const [r, g, b] = hexRgb(d.color);
        for (let i = 0; i < al.length; i++) { id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = bl[i]; }
        shx.putImageData(id, 0, 0);
      }
      if (erase) {
        const id = shx.getImageData(0, 0, W, H);
        applyEraseToAlpha(id.data, erase);
        shx.putImageData(id, 0, 0);
      }
      ox.globalAlpha = d.opacity / 100; ox.drawImage(shc, 0, 0); ox.globalAlpha = 1;
    }
    ox.drawImage(subj, 0, 0);

    // 9: global adjustments
    if (!isNeutral(state.adjust.global)) {
      const id = ox.getImageData(0, 0, W, H); applyAdjustments(id.data, W, H, state.adjust.global); ox.putImageData(id, 0, 0);
    }

    if (opts.overlay && this.mask) {
      ox.save(); this.subjectMatrix(ox, state, k); ox.drawImage(this.getOverlay(), 0, 0); ox.restore();
    }
    return out;
  }

  /** Unedited working image placed with the same subject transform (aligned "Original" view). */
  renderOriginal(state: ProjectState, k: number): HTMLCanvasElement {
    const out = mkCanvas(state.canvas.width * k, state.canvas.height * k);
    const source = this.originalWorking ?? this.working;
    if (!source) return out;
    const x = ctx2d(out);
    // Original preview must use the full-resolution source, not the AI working image.
    const oldW = this.ww, oldH = this.wh;
    this.subjectMatrix(x, state, k);
    x.drawImage(source, 0, 0, source.width, source.height, 0, 0, oldW, oldH);
    return out;
  }

  private drawContact(x: CanvasRenderingContext2D, state: ProjectState, k: number, bb: { x: number; y: number; w: number; h: number }) {
    const c = state.shadow.contact;
    const m = new DOMMatrix();
    const { canvas: cv, subject: s } = state;
    const base = Math.min(cv.width / this.ww, cv.height / this.wh) * s.scale;
    m.translateSelf(s.x * cv.width * k, s.y * cv.height * k).rotateSelf(s.rotation)
      .scaleSelf(base * k * (s.flipH ? -1 : 1), base * k * (s.flipV ? -1 : 1)).translateSelf(-this.ww / 2, -this.wh / 2);
    const pts = [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x, bb.y + bb.h], [bb.x + bb.w, bb.y + bb.h]].map(([px, py]) => m.transformPoint({ x: px, y: py }));
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), maxY = Math.max(...pts.map((p) => p.y));
    const rx = Math.max(1, ((maxX - minX) / 2) * (c.width / 100));
    const ry = Math.max(0.5, rx * (c.height / 100));
    const [r, g, b] = hexRgb(c.color);
    x.save();
    x.translate((minX + maxX) / 2, maxY + c.offsetY * k);
    x.scale(1, ry / rx);
    const inner = Math.max(0, Math.min(0.95, 1 - c.blur / 100));
    const gr = x.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, `rgba(${r},${g},${b},${c.opacity / 100})`);
    gr.addColorStop(inner, `rgba(${r},${g},${b},${(c.opacity / 100) * 0.6})`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.beginPath(); x.arc(0, 0, rx, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  private getOverlay(): HTMLCanvasElement {
    if (this.overlayC?.key === this.maskVersion) return this.overlayC.canvas;
    const c = mkCanvas(this.ww, this.wh);
    const x = ctx2d(c);
    const id = x.createImageData(this.ww, this.wh);
    const src = this.workingData!.data, m = this.mask!, d = id.data;
    for (let i = 0; i < m.length; i++) {
      const j = i * 4;
      d[j] = (src[j] + 255) / 2; d[j + 1] = src[j + 1] / 2; d[j + 2] = src[j + 2] / 2;
      d[j + 3] = Math.round((255 - m[i]) * 0.7);
    }
    x.putImageData(id, 0, 0);
    this.overlayC = { key: this.maskVersion, canvas: c };
    return c;
  }
}

function hexRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.padEnd(6, "0");
  return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
}

/**
 * Full-resolution export render (not a screenshot of the preview). If the export aspect differs from
 * the canvas aspect, the composition is scaled to cover and centre-cropped.
 */
export function renderExport(r: Renderer, state: ProjectState, ew: number, eh: number, flatten: string | null): HTMLCanvasElement {
  const cw = state.canvas.width, ch = state.canvas.height;
  const k = Math.max(ew / cw, eh / ch);
  const full = r.render(state, k, { flatten });
  if (full.width === ew && full.height === eh) return full;
  const out = mkCanvas(ew, eh);
  const x = ctx2d(out);
  x.drawImage(full, Math.round((ew - full.width) / 2), Math.round((eh - full.height) / 2));
  full.width = 0;
  return out;
}
