"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { MAX_OUTPUT_PIXELS, MAX_OUTPUT_SIDE } from "@/lib/config";
import { compress, downloadBlob, encodeCanvas, EXT, hasAlpha, isLossy, sanitizeName, supportsAvif, type CompressMode, type CompressResult } from "@/lib/encode";
import { validateDims } from "@/lib/imageops";
import { ctx2d, mkCanvas, renderExport } from "@/lib/render";
import type { ExportFormat } from "@/lib/types";
import { formatBytes } from "@/lib/validate";
import { Button, ColorField, Dialog, Hint, NumberField, Section, Segmented, Select, Slider, Toggle } from "../ui";
import { useEditorState } from "./store";

function useAvif() {
  const [ok, setOk] = useState(false);
  useEffect(() => { supportsAvif().then(setOk); }, []);
  return ok;
}

function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function CompressPanel() {
  const { s, e } = useEditorState();
  const avif = useAvif();
  const [source, setSource] = useState<"original" | "edited">(e.hasMask ? "edited" : "original");
  const [mode, setMode] = useState<CompressMode>("webp");
  const [quality, setQuality] = useState(80);
  const [colors, setColors] = useState(128);
  const [useTarget, setUseTarget] = useState(false);
  const [targetKB, setTargetKB] = useState(200);
  const [allowResize, setAllowResize] = useState(false);
  const [res, setRes] = useState<CompressResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bigPreview, setBigPreview] = useState(false);
  const seq = useRef(0);
  const url = useObjectUrl(res?.blob ?? null);
  const origSize = e.project!.original.size;

  useEffect(() => {
    const my = ++seq.current;
    setBusy(true); setErr(null);
    const t = setTimeout(async () => {
      try {
        let c: HTMLCanvasElement;
        const flatten = mode === "jpeg" ? s.export.fill : null;
        if (source === "original") {
          const o = e.renderer.original!; c = mkCanvas(o.width, o.height);
          const x = ctx2d(c); if (flatten) { x.fillStyle = flatten; x.fillRect(0, 0, c.width, c.height); } x.drawImage(o, 0, 0);
        } else {
          const ve = validateDims(s.export.width, s.export.height, MAX_OUTPUT_SIDE, MAX_OUTPUT_PIXELS); if (ve) throw new Error(ve);
          c = renderExport(e.renderer, s, s.export.width, s.export.height, flatten);
        }
        if (my !== seq.current) return;
        const r = await compress(c, mode, quality, colors, useTarget ? targetKB * 1024 : null, allowResize, () => my !== seq.current);
        c.width = 0;
        if (my === seq.current) setRes(r);
      } catch (x) {
        if (my === seq.current && !(x instanceof DOMException && x.name === "AbortError")) setErr(x instanceof Error ? x.message : String(x));
      } finally { if (my === seq.current) setBusy(false); }
    }, 600); // debounce expensive encodes
    return () => clearTimeout(t);
  }, [source, mode, quality, colors, useTarget, targetKB, allowResize, s, e.renderer, e.maskTick, e.bgTick]);

  const ext = mode === "jpeg" ? "jpg" : mode.startsWith("png") ? "png" : mode;
  const delta = res ? ((res.blob.size - origSize) / origSize) * 100 : 0;
  const modes: { value: CompressMode; label: string }[] = [
    { value: "jpeg", label: "JPG (lossy)" }, { value: "webp", label: "WebP (lossy)" },
    { value: "png-lossless", label: "PNG – lossless optimisation" }, { value: "png-palette", label: "PNG – palette reduction (LOSSY)" },
    ...(avif ? [{ value: "avif" as CompressMode, label: "AVIF (lossy, browser encoder)" }] : []),
  ];
  return (
    <>
      <Section title="Source">
        <Segmented label="Compression source" value={source} onChange={setSource} options={[{ value: "original", label: "Original image" }, { value: "edited", label: "Edited result" }]} />
        <p className="text-xs text-muted">{source === "original" ? `Original: ${e.project!.original.width} × ${e.project!.original.height} px` : `Edited: ${s.export.width} × ${s.export.height} px`}</p>
      </Section>
      <Section title="Settings">
        <Select label="Format" value={mode} onChange={setMode} options={modes} />
        {(mode === "jpeg" || mode === "webp" || mode === "avif") && !useTarget && <Slider label="Quality" min={1} max={100} value={quality} defaultValue={80} onChange={setQuality} />}
        {mode === "png-palette" && !useTarget && <Slider label="Colours" min={2} max={256} value={colors} defaultValue={128} onChange={setColors} />}
        {mode === "png-palette" && <Hint tone="warn">Palette reduction is lossy: it limits the image to a fixed number of colours.</Hint>}
        {mode === "jpeg" && <Hint>JPG has no transparency; transparent areas are filled with the export fill colour ({s.export.fill}).</Hint>}
        <Toggle label="Target file size" checked={useTarget} onChange={setUseTarget} description="Searches settings with a bounded number of attempts" />
        {useTarget && (
          <>
            <NumberField label="Target" suffix="KB" value={targetKB} onChange={(v) => setTargetKB(Math.max(1, Math.round(v)))} />
            <Toggle label="Allow reducing dimensions" checked={allowResize} onChange={setAllowResize} />
          </>
        )}
      </Section>
      <Section title="Result">
        <div role="status" aria-live="polite" className="text-sm">
          {busy && <p className="flex items-center gap-2 text-ink-3"><Loader2 size={14} className="animate-spin" /> Encoding…</p>}
          {err && <Hint tone="error">{err}</Hint>}
          {res && !err && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Uploaded file</dt><dd className="text-right tabular-nums">{formatBytes(origSize)}</dd>
              <dt className="text-muted">Encoded size</dt><dd className="text-right font-semibold tabular-nums text-ink-2">{formatBytes(res.blob.size)}</dd>
              <dt className="text-muted">Change</dt><dd className={`text-right tabular-nums ${delta <= 0 ? "text-green-700" : "text-danger"}`}>{delta <= 0 ? "−" : "+"}{Math.abs(delta).toFixed(1)}%</dd>
              <dt className="text-muted">Dimensions</dt><dd className="text-right tabular-nums">{res.width} × {res.height}</dd>
              {res.quality !== null && <><dt className="text-muted">Quality used</dt><dd className="text-right">{res.quality}</dd></>}
              {res.colors !== null && <><dt className="text-muted">Colours</dt><dd className="text-right">{res.colors}</dd></>}
              <dt className="text-muted">Encode attempts</dt><dd className="text-right">{res.attempts}</dd>
            </dl>
          )}
          {res?.reachedTarget === true && <p className="mt-2 text-xs text-green-700">Target reached.</p>}
          {res?.note && <div className="mt-2"><Hint tone={res.reachedTarget === false ? "warn" : "info"}>{res.note}</Hint></div>}
          {res && delta > 0 && <div className="mt-2"><Hint tone="warn">This result is larger than your uploaded file. Not every image gets smaller — try another format or lower quality.</Hint></div>}
        </div>
        {url && (
          <button type="button" onClick={() => setBigPreview(true)} className="checker block w-full overflow-hidden rounded-lg border border-line" aria-label="Open encoded preview larger">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Preview of the encoded result" className="mx-auto max-h-48 object-contain" />
          </button>
        )}
        <Button variant="accent" className="w-full" disabled={!res || busy} onClick={() => res && downloadBlob(res.blob, `${sanitizeName(e.project!.name)}-compressed.${ext}`)}>
          <Download size={16} /> Download compressed .{ext}
        </Button>
      </Section>
      <Dialog open={bigPreview} onClose={() => setBigPreview(false)} title="Encoded preview" wide>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <div className="checker p-2"><img src={url} alt="Encoded result at full size" className="mx-auto max-h-[75dvh] object-contain" /></div>}
      </Dialog>
    </>
  );
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, e } = useEditorState();
  const avif = useAvif();
  const ex = s.export;
  const setEx = (p: Partial<typeof ex>) => e.commit((x) => ({ ...x, export: { ...x.export, ...p } }), "export settings");
  const [est, setEst] = useState<number | null>(null);
  const [actual, setActual] = useState<{ size: number; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Blob | null>(null);
  const url = useObjectUrl(preview);
  const alpha = hasAlpha(ex.format);
  const flatten = !alpha || !ex.transparent ? ex.fill : null;
  const dimErr = validateDims(ex.width, ex.height, MAX_OUTPUT_SIDE, MAX_OUTPUT_PIXELS);

  // Estimate from a reduced-size real encode, scaled by pixel ratio (clearly labelled as an estimate).
  useEffect(() => {
    if (!open || dimErr) return;
    setActual(null);
    const t = setTimeout(async () => {
      try {
        const f = Math.min(1, 640 / Math.max(ex.width, ex.height));
        const w = Math.max(1, Math.round(ex.width * f)), h = Math.max(1, Math.round(ex.height * f));
        const c = renderExport(e.renderer, s, w, h, flatten);
        const b = await encodeCanvas(c, ex.format, ex.quality);
        setPreview(b);
        setEst(Math.round(b.size / (f * f)));
      } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    }, 400);
    return () => clearTimeout(t);
  }, [open, ex.width, ex.height, ex.format, ex.quality, flatten, s, e.renderer, dimErr, e.maskTick, e.bgTick]);

  const doExport = async () => {
    setBusy(true); setErr(null);
    try {
      const c = renderExport(e.renderer, s, ex.width, ex.height, flatten);
      if (c.width !== ex.width || c.height !== ex.height) throw new Error("Rendered dimensions didn't match the requested size.");
      const blob = await encodeCanvas(c, ex.format, ex.quality);
      c.width = 0;
      setActual({ size: blob.size, w: ex.width, h: ex.height });
      downloadBlob(blob, `${sanitizeName(ex.filename)}.${EXT[ex.format]}`);
      e.say(`Exported ${formatBytes(blob.size)}`);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  };

  const ratio = s.canvas.width / s.canvas.height;
  return (
    <Dialog open={open} onClose={onClose} title="Export image">
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_180px]">
        <div className="space-y-3">
          <label className="block text-xs text-ink-3">File name
            <div className="mt-1 flex items-center rounded-md border border-line">
              <input className="h-9 w-full min-w-0 rounded-md px-2 text-sm outline-none" value={ex.filename} onChange={(ev) => e.update((x) => ({ ...x, export: { ...x.export, filename: ev.target.value } }))} onBlur={() => setEx({ filename: sanitizeName(ex.filename) })} />
              <span className="pr-2 text-xs text-muted">.{EXT[ex.format]}</span>
            </div>
          </label>
          <Select<ExportFormat> label="Format" value={ex.format} onChange={(v) => setEx({ format: v })}
            options={[{ value: "png", label: "PNG – lossless, transparency" }, { value: "jpeg", label: "JPG – smaller, no transparency" }, { value: "webp", label: "WebP – small, transparency" }, ...(avif ? [{ value: "avif" as ExportFormat, label: "AVIF – browser encoder" }] : [])]} />
          {isLossy(ex.format) && <Slider label="Quality" min={1} max={100} value={ex.quality} defaultValue={90} onChange={(v) => e.update((x) => ({ ...x, export: { ...x.export, quality: v } }))} onStart={e.begin} onEnd={() => e.end("export quality")} />}
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Width" suffix="px" value={ex.width} onChange={(v) => setEx({ width: Math.round(v), height: ex.lockAspect ? Math.max(1, Math.round(v / ratio)) : ex.height })} />
            <NumberField label="Height" suffix="px" value={ex.height} onChange={(v) => setEx({ height: Math.round(v), width: ex.lockAspect ? Math.max(1, Math.round(v * ratio)) : ex.width })} />
          </div>
          <Toggle label="Lock to canvas aspect ratio" checked={ex.lockAspect} onChange={(v) => setEx({ lockAspect: v, ...(v ? { height: Math.max(1, Math.round(ex.width / ratio)) } : {}) })} />
          {dimErr && <Hint tone="error">{dimErr}</Hint>}
          {alpha ? (
            <Toggle label="Keep transparency" checked={ex.transparent} onChange={(v) => setEx({ transparent: v })} />
          ) : (
            <Hint>JPG can’t store transparency. Transparent areas will be flattened onto the colour below (white by default).</Hint>
          )}
          {flatten && <ColorField label={alpha ? "Background fill" : "Flattening colour"} value={ex.fill} swatches={e.swatches} onChange={(v) => setEx({ fill: v })} />}
          <Hint>Metadata is always removed: browser re-encoding writes no EXIF, GPS or camera data.</Hint>
        </div>
        <div className="space-y-2">
          <div className="checker grid aspect-square place-items-center overflow-hidden rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {url ? <img src={url} alt="Export preview" className="max-h-full max-w-full object-contain" /> : <Loader2 className="animate-spin text-muted" />}
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            {actual ? <>Actual size: <b className="text-ink-2">{formatBytes(actual.size)}</b> ({actual.w}×{actual.h})</> : est !== null ? <>Estimated size: ~{formatBytes(est)}</> : "Estimating…"}
          </p>
        </div>
      </div>
      {err && <div className="px-5 pb-3"><Hint tone="error">{err}</Hint></div>}
      <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-3">
        <Button onClick={onClose}>Close</Button>
        <Button variant="accent" disabled={busy || !!dimErr} onClick={doExport}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download {EXT[ex.format].toUpperCase()}</Button>
      </div>
    </Dialog>
  );
}
