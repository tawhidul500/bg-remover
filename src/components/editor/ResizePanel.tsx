"use client";
import { useEffect, useRef, useState } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignStartHorizontal, AlignStartVertical, ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  Crosshair, Download, FlipHorizontal2, FlipVertical2, Frame, Image as ImageIcon,
  Link2, Link2Off, Maximize2, Move, RotateCcw, RotateCw, Trash2,
} from "lucide-react";
import { MAX_OUTPUT_PIXELS, MAX_OUTPUT_SIDE, MAX_WORKING_SIDE } from "@/lib/config";
import { fitDims, validateDims } from "@/lib/imageops";
import { alignSubject, PRESETS, resizeCanvasState, type Align, type CanvasMode } from "@/lib/layout";
import { inputAspect, renderExport } from "@/lib/render";
import { getMeta, setMeta } from "@/lib/storage";
import type { Anchor, InputTransform, ProjectState } from "@/lib/types";
import { Button, Hint, Section, Segmented, Slider } from "../ui";
import { useBind } from "./panels1";
import type { EditorStore } from "./store";

type Size = { w: number; h: number };
type ResizeTab = "canvas" | "photo" | "subject" | "export";

/** Number edits update after a short typing pause; Enter/blur and preset clicks apply at once. */
function LiveSize({ value, base, lock, onLock, onChange, maxSide, maxPixels }: {
  value: Size; base: Size; lock: boolean; onLock: (v: boolean) => void;
  onChange: (w: number, h: number) => void; maxSide: number; maxPixels: number;
}) {
  const [editing, setEditing] = useState<{ axis: "w" | "h"; text: string; other: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Size | null>(null);
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const ratio = base.w > 0 && base.h > 0 ? base.w / base.h : 1;
  const pct = base.w ? Math.round((value.w / base.w) * 100) : 100;
  // Keep only the focused field as a draft; all other values come from live project state.
  const draft = {
    w: editing?.axis === "w" ? editing.text : editing?.axis === "h" && lock ? String(editing.other) : String(value.w),
    h: editing?.axis === "h" ? editing.text : editing?.axis === "w" && lock ? String(editing.other) : String(value.h),
  };

  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const flush = () => {
    clear();
    if (pending.current) {
      const n = pending.current; pending.current = null;
      changeRef.current(n.w, n.h);
    } else if (error) {
      setError(null);
    }
  };
  const schedule = (n: Size, wait: number) => {
    clear();
    const err = validateDims(n.w, n.h, maxSide, maxPixels);
    setError(err);
    pending.current = err || (n.w === value.w && n.h === value.h) ? null : n;
    if (!err && pending.current) {
      if (wait) timer.current = setTimeout(flush, wait);
      else flush();
    }
  };
  const type = (axis: "w" | "h", raw: string) => {
    if (!/^\d+$/.test(raw)) {
      setEditing({ axis, text: raw, other: axis === "w" ? value.h : value.w });
      clear(); pending.current = null; setError(null); return;
    }
    const n = Number(raw);
    const next = axis === "w"
      ? { w: n, h: lock ? Math.max(1, Math.round(n / ratio)) : value.h }
      : { w: lock ? Math.max(1, Math.round(n * ratio)) : value.w, h: n };
    setEditing({ axis, text: raw, other: axis === "w" ? next.h : next.w });
    schedule(next, 260);
  };
  const quick = (percent: number) => {
    const n = { w: Math.max(1, Math.round(base.w * percent / 100)), h: Math.max(1, Math.round(base.h * percent / 100)) };
    setEditing(null);
    schedule(n, 0);
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
        {(["w", "h"] as const).map((axis, index) => (
          <div key={axis} className={index === 1 ? "col-start-3" : ""}>
            <label className="block text-xs font-medium text-ink-3" htmlFor={`resize-${axis}-${maxSide}`}>{axis === "w" ? "Width" : "Height"}</label>
            <div className="mt-1 flex h-10 items-center rounded-lg border border-line bg-white focus-within:border-brand">
              <input id={`resize-${axis}-${maxSide}`} aria-label={`Resize ${axis === "w" ? "width" : "height"}`} inputMode="numeric" type="text" pattern="[0-9]*"
                value={draft[axis]}
                onFocus={() => setEditing({ axis, text: String(axis === "w" ? value.w : value.h), other: axis === "w" ? value.h : value.w })}
                onChange={(ev) => type(axis, ev.target.value)}
                onBlur={() => { flush(); setEditing(null); }}
                onKeyDown={(ev) => { if (ev.key === "Enter") { flush(); (ev.target as HTMLInputElement).blur(); } }}
                className="w-full min-w-0 rounded-lg bg-transparent px-2 text-sm tabular-nums outline-none" />
              <span className="pr-2 text-xs text-muted">px</span>
            </div>
          </div>
        ))}
        <button type="button" aria-label={lock ? "Unlock aspect ratio" : "Lock aspect ratio"} title={lock ? "Keep the same shape" : "Change width and height separately"}
          aria-pressed={lock} onClick={() => onLock(!lock)}
          className={`col-start-2 row-start-1 flex h-10 w-10 items-center justify-center rounded-lg border ${lock ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-3"}`}>
          {lock ? <Link2 size={17} /> : <Link2Off size={17} />}
        </button>
      </div>
      {error && <Hint tone="error">{error}</Hint>}
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>{lock ? "Shape locked" : "Free shape"}</span>
        <span>{pct}% of image size</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick sizes">
        {[50, 100, 200].map((percent) => (
          <button key={percent} type="button" onClick={() => quick(percent)}
            className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors ${Math.abs(pct - percent) < 1 ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-3 hover:bg-surface"}`}>
            {percent}%
          </button>
        ))}
      </div>
    </div>
  );
}

const ANCHOR_NAMES: Record<Anchor, string> = {
  tl: "Top left", t: "Top", tr: "Top right", l: "Left", c: "Centre", r: "Right",
  bl: "Bottom left", b: "Bottom", br: "Bottom right",
};
const ANCHORS: Anchor[] = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];

function AnchorPicker({ value, onChange }: { value: Anchor; onChange: (a: Anchor) => void }) {
  return (
    <div role="radiogroup" aria-label="Photo position" className="grid w-28 grid-cols-3 gap-1">
      {ANCHORS.map((a) => (
        <button key={a} type="button" role="radio" aria-label={ANCHOR_NAMES[a]} aria-checked={value === a} title={ANCHOR_NAMES[a]}
          onClick={() => onChange(a)}
          className={`grid h-8 place-items-center rounded-md border ${a === value ? "border-brand bg-brand" : "border-line hover:bg-surface"}`}>
          <span className={`h-2 w-2 rounded-full ${a === value ? "bg-white" : "bg-slate-300"}`} />
        </button>
      ))}
    </div>
  );
}

/** The same renderer powers this output-only thumbnail and the full-resolution download. */
function ExportPreview({ s, e }: { s: ProjectState; e: EditorStore }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (validateDims(s.export.width, s.export.height, MAX_OUTPUT_SIDE, MAX_OUTPUT_PIXELS)) return;
    const raf = requestAnimationFrame(() => {
      if (!canvas.current) return;
      try {
        const factor = Math.min(1, 240 / Math.max(s.export.width, s.export.height));
        const w = Math.max(1, Math.round(s.export.width * factor));
        const h = Math.max(1, Math.round(s.export.height * factor));
        const flat = s.export.format === "jpeg" || !s.export.transparent ? s.export.fill : null;
        const out = renderExport(e.renderer, s, w, h, flat);
        const c = canvas.current;
        c.width = w; c.height = h;
        c.getContext("2d")?.drawImage(out, 0, 0);
        out.width = 0;
        setError(null);
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    });
    return () => cancelAnimationFrame(raf);
  }, [s, e.renderer, e.maskTick, e.shadowTick, e.bgTick]);
  return (
    <>
      <div className="checker flex min-h-40 items-center justify-center overflow-hidden rounded-xl border border-line-soft p-3">
        <canvas ref={canvas} role="img" aria-label="Live download size preview" className="max-h-52 max-w-full object-contain shadow-sm" />
      </div>
      {error && <Hint tone="error">{error}</Hint>}
    </>
  );
}

export function ResizePanel() {
  const { s, e, slide, set } = useBind();
  const orig = e.project!.original;
  const [tab, setTab] = useState<"canvas" | "photo" | "subject" | "export">("canvas");
  const [photoLock, setPhotoLock] = useState(true);
  const [canvasLock, setCanvasLock] = useState(false);
  const [showPreset, setShowPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [custom, setCustom] = useState<{ name: string; w: number; h: number }[]>([]);
  useEffect(() => { getMeta<typeof custom>("presets").then((ps) => { if (ps) setCustom(ps); }); }, []);
  const savePresets = (ps: typeof custom) => { setCustom(ps); setMeta("presets", ps).catch(() => {}); };
  const mode = s.canvas.fit ?? "fit";
  const anchor = s.canvas.anchor ?? "c";
  const padding = s.canvas.padding ?? 8;
  const applyCanvas = (w: number, h: number, m = mode, a = anchor, p = padding, label = "resize canvas") => {
    const err = validateDims(w, h, MAX_OUTPUT_SIDE, MAX_OUTPUT_PIXELS);
    if (!err) set((st) => resizeCanvasState(st, w, h, m, a, p), label);
  };
  const input = s.input;
  const inputAspectRatio = inputAspect(orig.width, orig.height, input);
  const croppedW = Math.max(1, Math.round(input.crop.w * orig.width));
  const croppedH = Math.max(1, Math.round(input.crop.h * orig.height));
  const reserveCrop = e.reserveInput?.crop ?? input.crop;
  const archiveIncomplete = e.hasMask && (reserveCrop.x > 0.0001 || reserveCrop.y > 0.0001 ||
    reserveCrop.w < 0.9999 || reserveCrop.h < 0.9999);
  const cropIsFull = input.crop.x < 0.0001 && input.crop.y < 0.0001 &&
    input.crop.w > 0.9999 && input.crop.h > 0.9999;
  const photoBase = fitDims(input.rotate % 180 ? croppedH : croppedW, input.rotate % 180 ? croppedW : croppedH, MAX_WORKING_SIDE, MAX_OUTPUT_PIXELS);
  const inputNext = (t: InputTransform, crop = t.crop) => {
    const aspect = inputAspect(orig.width, orig.height, { ...t, crop });
    const side = Math.max(input.width, input.height);
    return aspect >= 1
      ? { ...t, crop, width: side, height: Math.max(1, Math.round(side / aspect)) }
      : { ...t, crop, height: side, width: Math.max(1, Math.round(side * aspect)) };
  };
  const trimPercent = (side: "l" | "r" | "t" | "b") => {
    const c = input.crop;
    return Math.round((side === "l" ? c.x : side === "r" ? 1 - c.x - c.w : side === "t" ? c.y : 1 - c.y - c.h) * 100);
  };
  const trim = (side: "l" | "r" | "t" | "b", value: number) => {
    const c = { ...input.crop }; const f = value / 100;
    if (side === "l") { const r = 1 - c.x - c.w; c.x = Math.min(f, 0.95 - r); c.w = 1 - c.x - r; }
    if (side === "r") c.w = Math.max(0.05, 1 - c.x - f);
    if (side === "t") { const b = 1 - c.y - c.h; c.y = Math.min(f, 0.95 - b); c.h = 1 - c.y - b; }
    if (side === "b") c.h = Math.max(0.05, 1 - c.y - f);
    const next = inputNext({ ...input, crop: c }, c);
    if (!validateDims(next.width, next.height, MAX_WORKING_SIDE, MAX_OUTPUT_PIXELS)) e.applyInput(next, "trim photo", true);
  };
  const align = (how: Align) => {
    const bb = e.renderer.getCutout(s)?.bbox ?? { x: 0, y: 0, w: e.renderer.ww, h: e.renderer.wh };
    set((st) => alignSubject(st, bb, how), `align ${how}`);
  };
  const nudge = (dx: number, dy: number) => set((st) => ({ ...st, subject: { ...st.subject, x: st.subject.x + dx, y: st.subject.y + dy } }), "move subject");
  const tabInfo = {
    canvas: { icon: <Frame size={16} />, label: "Canvas", detail: "Final picture" },
    photo: { icon: <ImageIcon size={16} />, label: "Image", detail: "Before removal" },
    subject: { icon: <Move size={16} />, label: "Subject", detail: "Move & scale" },
    export: { icon: <Download size={16} />, label: "Export", detail: "Download only" },
  } as const;

  return (
    <>
      <div role="tablist" aria-label="Resize options" className="grid grid-cols-2 gap-1.5 border-b border-line-soft p-3">
        {(Object.keys(tabInfo) as (keyof typeof tabInfo)[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`flex min-h-12 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors ${tab === key ? "border-brand bg-brand/10 text-brand" : "border-line-soft text-ink-2 hover:bg-surface"}`}>
            {tabInfo[key].icon}
            <span className="min-w-0"><span className="block text-xs font-semibold">{tabInfo[key].label}</span><span className="block text-[10px] text-muted">{tabInfo[key].detail}</span></span>
          </button>
        ))}
      </div>

      {tab === "canvas" && <div role="tabpanel" aria-label="Canvas size settings">
        <Section title="Choose a shape">
          <div className="grid grid-cols-2 gap-1.5">
            {[...PRESETS, ...custom].map((preset, index) => (
              <div key={`${preset.name}-${index}`} className="relative">
                <button type="button" aria-pressed={s.canvas.width === preset.w && s.canvas.height === preset.h}
                  onClick={() => applyCanvas(preset.w, preset.h)}
                  className={`h-14 w-full rounded-lg border px-2 text-left transition-colors ${s.canvas.width === preset.w && s.canvas.height === preset.h ? "border-brand bg-brand/10" : "border-line hover:bg-surface"}`}>
                  <span className="block text-xs font-medium text-ink-2">{preset.name}</span>
                  <span className="block text-[11px] tabular-nums text-muted">{preset.w} × {preset.h}</span>
                </button>
                {index >= PRESETS.length && (
                  <button type="button" title={`Delete ${preset.name}`} aria-label={`Delete preset ${preset.name}`}
                    onClick={() => savePresets(custom.filter((_, i) => i !== index - PRESETS.length))}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-white hover:text-danger"><Trash2 size={13} /></button>
                )}
              </div>
            ))}
          </div>
          {showPreset ? <div className="flex gap-1.5">
            <input aria-label="Preset name" placeholder="Preset name" maxLength={30} value={presetName} onChange={(ev) => setPresetName(ev.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 text-xs outline-none focus:border-brand" />
            <Button size="sm" variant="primary" disabled={!presetName.trim()} onClick={() => { savePresets([...custom, { name: presetName.trim(), w: s.canvas.width, h: s.canvas.height }]); setPresetName(""); setShowPreset(false); }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowPreset(false); setPresetName(""); }}>Cancel</Button>
          </div> : <button type="button" onClick={() => setShowPreset(true)} className="h-8 w-full rounded-lg border border-dashed border-line text-xs text-ink-3 hover:bg-surface">+ Save this size</button>}
        </Section>
        <Section title="Custom dimensions">
          <LiveSize value={{ w: s.canvas.width, h: s.canvas.height }} base={{ w: input.width, h: input.height }}
            lock={canvasLock} onLock={setCanvasLock} onChange={(w, h) => applyCanvas(w, h)}
            maxSide={MAX_OUTPUT_SIDE} maxPixels={MAX_OUTPUT_PIXELS} />
        </Section>
        <Section title="How should it fit?">
          <Segmented label="Fit inside canvas" value={mode} onChange={(m) => applyCanvas(s.canvas.width, s.canvas.height, m, anchor, padding, "canvas fit")}
            options={[{ value: "fit", label: "Show all" }, { value: "fill", label: "Fill frame" }, { value: "pad", label: "With border" }]} />
          {mode === "pad" && <Slider label="Border size" min={0} max={40} unit="%" value={padding}
            onStart={e.begin} onChange={(v) => e.update((st) => resizeCanvasState(st, st.canvas.width, st.canvas.height, "pad", st.canvas.anchor ?? "c", v))}
            onEnd={() => e.end("border size")} />}
          <details className="rounded-lg border border-line-soft p-2.5">
            <summary className="cursor-pointer text-xs font-medium text-ink-3">Position in frame</summary>
            <div className="pt-3"><AnchorPicker value={anchor} onChange={(a) => applyCanvas(s.canvas.width, s.canvas.height, mode, a, padding, "frame position")} /></div>
          </details>
        </Section>
      </div>}

      {tab === "photo" && <div role="tabpanel" aria-label="Image size before removal">
        <Section title="Working image size">
          <p className="text-xs text-muted">Original kept unchanged: {orig.width} × {orig.height} px</p>
          <LiveSize value={{ w: input.width, h: input.height }} base={{ w: photoBase.width, h: photoBase.height }}
            lock={photoLock} onLock={setPhotoLock} maxSide={MAX_WORKING_SIDE} maxPixels={MAX_OUTPUT_PIXELS}
            onChange={(w, h) => e.applyInput({ ...input, width: w, height: h }, "resize working image")} />
          {(input.width > croppedW || input.height > croppedH) && <Hint tone="warn">Enlarging does not add detail to the original photo.</Hint>}
        </Section>
        <Section title="Turn or flip">
          <div className="grid grid-cols-2 gap-1.5">
            <Button onClick={() => { const n = inputNext({ ...input, rotate: ((input.rotate + 270) % 360) as InputTransform["rotate"] }); if (!validateDims(n.width, n.height, MAX_WORKING_SIDE, MAX_OUTPUT_PIXELS)) e.applyInput(n, "turn left"); }}><RotateCcw size={15} /> Left</Button>
            <Button onClick={() => { const n = inputNext({ ...input, rotate: ((input.rotate + 90) % 360) as InputTransform["rotate"] }); if (!validateDims(n.width, n.height, MAX_WORKING_SIDE, MAX_OUTPUT_PIXELS)) e.applyInput(n, "turn right"); }}><RotateCw size={15} /> Right</Button>
            <Button variant={input.flipH ? "primary" : "outline"} onClick={() => e.applyInput({ ...input, flipH: !input.flipH }, "flip sideways")}><FlipHorizontal2 size={15} /> Flip sideways</Button>
            <Button variant={input.flipV ? "primary" : "outline"} onClick={() => e.applyInput({ ...input, flipV: !input.flipV }, "flip vertically")}><FlipVertical2 size={15} /> Flip up-down</Button>
          </div>
        </Section>
        <Section title="Crop (optional)">
          <details className="rounded-lg border border-line-soft p-2.5">
            <summary className="cursor-pointer text-xs font-medium text-ink-3">Trim the photo’s edges</summary>
            <div className="space-y-2 pt-3">
              {(["l", "r", "t", "b"] as const).map((side) => <Slider key={side} label={{ l: "Left", r: "Right", t: "Top", b: "Bottom" }[side]}
                min={0} max={90} unit="%" value={trimPercent(side)} defaultValue={0}
                onStart={e.begin} onChange={(v) => trim(side, v)} onEnd={() => e.end("trim photo")} />)}
              {(input.crop.x > 0 || input.crop.y > 0 || input.crop.w < 1 || input.crop.h < 1) &&
                <Button size="sm" className="w-full" onClick={() => { const n = inputNext({ ...input, crop: { x: 0, y: 0, w: 1, h: 1 } }, { x: 0, y: 0, w: 1, h: 1 }); e.applyInput(n, "reset crop"); }}>Reset crop</Button>}
              {archiveIncomplete && <Hint tone="warn">
                This older cutout has no mask data for some previously hidden edges.
                {cropIsFull ? <button type="button" className="ml-1 font-semibold underline underline-offset-2"
                  onClick={() => { e.setTool("cutout"); e.runRemoval(); }}>Rebuild the full cutout</button>
                  : " Reset crop to reveal them, then rebuild the cutout."}
              </Hint>}
            </div>
          </details>
        </Section>
      </div>}

      {tab === "subject" && <div role="tabpanel" aria-label="Subject position and size">
        <Section title="Subject size and angle">
          <Slider label="Size" min={5} max={500} unit="%" defaultValue={100}
            {...slide("subject size", (st) => Math.round(st.subject.scale * 100), (st, v) => ({ ...st, subject: { ...st.subject, scale: v / 100 } }))} />
          <Slider label="Angle" min={-180} max={180} unit="°" defaultValue={0}
            {...slide("subject angle", (st) => st.subject.rotation, (st, v) => ({ ...st, subject: { ...st.subject, rotation: v } }))} />
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant={s.subject.flipH ? "primary" : "outline"} onClick={() => set((st) => ({ ...st, subject: { ...st.subject, flipH: !st.subject.flipH } }), "flip subject")}><FlipHorizontal2 size={14} /> Flip sideways</Button>
            <Button variant={s.subject.flipV ? "primary" : "outline"} onClick={() => set((st) => ({ ...st, subject: { ...st.subject, flipV: !st.subject.flipV } }), "flip subject")}><FlipVertical2 size={14} /> Flip up-down</Button>
          </div>
        </Section>
        <Section title="Move subject">
          <Slider label="Left / right" min={-50} max={150} unit="%" defaultValue={50}
            {...slide("move sideways", (st) => Math.round(st.subject.x * 100), (st, v) => ({ ...st, subject: { ...st.subject, x: v / 100 } }))} />
          <Slider label="Up / down" min={-50} max={150} unit="%" defaultValue={50}
            {...slide("move vertically", (st) => Math.round(st.subject.y * 100), (st, v) => ({ ...st, subject: { ...st.subject, y: v / 100 } }))} />
          <div className="flex items-center gap-2">
            <div className="grid w-28 grid-cols-3 gap-1">
              <span /><Button size="sm" aria-label="Move up" onClick={() => nudge(0, -0.02)}><ArrowUp size={14} /></Button><span />
              <Button size="sm" aria-label="Move left" onClick={() => nudge(-0.02, 0)}><ArrowLeft size={14} /></Button>
              <Button size="sm" aria-label="Centre subject" onClick={() => align("center")}><Crosshair size={14} /></Button>
              <Button size="sm" aria-label="Move right" onClick={() => nudge(0.02, 0)}><ArrowRight size={14} /></Button>
              <span /><Button size="sm" aria-label="Move down" onClick={() => nudge(0, 0.02)}><ArrowDown size={14} /></Button><span />
            </div>
            <Button size="sm" className="flex-1" onClick={() => align("fit")}><Maximize2 size={14} /> Fit</Button>
          </div>
          <details className="rounded-lg border border-line-soft p-2.5">
            <summary className="cursor-pointer text-xs font-medium text-ink-3">Align to edge</summary>
            <div className="grid grid-cols-3 gap-1.5 pt-3">
              <Button size="sm" onClick={() => align("left")}><AlignStartVertical size={13} /> Left</Button>
              <Button size="sm" onClick={() => align("hcenter")}><AlignCenterVertical size={13} /> Centre</Button>
              <Button size="sm" onClick={() => align("right")}><AlignEndVertical size={13} /> Right</Button>
              <Button size="sm" onClick={() => align("top")}><AlignStartHorizontal size={13} /> Top</Button>
              <Button size="sm" onClick={() => align("vcenter")}><AlignCenterHorizontal size={13} /> Centre</Button>
              <Button size="sm" onClick={() => align("bottom")}><AlignEndHorizontal size={13} /> Bottom</Button>
            </div>
          </details>
        </Section>
      </div>}

      {tab === "export" && <div role="tabpanel" aria-label="Export size settings">
        <Section title="Download dimensions">
          <p className="text-xs text-muted">Changes the file you download, not the editable canvas.</p>
          <LiveSize value={{ w: s.export.width, h: s.export.height }} base={{ w: s.canvas.width, h: s.canvas.height }}
            lock={s.export.lockAspect} maxSide={MAX_OUTPUT_SIDE} maxPixels={MAX_OUTPUT_PIXELS}
            onLock={(v) => set((st) => ({ ...st, export: { ...st.export, lockAspect: v, ...(v ? { height: Math.max(1, Math.round(st.export.width * st.canvas.height / st.canvas.width)) } : {}) } }), "export shape lock")}
            onChange={(w, h) => set((st) => ({ ...st, export: { ...st.export, width: w, height: h } }), "export dimensions")} />
          {Math.abs(s.export.width / s.export.height - s.canvas.width / s.canvas.height) > 0.01 &&
            <Hint tone="warn">Different shape from the canvas; the exported file is centre-cropped.</Hint>}
        </Section>
        <Section title="Live export preview"><ExportPreview s={s} e={e} /></Section>
      </div>}
    </>
  );
}
