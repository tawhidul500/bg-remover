import type { Anchor, ProjectState } from "./types";

export type CanvasMode = "fit" | "fill" | "pad";

const ax = (a: Anchor) => (a.includes("l") ? 0 : a.includes("r") ? 1 : 0.5);
const ay = (a: Anchor) => (a.startsWith("t") ? 0 : a.startsWith("b") ? 1 : 0.5);

/** Resize the composition canvas and place the subject according to mode + anchor. */
export function resizeCanvasState(s: ProjectState, w: number, h: number, mode: CanvasMode, anchor: Anchor, paddingPct = 8): ProjectState {
  const ww = s.input.width, wh = s.input.height;
  const contain = Math.min(w / ww, h / wh);
  const cover = Math.max(w / ww, h / wh);
  const p = mode === "pad" ? Math.min(0.45, Math.max(0, paddingPct / 100)) : 0;
  const scale = mode === "fill" ? cover / contain : mode === "pad" ? 1 - 2 * p : 1;
  const sw = (ww * contain * scale) / w, sh = (wh * contain * scale) / h;
  const fx = ax(anchor), fy = ay(anchor);
  const x = fx === 0 ? p + sw / 2 : fx === 1 ? 1 - p - sw / 2 : 0.5;
  const y = fy === 0 ? p + sh / 2 : fy === 1 ? 1 - p - sh / 2 : 0.5;
  const exportFollows = s.export.width === s.canvas.width && s.export.height === s.canvas.height;
  return {
    ...s,
    canvas: { width: w, height: h, fit: mode, anchor, padding: paddingPct },
    subject: { ...s.subject, scale, x, y },
    export: exportFollows || s.export.lockAspect ? { ...s.export, width: w, height: h } : s.export,
  };
}

/** Grow the canvas by `px` on every side while keeping the subject's pixel size and position. */
export function padCanvas(s: ProjectState, px: number): ProjectState {
  const { width: cw, height: ch } = s.canvas;
  const nw = cw + 2 * px, nh = ch + 2 * px;
  const ww = s.input.width, wh = s.input.height;
  const oldBase = Math.min(cw / ww, ch / wh), newBase = Math.min(nw / ww, nh / wh);
  return {
    ...s,
    canvas: { ...s.canvas, width: nw, height: nh },
    subject: { ...s.subject, scale: (s.subject.scale * oldBase) / newBase, x: (s.subject.x * cw + px) / nw, y: (s.subject.y * ch + px) / nh },
    export: { ...s.export, width: nw, height: nh },
  };
}

export type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "center" | "fit";

/** Align using the subject's visible alpha bounding box (rotation not accounted for). */
export function alignSubject(s: ProjectState, bb: { x: number; y: number; w: number; h: number }, how: Align, marginPct = 5): ProjectState {
  const { width: cw, height: ch } = s.canvas;
  const ww = s.input.width, wh = s.input.height;
  const base0 = Math.min(cw / ww, ch / wh);
  let scale = s.subject.scale;
  const m = marginPct / 100;
  if (how === "fit") scale = Math.min((cw * (1 - 2 * m)) / (bb.w * base0), (ch * (1 - 2 * m)) / (bb.h * base0));
  const base = base0 * scale;
  const dx = (bb.x + bb.w / 2 - ww / 2) * base * (s.subject.flipH ? -1 : 1);
  const dy = (bb.y + bb.h / 2 - wh / 2) * base * (s.subject.flipV ? -1 : 1);
  const hw = (bb.w * base) / 2, hh = (bb.h * base) / 2;
  let { x, y } = s.subject;
  if (how === "left") x = (hw - dx + cw * m) / cw;
  if (how === "right") x = (cw - hw - dx - cw * m) / cw;
  if (how === "hcenter" || how === "center" || how === "fit") x = (cw / 2 - dx) / cw;
  if (how === "top") y = (hh - dy + ch * m) / ch;
  if (how === "bottom") y = (ch - hh - dy - ch * m) / ch;
  if (how === "vcenter" || how === "center" || how === "fit") y = (ch / 2 - dy) / ch;
  return { ...s, subject: { ...s.subject, x, y, scale } };
}

export const PRESETS = [
  { name: "Square 1:1", w: 1080, h: 1080 },
  { name: "Portrait 4:5", w: 1080, h: 1350 },
  { name: "Story 9:16", w: 1080, h: 1920 },
  { name: "Landscape 16:9", w: 1920, h: 1080 },
  { name: "Product 2000²", w: 2000, h: 2000 },
];
