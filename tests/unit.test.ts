import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sanitizeName, uniqueName } from "../src/lib/encode";
import { History } from "../src/lib/history";
import { applyAdjustments, applyEraseToAlpha, blurRGBA, fitDims, hexToRgb, morph, paintDab, refineMask, resampleMask, rgbToHex, transformMaskForInput, validateDims } from "../src/lib/imageops";
import { alignSubject, padCanvas, resizeCanvasState } from "../src/lib/layout";
import { defaultState, inputKey, ZERO_ADJ } from "../src/lib/types";
import { headerDims, sniffBytes } from "../src/lib/validate";

const bytes = (...a: (number | string)[]) => {
  const out: number[] = [];
  for (const x of a) typeof x === "string" ? out.push(...[...x].map((c) => c.charCodeAt(0))) : out.push(x);
  while (out.length < 40) out.push(0);
  return new Uint8Array(out);
};

describe("upload validation (content sniffing)", () => {
  it("detects real JPEG fixture and its dimensions", () => {
    const b = new Uint8Array(readFileSync("tests/fixtures/portrait.jpg"));
    const s = sniffBytes(b);
    expect(s).toEqual({ ok: true, type: "image/jpeg" });
    expect(headerDims(b, "image/jpeg")).toEqual({ w: 800, h: 1200 });
  });
  it("detects PNG and reads IHDR", () => {
    const b = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, "IHDR", 0, 0, 0x0f, 0xa0, 0, 0, 0x0b, 0xb8);
    expect(sniffBytes(b).type).toBe("image/png");
    expect(headerDims(b, "image/png")).toEqual({ w: 4000, h: 3000 });
  });
  it("rejects APNG, animated WebP, GIF, HEIC and renamed text", () => {
    expect(sniffBytes(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 8, "acTL")).ok).toBe(false);
    expect(sniffBytes(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8X", 10, 0, 0, 0, 0x02)).error).toMatch(/Animated WebP/);
    expect(sniffBytes(bytes("GIF89a")).error).toMatch(/GIF/);
    expect(sniffBytes(bytes(0, 0, 0, 0x18, "ftypheic")).error).toMatch(/HEIC/);
    expect(sniffBytes(bytes("hello world, not an image")).ok).toBe(false);
  });
  it("accepts still WebP", () => {
    expect(sniffBytes(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")).type).toBe("image/webp");
  });
});

describe("colour adjustments", () => {
  it("neutral adjustments leave pixels untouched", () => {
    const d = new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 50, 128]);
    const c = new Uint8ClampedArray(d);
    applyAdjustments(d, 2, 1, ZERO_ADJ);
    expect(d).toEqual(c);
  });
  it("never changes alpha and skips fully transparent pixels", () => {
    const d = new Uint8ClampedArray([100, 100, 100, 77, 50, 60, 70, 0]);
    applyAdjustments(d, 2, 1, { ...ZERO_ADJ, exposure: 50, contrast: 30, saturation: 40, sharpness: 50 });
    expect(d[3]).toBe(77);
    expect([...d.slice(4)]).toEqual([50, 60, 70, 0]);
    expect(d[0]).toBeGreaterThan(100);
  });
  it("saturation −100 produces grey", () => {
    const d = new Uint8ClampedArray([200, 50, 50, 255]);
    applyAdjustments(d, 1, 1, { ...ZERO_ADJ, saturation: -100 });
    expect(d[0]).toBe(d[1]); expect(d[1]).toBe(d[2]);
  });
  it("premultiplied blur does not darken edges next to transparency", () => {
    const d = new Uint8ClampedArray(4 * 10);
    for (let i = 0; i < 5; i++) d.set([255, 255, 255, 255], i * 4);
    blurRGBA(d, 10, 1, 3);
    for (let i = 0; i < 10; i++) if (d[i * 4 + 3] > 0) expect(d[i * 4]).toBeGreaterThanOrEqual(250);
  });
});

describe("mask operations", () => {
  it("erase and restore brush modify the mask from the stroke base", () => {
    const w = 20, h = 20;
    const base = new Uint8Array(w * h).fill(255);
    const mask = base.slice(); const stroke = new Uint8Array(w * h);
    paintDab(mask, base, stroke, w, h, { x: 10, y: 10, radius: 4, hardness: 1, opacity: 1 }, true);
    expect(mask[10 * w + 10]).toBe(0);
    expect(mask[0]).toBe(255);
    const base2 = mask.slice(); const m2 = base2.slice();
    paintDab(m2, base2, new Uint8Array(w * h), w, h, { x: 10, y: 10, radius: 4, hardness: 1, opacity: 0.5 }, false);
    expect(m2[10 * w + 10]).toBeGreaterThan(120);
    expect(m2[10 * w + 10]).toBeLessThan(135);
  });
  it("overlapping dabs in one stroke don't accumulate beyond opacity", () => {
    const w = 10, base = new Uint8Array(100).fill(255), m = base.slice(), s = new Uint8Array(100);
    for (let i = 0; i < 5; i++) paintDab(m, base, s, w, 10, { x: 5, y: 5, radius: 3, hardness: 1, opacity: 0.5 }, true);
    expect(m[55]).toBe(127);
  });
  it("expand/contract via morphology", () => {
    const m = new Uint8Array(25); m[12] = 255;
    expect(morph(m, 5, 5, 1, true).filter((v) => v === 255).length).toBe(9);
    expect(morph(morph(m, 5, 5, 1, true), 5, 5, 1, false)[12]).toBe(255);
    expect(refineMask(m, 5, 5, -1, 0)[12]).toBe(0);
  });
  it("resamples masks to exact target dimensions", () => {
    const m = new Uint8Array([0, 255, 0, 255]);
    const r = resampleMask(m, 2, 2, 7, 3);
    expect(r.length).toBe(21);
  });
  it("input transform keeps the mask: identity is a no-op", () => {
    const src = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const t = { width: 3, height: 2, rotate: 0 as const, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } };
    expect([...transformMaskForInput(src, 3, 2, t, { ...t }, 6, 4)]).toEqual([...src]);
  });
  it("input transform keeps the mask: horizontal flip mirrors it", () => {
    const src = new Uint8Array([10, 20, 30]);
    const prev = { width: 3, height: 1, rotate: 0 as const, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } };
    const next = { ...prev, flipH: true };
    expect([...transformMaskForInput(src, 3, 1, prev, next, 3, 1)]).toEqual([30, 20, 10]);
  });
  it("input transform keeps the mask: 90° turn rotates it", () => {
    const src = new Uint8Array([10, 20, 30, 40]); // [[10,20],[30,40]]
    const prev = { width: 2, height: 2, rotate: 0 as const, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } };
    const next = { ...prev, rotate: 90 as const };
    expect([...transformMaskForInput(src, 2, 2, prev, next, 2, 2)]).toEqual([30, 10, 40, 20]);
  });
  it("input transform keeps the mask: trim keeps the kept half", () => {
    const src = new Uint8Array([10, 20, 30, 40]);
    const prev = { width: 4, height: 1, rotate: 0 as const, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } };
    const next = { width: 2, height: 1, rotate: 0 as const, flipH: false, flipV: false, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    expect([...transformMaskForInput(src, 4, 1, prev, next, 4, 1)]).toEqual([30, 40]);
  });
  it("restores real mask values when reducing trim and resetting crop", () => {
    const source = new Uint8Array([8, 25, 50, 88, 144, 199, 224, 255]);
    const full = { width: 8, height: 1, rotate: 0 as const, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } };
    const half = { ...full, width: 4, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    const quarter = { ...full, width: 6, crop: { x: 0.25, y: 0, w: 0.75, h: 1 } };
    const trimmed = transformMaskForInput(source, 8, 1, full, half, 8, 1);
    expect([...trimmed]).toEqual([144, 199, 224, 255]);
    // The old destructive path cannot restore pixels which are no longer present.
    expect([...transformMaskForInput(trimmed, 4, 1, half, full, 8, 1)]).not.toEqual([...source]);
    expect([...transformMaskForInput(source, 8, 1, full, quarter, 8, 1)]).toEqual([50, 88, 144, 199, 224, 255]);
    expect([...transformMaskForInput(source, 8, 1, full, full, 8, 1)]).toEqual([...source]);
  });
  it("merges a cropped brush edit while keeping hidden mask pixels", () => {
    const source = new Uint8Array([8, 25, 50, 88, 144, 199, 224, 255]);
    const full = { width: 8, height: 1, rotate: 0 as const, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } };
    const half = { ...full, width: 4, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    const edited = transformMaskForInput(source, 8, 1, full, half, 8, 1);
    edited[0] = 0;
    const merged = transformMaskForInput(edited, 4, 1, half, full, 8, 1,
      { fallback: source, region: { x0: 0, y0: 0, x1: 0, y1: 0 } });
    expect([...merged]).toEqual([8, 25, 50, 88, 0, 199, 224, 255]);
    expect([...transformMaskForInput(merged, 8, 1, full, full, 8, 1)]).toEqual([...merged]);
  });
});

describe("dimensions & layout", () => {
  it("fitDims respects side and pixel limits", () => {
    expect(fitDims(4000, 2000, 2000, 1e9)).toEqual({ width: 2000, height: 1000 });
    const d = fitDims(4000, 4000, 8000, 4e6);
    expect(d.width * d.height).toBeLessThanOrEqual(4e6 + 4000);
  });
  it("validateDims rejects bad input", () => {
    expect(validateDims(0, 10, 100, 1e6)).toBeTruthy();
    expect(validateDims(1.5, 10, 100, 1e6)).toBeTruthy();
    expect(validateDims(200, 10, 100, 1e6)).toBeTruthy();
    expect(validateDims(100, 100, 100, 1e6)).toBeNull();
  });
  it("resize canvas: fit centres, fill covers, anchors position the subject", () => {
    const s = defaultState(1000, 500, "x");
    const fit = resizeCanvasState(s, 1000, 1000, "fit", "c");
    expect(fit.canvas).toMatchObject({ width: 1000, height: 1000, fit: "fit", anchor: "c" });
    expect(fit.subject.scale).toBe(1); expect(fit.subject.y).toBe(0.5);
    expect(fit.export.width).toBe(1000);
    const fill = resizeCanvasState(s, 1000, 1000, "fill", "c");
    expect(fill.canvas.fit).toBe("fill");
    expect(fill.subject.scale).toBe(2);
    const top = resizeCanvasState(s, 1000, 1000, "fit", "t");
    expect(top.subject.y).toBeCloseTo(0.25);
  });
  it("padCanvas keeps subject pixel size", () => {
    const s = defaultState(1000, 500, "x");
    const p = padCanvas(s, 100);
    const size = (st: typeof s) => Math.min(st.canvas.width / 1000, st.canvas.height / 500) * st.subject.scale * 1000;
    expect(p.canvas).toMatchObject({ width: 1200, height: 700, fit: "fit", anchor: "c" });
    expect(size(p)).toBeCloseTo(size(s));
  });
  it("alignSubject centres the visible bbox", () => {
    const s = defaultState(1000, 1000, "x");
    const a = alignSubject(s, { x: 0, y: 0, w: 200, h: 200 }, "center");
    expect(a.subject.x).toBeCloseTo(0.9); expect(a.subject.y).toBeCloseTo(0.9);
  });
  it("inputKey changes with geometry", () => {
    const s = defaultState(10, 10, "x");
    expect(inputKey(s.input)).not.toBe(inputKey({ ...s.input, rotate: 90 }));
  });
});

describe("misc", () => {
  it("unique names avoid collisions case-insensitively", () => {
    const used = new Set<string>();
    expect(uniqueName("a.png", used)).toBe("a.png");
    expect(uniqueName("A.png", used)).toBe("A (2).png");
    expect(uniqueName("a.png", used)).toBe("a (3).png");
  });
  it("sanitizes filenames", () => {
    expect(sanitizeName("../../etc/passwd.jpg")).not.toContain("/");
    expect(sanitizeName("")).toBe("image");
  });
  it("hex/rgb round trip", () => {
    expect(rgbToHex(...hexToRgb("#2E45A7")!)).toBe("#2e45a7");
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("zzz")).toBeNull();
  });
  it("shadow erase map multiplies alpha only (RGB untouched)", () => {
    const d = new Uint8ClampedArray([10, 20, 30, 200, 40, 50, 60, 100, 70, 80, 90, 255, 1, 2, 3, 0]);
    applyEraseToAlpha(d, new Uint8Array([0, 128, 255, 0]));
    expect([...d]).toEqual([10, 20, 30, 0, 40, 50, 60, 50, 70, 80, 90, 255, 1, 2, 3, 0]);
  });
  it("history is bounded and undo/redo round-trip", () => {
    const h = new History(3);
    const st = defaultState(10, 10, "x");
    const automatic = new Uint8Array([0, 200, 255]);
    for (let i = 0; i < 5; i++) h.push({ state: st, mask: null, autoMask: automatic, maskInputKey: null, maskReserve: null, shadowErase: null, label: `${i}` });
    expect(h.past.length).toBe(3);
    expect(h.maskBytes()).toBe(automatic.byteLength);
    const u = h.undo({ state: st, mask: null, autoMask: automatic, maskInputKey: null, maskReserve: null, shadowErase: null, label: "" });
    expect(u?.label).toBe("4");
    expect(u?.autoMask).toBe(automatic);
    expect(h.canRedo).toBe(true);
  });
});
