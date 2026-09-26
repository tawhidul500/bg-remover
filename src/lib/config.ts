// Central, configurable settings. NEXT_PUBLIC_* values are inlined at build time.
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Cutout Studio";
export const PARENT_SITE_NAME = "Clipping World";
export const PARENT_SITE_URL = process.env.NEXT_PUBLIC_PARENT_SITE_URL || "https://www.clippingworld.com";

/** Max accepted file size in bytes (default 25 MB). */
export const MAX_FILE_BYTES = num(process.env.NEXT_PUBLIC_MAX_FILE_MB, 25) * 1024 * 1024;
/** Max decoded pixels of an uploaded image (default 40 MP). */
export const MAX_DECODED_PIXELS = num(process.env.NEXT_PUBLIC_MAX_DECODED_MP, 40) * 1_000_000;
/** Max working (segmentation input) long side in px. */
export const MAX_WORKING_SIDE = num(process.env.NEXT_PUBLIC_MAX_WORKING_SIDE, 4096);
/** Default working long side after upload (keeps editing responsive). */
export const DEFAULT_WORKING_SIDE = num(process.env.NEXT_PUBLIC_DEFAULT_WORKING_SIDE, 2560);
/** Max output canvas pixels (browser canvas limits; iOS Safari ≈ 16.7 MP). */
export const MAX_OUTPUT_PIXELS = num(process.env.NEXT_PUBLIC_MAX_OUTPUT_MP, 16.7) * 1_000_000;
export const MAX_OUTPUT_SIDE = 8192;
/** Max images in a batch/tray. */
export const MAX_BATCH = num(process.env.NEXT_PUBLIC_MAX_BATCH, 20);
/** Preview render long-side cap (CSS px * DPR, bounded). */
export const PREVIEW_MAX_SIDE = 1800;
/** Base URL for model weights. Defaults to Hugging Face hub; set to your own host (e.g. /models/) to self-host. */
export const MODEL_HOST = process.env.NEXT_PUBLIC_MODEL_HOST || "";

export const MODELS = {
  general: {
    id: "BritishWerewolf/IS-Net",
    kind: "isnet",
    label: "General (IS-Net)",
    note: "People, products, animals and objects. ~179 MB one-time download, cached by your browser.",
    license: "Apache-2.0",
    webgpuOnly: false,
  },
  portrait: {
    id: "Xenova/modnet",
    kind: "pipeline",
    label: "Fast portrait (MODNet)",
    note: "Optimised for people/portraits only. ~7–13 MB download.",
    license: "Apache-2.0",
    webgpuOnly: false,
  },
  detail: {
    id: "onnx-community/BiRefNet_lite-ONNX",
    kind: "pipeline",
    label: "High detail (BiRefNet-lite, WebGPU)",
    note: "Finer edges; needs a WebGPU-capable browser/GPU (≈115 MB fp16). Too memory-hungry for WebAssembly.",
    license: "MIT",
    webgpuOnly: true,
  },
} as const;
export type ModelKey = keyof typeof MODELS;

export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
