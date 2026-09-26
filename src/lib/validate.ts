import { MAX_DECODED_PIXELS, MAX_FILE_BYTES } from "./config";

export type Sniffed = "image/jpeg" | "image/png" | "image/webp";

export interface SniffResult {
  ok: boolean;
  type?: Sniffed;
  error?: string;
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/** Identify format from file content (magic bytes) and reject animated or unsupported formats. */
export function sniffBytes(b: Uint8Array): SniffResult {
  if (b.length < 12) return { ok: false, error: "The file is too small to be a valid image." };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ok: true, type: "image/jpeg" };
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) {
    // Scan chunks for acTL (APNG animation control) before IDAT.
    let o = 8;
    while (o + 8 <= b.length) {
      const len = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      const t = ascii(b, o + 4, 4);
      if (t === "acTL") return { ok: false, error: "Animated PNG (APNG) is not supported. Only a single frame would be processed, so please export one frame as a still PNG first." };
      if (t === "IDAT" || t === "IEND") break;
      o += 12 + len;
    }
    return { ok: true, type: "image/png" };
  }
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const fourcc = ascii(b, 12, 4);
    if (fourcc === "VP8X" && b.length > 20 && (b[20] & 0x02)) {
      return { ok: false, error: "Animated WebP is not supported. Only a single frame would be processed, so please use a still image." };
    }
    return { ok: true, type: "image/webp" };
  }
  if (ascii(b, 0, 3) === "GIF") return { ok: false, error: "GIF isn't supported (it's often animated). Please convert it to PNG, JPG or WebP." };
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (/heic|heix|mif1|msf1|hevc/.test(brand)) return { ok: false, error: "HEIC/HEIF photos aren't supported yet because no decoder is included. Export as JPG from your phone or Photos app." };
    if (/avif|avis/.test(brand)) return { ok: false, error: "AVIF input isn't supported. Please use JPG, PNG or WebP." };
  }
  if (ascii(b, 0, 2) === "BM") return { ok: false, error: "BMP isn't supported. Please use JPG, PNG or WebP." };
  if (/^\s*<(\?xml|svg)/i.test(ascii(b, 0, 12))) return { ok: false, error: "SVG isn't supported. Please upload a raster image (JPG, PNG or WebP)." };
  return { ok: false, error: "This file isn't a JPG, PNG or WebP image (checked from its contents, not its name)." };
}

/** Read declared pixel dimensions from the file header (JPEG SOF, PNG IHDR, WebP VP8/VP8L/VP8X). */
export function headerDims(b: Uint8Array, type: Sniffed): { w: number; h: number } | null {
  if (type === "image/png" && b.length >= 24) {
    const r = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    return { w: r(16), h: r(20) };
  }
  if (type === "image/webp" && b.length >= 30) {
    const f = ascii(b, 12, 4);
    if (f === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (f === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (f === "VP8 ") return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (type === "image/jpeg") {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: (b[o + 5] << 8) | b[o + 6], w: (b[o + 7] << 8) | b[o + 8] };
      }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { o += m === 0xff ? 1 : 2; continue; }
      o += 2 + ((b[o + 2] << 8) | b[o + 3]);
    }
  }
  return null;
}

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  type: Sniffed;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Read the header for sniffing; with progress reporting for large files. */
async function readHead(file: File): Promise<Uint8Array> {
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  return new Uint8Array(buf);
}

/** Validate size, content type and decoded pixel count, then decode with EXIF orientation applied. */
export async function validateAndDecode(file: File, signal?: AbortSignal): Promise<DecodedImage> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}.`);
  }
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  const head = await readHead(file);
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const s = sniffBytes(head);
  if (!s.ok || !s.type) throw new Error(`${file.name}: ${s.error}`);
  // Check declared dimensions before decoding so huge images can't exhaust memory.
  const dims = headerDims(head, s.type);
  if (dims && dims.w * dims.h > MAX_DECODED_PIXELS) {
    throw new Error(`${file.name} is ${dims.w}×${dims.h} (${(dims.w * dims.h / 1e6).toFixed(1)} MP). The limit is ${(MAX_DECODED_PIXELS / 1e6).toFixed(0)} MP decoded pixels.`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name} could not be decoded. The file may be corrupt or use an unsupported variant.`);
  }
  if (signal?.aborted) { bitmap.close(); throw new DOMException("Cancelled", "AbortError"); }
  const px = bitmap.width * bitmap.height;
  if (px > MAX_DECODED_PIXELS) {
    const w = bitmap.width, h = bitmap.height;
    bitmap.close();
    throw new Error(`${file.name} is ${w}×${h} (${(px / 1e6).toFixed(1)} MP). The limit is ${(MAX_DECODED_PIXELS / 1e6).toFixed(0)} MP decoded pixels.`);
  }
  return { bitmap, width: bitmap.width, height: bitmap.height, type: s.type };
}
