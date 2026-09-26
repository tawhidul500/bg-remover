"use client";
import { useRef, useState } from "react";
import { Brush, Eraser, Hand, ImagePlus, Loader2, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { ACCEPT_ATTR, MODELS, type ModelKey } from "@/lib/config";
import { segmentationSupported } from "@/lib/segmentation";
import { inputKey, ZERO_ADJ, type Adjustments, type BgType, type ProjectState } from "@/lib/types";
import { Button, ColorField, Hint, Section, Segmented, Select, Slider, Toggle } from "../ui";
import { useEditorState } from "./store";

type Up = (s: ProjectState) => ProjectState;

/** Helper hook: slider bindings that group a drag into one history entry. */
export function useBind() {
  const { s, e } = useEditorState();
  return {
    s, e,
    slide: (label: string, get: (s: ProjectState) => number, set: (s: ProjectState, v: number) => ProjectState) => ({
      value: get(s),
      onStart: () => e.begin(),
      onChange: (v: number) => e.update((st) => set(st, v)),
      onEnd: () => e.end(label),
    }),
    set: (fn: Up, label: string) => e.commit(fn, label),
  };
}

export function CutoutPanel() {
  const { s, e, slide } = useBind();
  const unsupported = typeof window !== "undefined" ? segmentationSupported() : null;
  const busy = e.seg && (e.seg.status === "queued" || e.seg.status === "model" || e.seg.status === "inference");
  const stale = e.project && e.project.maskInputKey && e.project.maskInputKey !== inputKey(s.input);
  return (
    <>
      <Section title="Automatic removal">
        {unsupported ? (
          <Hint tone="error">Background removal is unavailable: {unsupported} Use a current version of Chrome, Edge, Firefox or Safari.</Hint>
        ) : (
          <>
            <Select<ModelKey> label="Model" value={e.model} onChange={e.setModel}
              options={(Object.keys(MODELS) as ModelKey[]).map((k) => ({ value: k, label: `${MODELS[k].label} · ${MODELS[k].license}` }))} />
            <p className="text-xs text-muted">{MODELS[e.model].note}</p>
            {busy ? (
              <Button variant="outline" className="w-full" onClick={e.cancelRemoval}><XCircle size={16} /> Cancel</Button>
            ) : (
              <Button variant="accent" size="lg" className="w-full" onClick={e.runRemoval}>
                <Sparkles size={18} /> {e.hasMask ? "Run removal again" : "Remove background"}
              </Button>
            )}
            {e.seg && (
              <div role="status" aria-live="polite" className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  {busy && <Loader2 size={15} className="animate-spin text-brand" />}
                  <span className={e.seg.status === "failed" ? "text-danger" : "text-ink-3"}>{e.seg.text}</span>
                </div>
                {e.seg.pct !== undefined && (
                  <div className="h-2 overflow-hidden rounded-full bg-surface" aria-hidden>
                    <div className="h-full bg-brand transition-[width]" style={{ width: `${e.seg.pct}%` }} />
                  </div>
                )}
                {e.seg.status === "failed" && <Button size="sm" onClick={e.runRemoval}>Retry</Button>}
              </div>
            )}
            {stale && <Hint tone="warn">The input was changed after the cutout was made. Run removal again for the best result.</Hint>}
          </>
        )}
      </Section>
      <Section title="Manual refinement">
        <Segmented label="Brush mode" value={e.brushMode ?? "pan"} onChange={(v) => e.setBrushMode(v === "pan" ? null : v)}
          options={[{ value: "pan", label: "Move", icon: <Hand size={14} /> }, { value: "erase", label: "Erase", icon: <Eraser size={14} /> }, { value: "restore", label: "Restore", icon: <Brush size={14} /> }]} />
        {!e.brushMode ? (
          <p className="text-xs text-muted">Move lets you drag the canvas. Choose Erase or Restore to paint.</p>
        ) : (
          <>
            {!e.hasMask && <Hint>No automatic cutout yet — erasing starts from the full image.</Hint>}
            <Slider label="Brush size" min={2} max={300} value={e.brush.size} unit="px" defaultValue={40} onChange={(v) => e.setBrush({ ...e.brush, size: v })} />
            <Slider label="Hardness" min={0} max={100} value={Math.round(e.brush.hardness * 100)} unit="%" defaultValue={60} onChange={(v) => e.setBrush({ ...e.brush, hardness: v / 100 })} />
            <Slider label="Opacity" min={1} max={100} value={Math.round(e.brush.opacity * 100)} unit="%" defaultValue={100} onChange={(v) => e.setBrush({ ...e.brush, opacity: v / 100 })} />
          </>
        )}
        <Toggle label="Show mask overlay" description="Removed areas shown in red" checked={e.overlay} onChange={e.setOverlay} />
      </Section>
      <Section title="Edges">
        <Slider label="Feather" min={0} max={30} step={0.5} unit="px" defaultValue={0} {...slide("feather", (x) => x.refine.feather, (x, v) => ({ ...x, refine: { ...x.refine, feather: v } }))} />
        <Slider label="Expand / contract" min={-20} max={20} unit="px" defaultValue={0} {...slide("expand", (x) => x.refine.expand, (x, v) => ({ ...x, refine: { ...x.refine, expand: v } }))} />
        <Button className="w-full" disabled={!e.autoMask.current} onClick={e.resetMask}>
          <RotateCcw size={15} /> Reset mask to automatic result
        </Button>
      </Section>
    </>
  );
}

const BG_TYPES: { value: BgType; label: string }[] = [
  { value: "transparent", label: "Transparent" }, { value: "color", label: "Colour" }, { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" }, { value: "image", label: "Image" }, { value: "original", label: "Original" }, { value: "blur", label: "Blurred" },
];

export function BackgroundPanel() {
  const { s, e, slide, set } = useBind();
  const bg = s.background;
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const setBg = (p: Partial<ProjectState["background"]>, label: string) => set((x) => ({ ...x, background: { ...x.background, ...p } }), label);
  const im = (k: keyof ProjectState["background"]["image"], label: string, min: number, max: number, step = 1, def = 0, unit = "") => (
    <Slider label={label} min={min} max={max} step={step} unit={unit} defaultValue={def}
      {...slide(`background ${label.toLowerCase()}`, (x) => x.background.image[k] as number, (x, v) => ({ ...x, background: { ...x.background, image: { ...x.background.image, [k]: v } } }))} />
  );
  const crop = (side: "l" | "t" | "r" | "b", label: string) => (
    <Slider label={label} min={0} max={90} unit="%" defaultValue={0}
      {...slide("background crop", (x) => {
        const c = x.background.image.crop;
        return Math.round((side === "l" ? c.x : side === "t" ? c.y : side === "r" ? 1 - c.x - c.w : 1 - c.y - c.h) * 100);
      }, (x, v) => {
        const c = { ...x.background.image.crop }; const f = v / 100;
        if (side === "l") { const r = 1 - c.x - c.w; c.x = Math.min(f, 0.95 - r); c.w = 1 - c.x - r; }
        if (side === "r") { c.w = Math.max(0.05, 1 - c.x - f); }
        if (side === "t") { const b = 1 - c.y - c.h; c.y = Math.min(f, 0.95 - b); c.h = 1 - c.y - b; }
        if (side === "b") { c.h = Math.max(0.05, 1 - c.y - f); }
        return { ...x, background: { ...x.background, image: { ...x.background.image, crop: c } } };
      })} />
  );
  return (
    <>
      <Section title="Background type">
        <div role="radiogroup" aria-label="Background type" className="grid grid-cols-3 gap-1.5">
          {BG_TYPES.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={bg.type === t.value}
              onClick={() => { if (t.value === "image" && !bg.image.assetId) fileRef.current?.click(); else setBg({ type: t.value }, "background type"); }}
              className={`h-10 rounded-lg border text-xs font-medium ${bg.type === t.value ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-3 hover:bg-surface"}`}>
              {t.label}
            </button>
          ))}
        </div>
        {!e.hasMask && bg.type !== "original" && <Hint>Remove the background first so the new background shows around your subject.</Hint>}
        <input ref={fileRef} type="file" accept={ACCEPT_ATTR} className="hidden" aria-label="Upload background image"
          onChange={async (ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (!f) return; setErr(null); try { await e.setBackgroundImage(f); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } }} />
        {err && <Hint tone="error">{err}</Hint>}
      </Section>
      {bg.type === "color" && (
        <Section title="Colour">
          <ColorField label="Background colour" value={bg.color} swatches={e.swatches} onSaveSwatch={e.saveSwatch} onChange={(c) => setBg({ color: c }, "background colour")} />
        </Section>
      )}
      {(bg.type === "linear" || bg.type === "radial") && (
        <Section title="Gradient">
          <ColorField label={bg.type === "radial" ? "Centre colour" : "Start colour"} value={bg.gradient.from} swatches={e.swatches} onSaveSwatch={e.saveSwatch} onChange={(c) => setBg({ gradient: { ...bg.gradient, from: c } }, "gradient")} />
          <ColorField label={bg.type === "radial" ? "Edge colour" : "End colour"} value={bg.gradient.to} swatches={e.swatches} onChange={(c) => setBg({ gradient: { ...bg.gradient, to: c } }, "gradient")} />
          {bg.type === "linear" && <Slider label="Angle" min={0} max={360} unit="°" defaultValue={135} {...slide("gradient angle", (x) => x.background.gradient.angle, (x, v) => ({ ...x, background: { ...x.background, gradient: { ...x.background.gradient, angle: v } } }))} />}
        </Section>
      )}
      {bg.type === "blur" && (
        <Section title="Blur original">
          <Slider label="Blur amount" min={1} max={80} unit="px" defaultValue={12} {...slide("background blur", (x) => x.background.blur, (x, v) => ({ ...x, background: { ...x.background, blur: v } }))} />
        </Section>
      )}
      {bg.type === "image" && (
        <>
          <Section title="Background image" right={<Button size="sm" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Replace</Button>}>
            <p className="truncate text-xs text-muted">{bg.image.name || "No image"}</p>
            <Segmented label="Fit mode" value={bg.image.fit} onChange={(v) => set((x) => ({ ...x, background: { ...x.background, image: { ...x.background.image, fit: v } } }), "background fit")}
              options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }]} />
            {im("scale", "Scale", 0.2, 4, 0.01, 1, "×")}
            {im("x", "Horizontal position", -1, 1, 0.01, 0)}
            {im("y", "Vertical position", -1, 1, 0.01, 0)}
            {im("rotation", "Rotation", -180, 180, 1, 0, "°")}
            {bg.image.fit === "contain" && (
              <ColorField label="Fill colour (unused space)" value={bg.image.fill} swatches={e.swatches} onChange={(c) => set((x) => ({ ...x, background: { ...x.background, image: { ...x.background.image, fill: c } } }), "background fill")} />
            )}
          </Section>
          <Section title="Crop background">
            {crop("l", "Left")}{crop("r", "Right")}{crop("t", "Top")}{crop("b", "Bottom")}
          </Section>
          <Section title="Background only">
            {im("brightness", "Brightness", -100, 100, 1, 0)}
            {im("blur", "Blur", 0, 60, 1, 0, "px")}
          </Section>
        </>
      )}
    </>
  );
}

const ADJ: { key: keyof Adjustments; label: string; min: number }[] = [
  { key: "exposure", label: "Exposure", min: -100 }, { key: "contrast", label: "Contrast", min: -100 },
  { key: "highlights", label: "Highlights", min: -100 }, { key: "shadows", label: "Shadows", min: -100 },
  { key: "saturation", label: "Saturation", min: -100 }, { key: "temperature", label: "Temperature", min: -100 },
  { key: "tint", label: "Tint", min: -100 }, { key: "sharpness", label: "Sharpness", min: 0 },
];

export function AdjustPanel() {
  const { s, e, slide, set } = useBind();
  const [target, setTarget] = useState<"subject" | "background" | "global">("subject");
  const a = s.adjust[target];
  const changed = Object.values(a).some(Boolean);
  return (
    <>
      <Section title="Target">
        <Segmented label="Adjustment target" value={target} onChange={setTarget}
          options={[{ value: "subject", label: "Subject" }, { value: "background", label: "Background" }, { value: "global", label: "Entire image" }]} />
        {target === "background" && s.background.type === "transparent" && <Hint>The background is transparent, so background adjustments have nothing to change.</Hint>}
        {target !== "global" && !e.hasMask && <Hint>Without a cutout, the subject is the whole image.</Hint>}
      </Section>
      <Section title="Adjustments" right={<Button size="sm" variant="ghost" disabled={!changed} onClick={() => set((x) => ({ ...x, adjust: { ...x.adjust, [target]: { ...ZERO_ADJ } } }), "reset adjustments")}>Reset all</Button>}>
        {ADJ.map((d) => (
          <Slider key={d.key} label={d.label} min={d.min} max={100} defaultValue={0}
            {...slide(d.label.toLowerCase(), (x) => x.adjust[target][d.key], (x, v) => ({ ...x, adjust: { ...x.adjust, [target]: { ...x.adjust[target], [d.key]: v } } }))} />
        ))}
      </Section>
    </>
  );
}
