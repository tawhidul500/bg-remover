"use client";
import { useRef, useState } from "react";
import { Download, Loader2, RotateCw, X } from "lucide-react";
import { MAX_OUTPUT_PIXELS, MAX_OUTPUT_SIDE } from "@/lib/config";
import { downloadBlob, encodeCanvas, EXT, hasAlpha, makeZip, sanitizeName } from "@/lib/encode";
import { validateDims } from "@/lib/imageops";
import { resizeCanvasState, type CanvasMode } from "@/lib/layout";
import { ctx2d, Renderer, renderExport } from "@/lib/render";
import { cancelSegment, segment } from "@/lib/segmentation";
import { loadMasks, saveProject } from "@/lib/storage";
import { inputKey, newId, type Project, type ProjectState } from "@/lib/types";
import { formatBytes } from "@/lib/validate";
import { Button, Dialog, Hint, Section, Segmented, Toggle } from "../ui";
import { useEditor, type ItemStatus } from "./store";

const LABEL: Record<ItemStatus, string> = { idle: "Ready", queued: "Queued", processing: "Processing", done: "Completed", failed: "Failed", cancelled: "Cancelled" };

export default function BatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const e = useEditor();
  const cur = e.state;
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [opt, setOpt] = useState({ removeBg: true, background: true, adjust: false, shadow: true, canvas: "keep" as "keep" | "match", mode: "pad" as CanvasMode });
  const [results, setResults] = useState<Map<string, { blob: Blob; name: string }>>(new Map());
  const [stat, setStat] = useState<Map<string, { status: ItemStatus; text?: string }>>(new Map());
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);
  const job = useRef<string | null>(null);
  const list = e.items.filter((i) => !excluded.has(i.project.id));

  const setS = (id: string, status: ItemStatus, text?: string) => setStat((m) => new Map(m).set(id, { status, text }));

  const applySettings = (p: ProjectState): ProjectState => {
    if (!cur) return p;
    let st: ProjectState = { ...p, export: { ...p.export, format: cur.export.format, quality: cur.export.quality, transparent: cur.export.transparent, fill: cur.export.fill } };
    if (opt.background) st = { ...st, background: cur.background };
    if (opt.adjust) st = { ...st, adjust: cur.adjust };
    if (opt.shadow) st = { ...st, shadow: cur.shadow };
    if (opt.canvas === "match") st = resizeCanvasState(st, cur.canvas.width, cur.canvas.height, opt.mode, "c", 8);
    else st = { ...st, export: { ...st.export, width: st.canvas.width, height: st.canvas.height } };
    return st;
  };

  const processOne = async (p: Project) => {
    setS(p.id, "processing", "Loading image…");
    const blob = await e.blobFor(p.originalAssetId);
    if (!blob) throw new Error("Original image missing from storage.");
    const bm = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const r = new Renderer();
    try {
      r.setOriginal(bm); r.setInput(p.state.input);
      const key = inputKey(p.state.input);
      const saved = await loadMasks(p.id).catch(() => undefined);
      let mask = saved && p.maskInputKey === key && saved.width === r.ww && saved.height === r.wh ? saved.current : null;
      let auto = saved?.auto ?? null;
      if (!mask && opt.removeBg) {
        const id = newId(); job.current = id;
        const img = ctx2d(r.working!).getImageData(0, 0, r.ww, r.wh);
        mask = await segment(id, img, e.model, (s) => setS(p.id, "processing", s.kind === "inference" ? "Removing background…" : s.kind === "queued" ? "Queued" : "Loading model…"));
        job.current = null; auto = mask;
      }
      if (cancelled.current) throw new DOMException("Cancelled", "AbortError");
      r.setMask(mask);
      // Each image keeps its own shadow brush edits (never copied between images).
      const se = saved?.shadowErase;
      if (se && saved.sew === p.state.canvas.width && saved.seh === p.state.canvas.height) r.setShadowErase(se, saved.sew, saved.seh);
      else r.setShadowErase(null, 0, 0);
      r.bgImage = e.renderer.bgImage;
      const st = applySettings(p.state);
      const ve = validateDims(st.export.width, st.export.height, MAX_OUTPUT_SIDE, MAX_OUTPUT_PIXELS); if (ve) throw new Error(ve);
      setS(p.id, "processing", "Encoding…");
      const flatten = !hasAlpha(st.export.format) || !st.export.transparent ? st.export.fill : null;
      const c = renderExport(r, st, st.export.width, st.export.height, flatten);
      const out = await encodeCanvas(c, st.export.format, st.export.quality);
      c.width = 0;
      const np: Project = { ...p, state: st, maskInputKey: mask ? key : null, model: mask ? (p.model ?? e.model) : p.model, updatedAt: Date.now() };
      await saveProject(np, mask ? {
        auto, current: mask, width: r.ww, height: r.wh,
        maskReserve: saved?.maskReserve ?? null,
        shadowErase: saved?.shadowErase ?? null, sew: saved?.sew ?? 0, seh: saved?.seh ?? 0,
      } : undefined).catch(() => {});
      e.setItems((xs) => xs.map((x) => (x.project.id === p.id ? { ...x, project: np, status: mask ? "done" : x.status } : x)));
      setResults((m) => new Map(m).set(p.id, { blob: out, name: `${sanitizeName(p.name)}.${EXT[st.export.format]}` }));
      setS(p.id, "done", formatBytes(out.size));
    } finally { bm.close(); r.working = null; }
  };

  const run = async (ids: string[]) => {
    setRunning(true); cancelled.current = false;
    ids.forEach((id) => setS(id, "queued"));
    for (const id of ids) {
      const it = e.items.find((x) => x.project.id === id); if (!it) continue;
      if (cancelled.current) { setS(id, "cancelled"); continue; }
      try { await processOne(it.project); } catch (x) {
        const c = x instanceof DOMException && x.name === "AbortError";
        setS(id, c ? "cancelled" : "failed", c ? undefined : x instanceof Error ? x.message : String(x));
      }
    }
    setRunning(false);
    const active = e.project && e.items.find((x) => x.project.id === e.project!.id);
    if (active && ids.includes(active.project.id)) {
      const fresh = await import("@/lib/storage").then((m) => m.listProjects()).then((ps) => ps.find((q) => q.id === active.project.id));
      if (fresh) e.open(fresh);
    }
    e.say("Batch finished");
  };

  const cancel = () => { cancelled.current = true; if (job.current) cancelSegment(job.current); };
  const done = list.filter((i) => results.has(i.project.id));

  return (
    <Dialog open={open} onClose={() => { if (!running) onClose(); }} title="Batch processing" wide>
      <div className="grid gap-0 md:grid-cols-[280px_1fr]">
        <div className="border-b border-line-soft md:border-r md:border-b-0">
          <Section title="Apply from current image">
            <Toggle label="Remove backgrounds" description="Only for images without a cutout" checked={opt.removeBg} onChange={(v) => setOpt({ ...opt, removeBg: v })} />
            <Toggle label="Background settings" checked={opt.background} onChange={(v) => setOpt({ ...opt, background: v })} />
            <Toggle label="Colour adjustments" checked={opt.adjust} onChange={(v) => setOpt({ ...opt, adjust: v })} />
            <Toggle label="Shadow settings" checked={opt.shadow} onChange={(v) => setOpt({ ...opt, shadow: v })} />
            <Segmented label="Canvas size" value={opt.canvas} onChange={(v) => setOpt({ ...opt, canvas: v })} options={[{ value: "keep", label: "Keep each" }, { value: "match", label: cur ? `${cur.canvas.width}×${cur.canvas.height}` : "Match" }]} />
            {opt.canvas === "match" && <Segmented label="Fit mode" value={opt.mode} onChange={(v) => setOpt({ ...opt, mode: v })} options={[{ value: "fit", label: "Fit" }, { value: "fill", label: "Fill" }, { value: "pad", label: "Pad" }]} />}
            <p className="text-xs text-muted">Export: {cur?.export.format.toUpperCase()} {cur && cur.export.format !== "png" ? `q${cur.export.quality}` : ""}</p>
          </Section>
        </div>
        <div className="flex min-h-[300px] flex-col">
          <ul className="flex-1 divide-y divide-line-soft overflow-y-auto" aria-live="polite">
            {e.items.map((it) => {
              const st = stat.get(it.project.id); const ex = excluded.has(it.project.id);
              const status = st?.status ?? (results.has(it.project.id) ? "done" : "idle");
              return (
                <li key={it.project.id} className={`flex items-center gap-3 px-4 py-2 ${ex ? "opacity-40" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {it.thumb ? <img src={it.thumb} alt="" className="h-10 w-10 rounded-md object-cover" /> : <div className="h-10 w-10 rounded-md bg-surface" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{it.project.original.name}</p>
                    <p className={`truncate text-xs ${status === "failed" ? "text-danger" : "text-muted"}`}>
                      {status === "processing" && <Loader2 size={11} className="mr-1 inline animate-spin" />}{LABEL[status]}{st?.text ? ` · ${st.text}` : ""}
                    </p>
                  </div>
                  {(status === "failed" || status === "cancelled") && !running && <Button size="sm" onClick={() => run([it.project.id])}><RotateCw size={13} /> Retry</Button>}
                  {results.has(it.project.id) && <Button size="sm" variant="ghost" aria-label={`Download ${it.project.original.name}`} onClick={() => { const r = results.get(it.project.id)!; downloadBlob(r.blob, r.name); }}><Download size={14} /></Button>}
                  <Button size="sm" variant="ghost" disabled={running} aria-label={ex ? "Include in batch" : "Remove from batch"} onClick={() => setExcluded((s) => { const n = new Set(s); if (n.has(it.project.id)) n.delete(it.project.id); else n.add(it.project.id); return n; })}>{ex ? "Include" : <X size={14} />}</Button>
                </li>
              );
            })}
          </ul>
          {!e.items.length && <div className="p-4"><Hint>Upload images to build a batch.</Hint></div>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-4 py-3">
            {running ? <Button variant="danger" onClick={cancel}>Cancel batch</Button> : <Button variant="primary" disabled={!list.length} onClick={() => run(list.map((i) => i.project.id))}>Process {list.length} image{list.length === 1 ? "" : "s"}</Button>}
            <Button variant="accent" disabled={!done.length || running} onClick={async () => downloadBlob(await makeZip(done.map((i) => results.get(i.project.id)!)), "cutout-studio-batch.zip")}>
              <Download size={16} /> Download ZIP ({done.length})
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
