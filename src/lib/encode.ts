// Real encoders. Browser canvas encoders never write EXIF/GPS metadata, so every export is metadata-free.
import UPNG from "upng-js";
import { zipSync } from "fflate";
import { ctx2d, mkCanvas } from "./render";
import type { ExportFormat } from "./types";

export const MIME: Record<ExportFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif" };
export const EXT: Record<ExportFormat, string> = { png: "png", jpeg: "jpg", webp: "webp", avif: "avif" };
export const hasAlpha = (f: ExportFormat) => f !== "jpeg";
export const isLossy = (f: ExportFormat) => f !== "png";

export function canvasToBlob(c: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) => {
    try {
      c.toBlob((b) => {
        if (!b) rej(new Error("The browser failed to encode this image (likely a canvas memory limit). Try smaller output dimensions."));
        else if (b.type !== mime) rej(new Error(`This browser cannot encode ${mime}.`));
        else res(b);
      }, mime, quality);
    } catch (e) { rej(e); }
  });
}

let avifSupport: Promise<boolean> | null = null;
/** Detect genuine AVIF encoding support: the browser must return an actual image/avif blob. */
export function supportsAvif(): Promise<boolean> {
  if (!avifSupport) {
    avifSupport = new Promise((res) => {
      const c = mkCanvas(2, 2);
      c.toBlob((b) => res(!!b && b.type === "image/avif"), "image/avif", 0.5);
    });
  }
  return avifSupport;
}

export async function encodeCanvas(c: HTMLCanvasElement, format: ExportFormat, quality: number): Promise<Blob> {
  return canvasToBlob(c, MIME[format], isLossy(format) ? Math.min(1, Math.max(0.01, quality / 100)) : undefined);
}

/** PNG via UPNG: colors=0 → lossless (filter-optimised deflate); colors>0 → palette quantisation (LOSSY). */
export function encodePngUpng(c: HTMLCanvasElement, colors: number): Blob {
  const id = ctx2d(c).getImageData(0, 0, c.width, c.height);
  const buf = UPNG.encode([id.data.buffer as ArrayBuffer], c.width, c.height, colors);
  return new Blob([buf], { type: "image/png" });
}

export function flattenCanvas(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = mkCanvas(src.width, src.height);
  const x = ctx2d(c);
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
  return c;
}

export function scaleCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  if (src.width === w && src.height === h) return src;
  // Step down in halves for better downscaling quality.
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const n = mkCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    ctx2d(n).drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  const out = mkCanvas(w, h);
  ctx2d(out).drawImage(cur, 0, 0, w, h);
  return out;
}

export type CompressMode = "jpeg" | "webp" | "png-lossless" | "png-palette" | "avif";

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  quality: number | null;
  colors: number | null;
  attempts: number;
  reachedTarget: boolean | null;
  note: string | null;
}

async function encodeMode(c: HTMLCanvasElement, mode: CompressMode, q: number, colors: number): Promise<Blob> {
  if (mode === "png-lossless") return encodePngUpng(c, 0);
  if (mode === "png-palette") return encodePngUpng(c, colors);
  return encodeCanvas(c, mode, q);
}

/**
 * Compress with optional target size. Bounded: ≤8 quality attempts (binary search), then (only if
 * allowResize) ≤6 downscale attempts. Never claims success unless the encoded blob meets the target.
 */
export async function compress(
  src: HTMLCanvasElement, mode: CompressMode, quality: number, colors: number,
  targetBytes: number | null, allowResize: boolean, isCancelled: () => boolean = () => false,
): Promise<CompressResult> {
  let attempts = 0;
  const enc = async (c: HTMLCanvasElement, q: number, col: number) => { attempts++; return encodeMode(c, mode, q, col); };
  if (!targetBytes) {
    const blob = await enc(src, quality, colors);
    return { blob, width: src.width, height: src.height, quality: mode === "jpeg" || mode === "webp" || mode === "avif" ? quality : null, colors: mode === "png-palette" ? colors : null, attempts, reachedTarget: null, note: null };
  }
  const lossyQ = mode === "jpeg" || mode === "webp" || mode === "avif";
  let best: { blob: Blob; q: number; col: number } | null = null;
  let smallest: { blob: Blob; q: number; col: number } | null = null;
  if (lossyQ) {
    let lo = 5, hi = 100;
    while (lo <= hi && attempts < 8) {
      if (isCancelled()) throw new DOMException("Cancelled", "AbortError");
      const mid = Math.round((lo + hi) / 2);
      const b = await enc(src, mid, colors);
      if (!smallest || b.size < smallest.blob.size) smallest = { blob: b, q: mid, col: colors };
      if (b.size <= targetBytes) { best = { blob: b, q: mid, col: colors }; lo = mid + 1; } else hi = mid - 1;
    }
  } else if (mode === "png-palette") {
    for (const col of [256, 128, 64, 32, 16, 8]) {
      if (isCancelled()) throw new DOMException("Cancelled", "AbortError");
      const b = await enc(src, quality, col);
      if (!smallest || b.size < smallest.blob.size) smallest = { blob: b, q: quality, col };
      if (b.size <= targetBytes) { best = { blob: b, q: quality, col }; break; }
    }
  } else {
    const b = await enc(src, quality, 0);
    smallest = { blob: b, q: quality, col: 0 };
    if (b.size <= targetBytes) best = smallest;
  }
  const qOut = (q: number) => (lossyQ ? q : null);
  const cOut = (c: number) => (mode === "png-palette" ? c : null);
  if (best) return { blob: best.blob, width: src.width, height: src.height, quality: qOut(best.q), colors: cOut(best.col), attempts, reachedTarget: true, note: null };
  if (allowResize) {
    let scale = 1;
    const q = lossyQ ? Math.max(40, smallest!.q) : quality;
    const col = smallest!.col || colors;
    for (let i = 0; i < 6; i++) {
      if (isCancelled()) throw new DOMException("Cancelled", "AbortError");
      scale *= 0.8;
      const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
      const c = scaleCanvas(src, w, h);
      const b = await enc(c, q, col);
      if (b.size <= targetBytes) return { blob: b, width: w, height: h, quality: qOut(q), colors: cOut(col), attempts, reachedTarget: true, note: `Dimensions were reduced to ${w}×${h} to reach the target (you allowed resizing).` };
      if (b.size < smallest!.blob.size) smallest = { blob: b, q, col };
    }
  }
  const s = smallest!;
  return {
    blob: s.blob, width: src.width, height: src.height, quality: qOut(s.q), colors: cOut(s.col), attempts, reachedTarget: false,
    note: mode === "png-lossless"
      ? "Lossless PNG cannot be forced below a size. Try WebP/JPG, palette PNG, or allow resizing."
      : `The target could not be reached within ${attempts} bounded attempts at these constraints. Showing the smallest result found${allowResize ? "" : "; allowing resizing may help"}.`,
  };
}

export function sanitizeName(n: string): string {
  const s = n.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\w\- .()]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);
  return s || "image";
}

export function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name, i = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem} (${i++})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function makeZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const used = new Set<string>();
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[uniqueName(f.name, used)] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  const out = zipSync(entries);
  return new Blob([out.buffer as ArrayBuffer], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
