import type { ModelKey } from "./config";

export const SCHEMA_VERSION = 1;

export interface Adjustments {
  exposure: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  temperature: number; // -100..100
  tint: number; // -100..100
  highlights: number; // -100..100
  shadows: number; // -100..100
  sharpness: number; // 0..100
}
export const ZERO_ADJ: Adjustments = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, sharpness: 0,
};

export type Anchor = "tl" | "t" | "tr" | "l" | "c" | "r" | "bl" | "b" | "br";

export interface InputTransform {
  /** Working dimensions (after crop + rotation), px. */
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Crop in normalised coords of the oriented original (0..1). */
  crop: { x: number; y: number; w: number; h: number };
}

export interface SubjectTransform {
  /** Multiplier on the "fit inside canvas" base scale. */
  scale: number;
  /** Subject centre, normalised to canvas (0..1). */
  x: number;
  y: number;
  rotation: number; // degrees
  flipH: boolean;
  flipV: boolean;
}

export type BgType = "transparent" | "color" | "linear" | "radial" | "image" | "original" | "blur";

export interface BackgroundSettings {
  type: BgType;
  color: string;
  gradient: { from: string; to: string; angle: number };
  blur: number; // px (relative to canvas), for "blur" type
  image: {
    assetId: string | null;
    name: string;
    fit: "cover" | "contain";
    scale: number;
    x: number; // offset, normalised -1..1
    y: number;
    rotation: number;
    crop: { x: number; y: number; w: number; h: number };
    brightness: number; // -100..100
    blur: number; // px
    fill: string;
  };
}

export interface ShadowSettings {
  drop: { enabled: boolean; color: string; opacity: number; blur: number; angle: number; distance: number; spread: number };
  contact: { enabled: boolean; color: string; opacity: number; blur: number; width: number; height: number; offsetY: number };
}

export interface CanvasSettings {
  width: number;
  height: number;
  /** Optional for compatibility with projects saved before live resize controls. */
  fit?: "fit" | "fill" | "pad";
  anchor?: Anchor;
  padding?: number;
}

export type ExportFormat = "png" | "jpeg" | "webp" | "avif";

export interface ExportSettings {
  filename: string;
  format: ExportFormat;
  quality: number; // 1..100
  width: number;
  height: number;
  lockAspect: boolean;
  transparent: boolean;
  fill: string;
}

export interface RefineSettings {
  feather: number; // px in mask space
  expand: number; // px, negative contracts
}

export interface ProjectState {
  input: InputTransform;
  refine: RefineSettings;
  subject: SubjectTransform;
  background: BackgroundSettings;
  adjust: { subject: Adjustments; background: Adjustments; global: Adjustments };
  shadow: ShadowSettings;
  canvas: CanvasSettings;
  export: ExportSettings;
}

export interface OriginalMeta {
  name: string;
  type: string;
  size: number;
  width: number; // oriented dims
  height: number;
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  originalAssetId: string;
  original: OriginalMeta;
  /** Key of the input transform the saved mask was generated for. */
  maskInputKey: string | null;
  model: ModelKey | null;
  state: ProjectState;
}

export const inputKey = (i: InputTransform) =>
  `${i.width}x${i.height}|${i.rotate}|${+i.flipH}${+i.flipV}|${[i.crop.x, i.crop.y, i.crop.w, i.crop.h].map((v) => v.toFixed(4)).join(",")}`;

export function defaultState(w: number, h: number, baseName: string): ProjectState {
  return {
    input: { width: w, height: h, rotate: 0, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } },
    refine: { feather: 0, expand: 0 },
    subject: { scale: 1, x: 0.5, y: 0.5, rotation: 0, flipH: false, flipV: false },
    background: {
      type: "transparent",
      color: "#ffffff",
      gradient: { from: "#2E45A7", to: "#1273EB", angle: 135 },
      blur: 12,
      image: {
        assetId: null, name: "", fit: "cover", scale: 1, x: 0, y: 0, rotation: 0,
        crop: { x: 0, y: 0, w: 1, h: 1 }, brightness: 0, blur: 0, fill: "#ffffff",
      },
    },
    adjust: { subject: { ...ZERO_ADJ }, background: { ...ZERO_ADJ }, global: { ...ZERO_ADJ } },
    shadow: {
      drop: { enabled: false, color: "#000000", opacity: 45, blur: 18, angle: 90, distance: 16, spread: 100 },
      contact: { enabled: false, color: "#000000", opacity: 55, blur: 14, width: 80, height: 8, offsetY: 0 },
    },
    canvas: { width: w, height: h, fit: "fit", anchor: "c", padding: 8 },
    export: {
      filename: baseName, format: "png", quality: 90, width: w, height: h, lockAspect: true,
      transparent: true, fill: "#ffffff",
    },
  };
}

export function newId(): string {
  return crypto.randomUUID();
}
