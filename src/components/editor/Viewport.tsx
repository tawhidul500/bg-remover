"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns2, Eye, Maximize, Minus, Plus, SplitSquareHorizontal, Square } from "lucide-react";
import { paintDab, type MaskRect } from "@/lib/imageops";
import { ctx2d } from "@/lib/render";
import { useEditor } from "./store";

type Compare = "off" | "slider" | "side";

export default function Viewport() {
  const e = useEditor();
  const { renderer, state, maskTick, shadowTick, bgTick, overlay, tool, brushMode, shadowBrush, brush, seg, hasMask, project } = e;
  const wrap = useRef<HTMLDivElement>(null);
  const editedRef = useRef<HTMLCanvasElement>(null);
  const origRef = useRef<HTMLCanvasElement>(null);
  const origSideRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [compare, setCompare] = useState<Compare>("off");
  const [holdOrig, setHoldOrig] = useState(false);
  const [split, setSplit] = useState(50);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [paintTick, setPaintTick] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Reveal sweep 0..100 while the cutout is unveiled; null when idle.
  const [reveal, setReveal] = useState<number | null>(null);
  const zoomRef = useRef(zoom); const panRef = useRef(pan);
  // Keep gesture positions synchronous. Reading a mutable gesture ref from inside a
  // queued React state updater makes drags lose their delta (especially at 100%).
  const moveView = useCallback((next: { x: number; y: number }) => {
    panRef.current = next;
    setPan(next);
  }, []);
  const zoomView = useCallback((next: number) => {
    zoomRef.current = next;
    setZoom(next);
  }, []);
  useEffect(() => { setSlot(document.getElementById("view-toolbar-slot")); }, []);

  const isBusy = !!seg && (seg.status === "queued" || seg.status === "model" || seg.status === "inference");
  const revealActive = reveal !== null;
  const revealRaf = useRef(0);
  const lastSegDone = useRef<object | null>(null);
  const projectId = project?.id ?? null;

  // New / switched image: single original first, side-by-side only if it already has a cutout.
  useEffect(() => {
    cancelAnimationFrame(revealRaf.current);
    setReveal(null);
    setHoldOrig(false);
    zoomView(1); moveView({ x: 0, y: 0 });
    setCompare(project?.maskInputKey ? "side" : "off");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => () => cancelAnimationFrame(revealRaf.current), []);

  // Cutout discarded (e.g. crop/rotate/flip the input): back to a single original.
  const hadMaskRef = useRef(hasMask);
  useEffect(() => {
    if (hadMaskRef.current && !hasMask && !isBusy && reveal === null) setCompare("off");
    hadMaskRef.current = hasMask;
  }, [hasMask, isBusy, reveal]);

  // Editing elsewhere (background, adjust, resize, shadow, compress): show the
  // single edited image. The user can still pick slider/side manually afterwards.
  const toolRef = useRef(tool);
  useEffect(() => {
    if (toolRef.current !== tool && tool !== "cutout") setCompare("off");
    toolRef.current = tool;
  }, [tool]);

  // After a successful removal: sweep-reveal the cutout, then land in side-by-side.
  useEffect(() => {
    if (!seg || seg.status !== "done" || lastSegDone.current === seg) return;
    lastSegDone.current = seg;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setCompare("side");
      return;
    }
    setCompare("off");
    setHoldOrig(false);
    setReveal(0);
    const start = performance.now();
    const dur = 1400;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setReveal(Math.round(eased * 100));
      if (t < 1) revealRaf.current = requestAnimationFrame(step);
      else {
        setReveal(null);
        setCompare("side");
      }
    };
    revealRaf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(revealRaf.current);
  }, [seg]);

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([en]) => setSize({ w: en.contentRect.width, h: en.contentRect.height }));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const cw = state?.canvas.width ?? 1, ch = state?.canvas.height ?? 1;
  const side = compare === "side";
  // The reveal sweep always plays in a single frame, even if side view was selected.
  const displaySide = side && !revealActive;
  const availW = displaySide ? size.w / 2 - 12 : size.w - 24;
  const fit = Math.max(0.01, Math.min(availW / cw, (size.h - 24) / ch));
  const boxW = cw * fit, boxH = ch * fit;
  const dpr = typeof window !== "undefined" ? Math.min(3, window.devicePixelRatio || 1) : 1;
  const bucket = Math.pow(2, Math.ceil(Math.log2(Math.max(1, zoom))));
  // Render at a higher backing resolution while zooming. The old 3000px cap
  // caused browser zoom to enlarge an already downsampled canvas, making the
  // original preview blurry. Keep the performance limit only for extreme cases.
  const maxPreviewSide = Math.max(3000, Math.min(10000, Math.max(cw, ch) * bucket));
  const k = Math.min(1, fit * bucket * dpr, maxPreviewSide / Math.max(cw, ch));

  // Render preview (same pipeline as export, smaller k). rAF-coalesced.
  const raf = useRef(0);
  const sayRef = useRef(e.say);
  useEffect(() => { sayRef.current = e.say; }, [e.say]);
  useEffect(() => {
    if (!state || !renderer.working) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      try {
        const out = renderer.render(state, k, { overlay: overlay && tool === "cutout" });
        for (const c of [editedRef.current]) {
          if (!c) continue; c.width = out.width; c.height = out.height; ctx2d(c).drawImage(out, 0, 0);
        }
        const needOrig = compare !== "off" || holdOrig || revealActive;
        if (needOrig) {
          const o = renderer.renderOriginal(state, k);
          for (const c of [origRef.current, origSideRef.current]) {
            if (!c) continue; c.width = o.width; c.height = o.height; ctx2d(c).drawImage(o, 0, 0);
          }
        }
      } catch (err) { sayRef.current(err instanceof Error ? err.message : "Preview failed"); }
    });
    return () => cancelAnimationFrame(raf.current);
  }, [state, maskTick, shadowTick, bgTick, overlay, tool, k, compare, holdOrig, paintTick, renderer, revealActive]);

  const zoomAt = useCallback((px: number, py: number, nz: number) => {
    const z = zoomRef.current, p = panRef.current;
    nz = Math.min(16, Math.max(0.1, nz));
    if (nz === z) return;
    // Keep the pixel beneath the zoom anchor in the same screen position.
    moveView({ x: px - (px - p.x) * (nz / z), y: py - (py - p.y) * (nz / z) });
    zoomView(nz);
  }, [moveView, zoomView]);
  const fitView = useCallback(() => { zoomView(1); moveView({ x: 0, y: 0 }); }, [moveView, zoomView]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
        zoomAt(ev.clientX - r.left - r.width / 2, ev.clientY - r.top - r.height / 2, zoomRef.current * Math.exp(-ev.deltaY * 0.0015));
      } else {
        const p = panRef.current;
        moveView({ x: p.x - ev.deltaX, y: p.y - ev.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, moveView]);

  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable]")) return;
      if (ev.code === "Space") { setSpace(true); if (t === document.body || t.closest("[data-viewport]")) ev.preventDefault(); }
      if (ev.key === "\\") setHoldOrig(true);
      if (ev.metaKey || ev.ctrlKey) return;
      if (ev.key === "+" || ev.key === "=") zoomAt(0, 0, zoomRef.current * 1.25);
      if (ev.key === "-") zoomAt(0, 0, zoomRef.current / 1.25);
      if (ev.key === "0") fitView();
    };
    const ku = (ev: KeyboardEvent) => { if (ev.code === "Space") setSpace(false); if (ev.key === "\\") setHoldOrig(false); };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [zoomAt, fitView]);

  // ---- pointer handling: brush, pan, pinch ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "pinch" | "paint"; d0?: number; z0?: number; p0?: { x: number; y: number }; m0?: { x: number; y: number }; last?: { x: number; y: number } } | null>(null);
  const strokeRef = useRef<{ base: Uint8Array; hadMask: boolean; buf: Uint8Array; last: { x: number; y: number } | null; erase: boolean; target: "mask" | "shadow"; w: number; h: number; touched: boolean; dirty: MaskRect | null } | null>(null);
  const paintingMask = tool === "cutout" && !!brushMode && !holdOrig && !isBusy && !revealActive;
  const paintingShadow = tool === "shadow" && !!shadowBrush && !holdOrig && !isBusy && !revealActive;
  const painting = paintingMask || paintingShadow;

  const rel = (ev: React.PointerEvent) => { const r = wrap.current!.getBoundingClientRect(); return { x: ev.clientX - r.left - r.width / 2, y: ev.clientY - r.top - r.height / 2 }; };

  const dabAt = (clientX: number, clientY: number) => {
    const st = strokeRef.current, c = editedRef.current; if (!st || !c || !state) return;
    const r = c.getBoundingClientRect();
    const cx = ((clientX - r.left) / r.width) * cw, cy = ((clientY - r.top) / r.height) * ch;
    if (st.target === "shadow") {
      // Shadow edits live in canvas space, so no subject-transform mapping is needed.
      const radius = (brush.size / 2) * (cw / r.width);
      const pts: { x: number; y: number }[] = [];
      if (st.last) {
        const dist = Math.hypot(cx - st.last.x, cy - st.last.y), step = Math.max(0.5, radius * 0.25);
        for (let s = step; s < dist; s += step) pts.push({ x: st.last.x + ((cx - st.last.x) * s) / dist, y: st.last.y + ((cy - st.last.y) * s) / dist });
      }
      pts.push({ x: cx, y: cy });
      for (const p of pts) if (paintDab(renderer.shadowErase!, st.base, st.buf, cw, ch, { x: p.x, y: p.y, radius, hardness: brush.hardness, opacity: brush.opacity }, st.erase)) st.touched = true;
      st.last = { x: cx, y: cy };
      renderer.bumpShadow(); setPaintTick((t) => t + 1);
      return;
    }
    const m = renderer.canvasToMask(state, cx, cy);
    const radius = ((brush.size / 2) * (cw / r.width)) / m.scale;
    const pts: { x: number; y: number }[] = [];
    if (st.last) {
      const dist = Math.hypot(m.x - st.last.x, m.y - st.last.y), step = Math.max(0.5, radius * 0.25);
      for (let s = step; s < dist; s += step) pts.push({ x: st.last.x + ((m.x - st.last.x) * s) / dist, y: st.last.y + ((m.y - st.last.y) * s) / dist });
    }
    pts.push({ x: m.x, y: m.y });
    for (const p of pts) {
      const rect = paintDab(renderer.mask!, st.base, st.buf, renderer.ww, renderer.wh,
        { x: p.x, y: p.y, radius, hardness: brush.hardness, opacity: brush.opacity }, st.erase);
      if (rect) {
        st.touched = true;
        st.dirty = st.dirty ? {
          x0: Math.min(st.dirty.x0, rect[0]), y0: Math.min(st.dirty.y0, rect[1]),
          x1: Math.max(st.dirty.x1, rect[2]), y1: Math.max(st.dirty.y1, rect[3]),
        } : { x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3] };
      }
    }
    st.last = { x: m.x, y: m.y };
    renderer.bumpMask(); setPaintTick((t) => t + 1);
  };

  const abortStroke = () => {
    const st = strokeRef.current; if (!st) return;
    if (st.target === "shadow") {
      if (st.hadMask) { renderer.shadowErase = st.base; renderer.shadowEraseW = st.w; renderer.shadowEraseH = st.h; }
      else renderer.shadowErase = null;
      renderer.bumpShadow();
    } else {
      renderer.setMask(st.hadMask ? st.base : null);
    }
    strokeRef.current = null; setPaintTick((t) => t + 1);
  };

  const onDown = (ev: React.PointerEvent) => {
    if (!state) return;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    pointers.current.set(ev.pointerId, rel(ev));
    if (pointers.current.size === 2) {
      abortStroke();
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: zoomRef.current, p0: { ...panRef.current }, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (pointers.current.size > 2) return;
    if (painting && !space && ev.button === 0) {
      if (paintingShadow) {
        renderer.ensureShadowDims(cw, ch);
        const had = !!renderer.shadowErase;
        const base = renderer.shadowErase ?? new Uint8Array(cw * ch).fill(255);
        renderer.shadowErase = base.slice(); renderer.shadowEraseW = cw; renderer.shadowEraseH = ch;
        strokeRef.current = { base, hadMask: had, buf: new Uint8Array(cw * ch), last: null, erase: shadowBrush === "erase", target: "shadow", w: cw, h: ch, touched: false, dirty: null };
      } else {
        const hadMask = !!renderer.mask;
        const base = renderer.mask ?? new Uint8Array(renderer.ww * renderer.wh).fill(255);
        renderer.mask = base.slice();
        strokeRef.current = { base, hadMask, buf: new Uint8Array(renderer.ww * renderer.wh), last: null, erase: brushMode === "erase", target: "mask", w: renderer.ww, h: renderer.wh, touched: false, dirty: null };
      }
      gesture.current = { kind: "paint" };
      dabAt(ev.clientX, ev.clientY);
    } else {
      gesture.current = { kind: "pan", last: rel(ev) };
    }
  };
  const onMove = (ev: React.PointerEvent) => {
    const p = rel(ev);
    if (painting) setCursor({ x: p.x, y: p.y });
    if (!pointers.current.has(ev.pointerId)) return;
    pointers.current.set(ev.pointerId, p);
    const g = gesture.current; if (!g) return;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nz = Math.min(16, Math.max(0.1, g.z0! * (d / Math.max(1, g.d0!))));
      moveView({ x: m.x - (g.m0!.x - g.p0!.x) * (nz / g.z0!), y: m.y - (g.m0!.y - g.p0!.y) * (nz / g.z0!) });
      zoomView(nz);
    } else if (g.kind === "pan" && g.last) {
      const dx = p.x - g.last.x, dy = p.y - g.last.y;
      g.last = p;
      if (dx || dy) {
        const prev = panRef.current;
        moveView({ x: prev.x + dx, y: prev.y + dy });
      }
    } else if (g.kind === "paint") {
      const evs = (ev.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [ev.nativeEvent];
      for (const ce of evs) dabAt(ce.clientX, ce.clientY);
    }
  };
  const onUp = (ev: React.PointerEvent) => {
    pointers.current.delete(ev.pointerId);
    const g = gesture.current;
    if (g?.kind === "paint" && strokeRef.current) {
      const st = strokeRef.current;
      if (!st.touched) {
        abortStroke();
      } else {
        strokeRef.current = null;
        if (st.target === "shadow") {
          e.pushShadowHistory(st.hadMask ? { data: st.base, w: st.w, h: st.h } : null, st.erase ? "erase shadow" : "restore shadow");
        } else {
          e.completeMaskStroke(st.hadMask ? st.base : null, st.erase ? "erase stroke" : "restore stroke", st.dirty);
        }
      }
    }
    if (pointers.current.size === 0) gesture.current = null;
    else if (g?.kind === "pinch") { const [a] = [...pointers.current.values()]; gesture.current = { kind: "pan", last: a }; }
  };

  const showOrig = holdOrig && !revealActive;
  const showScan = isBusy && !revealActive;
  const tf = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
  const box = (children: React.ReactNode, label?: string) => (
    <div className="absolute left-1/2 top-1/2" style={{ width: boxW, height: boxH, marginLeft: -boxW / 2, marginTop: -boxH / 2, transform: tf, transformOrigin: "center", willChange: "transform" }}>
      {children}
      {label && <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-ink-2/80 px-2 py-0.5 text-[11px] font-medium text-white" style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top left" }}>{label}</span>}
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-1 text-xs" role="toolbar" aria-label="View controls">
      <ToolBtn label="Zoom out (-)" onClick={() => zoomAt(0, 0, zoom / 1.25)}><Minus size={15} /></ToolBtn>
      <span className="w-11 shrink-0 text-center tabular-nums" aria-live="polite">{Math.round(zoom * fit * 100)}%</span>
      <ToolBtn label="Zoom in (+)" onClick={() => zoomAt(0, 0, zoom * 1.25)}><Plus size={15} /></ToolBtn>
      <ToolBtn label="Fit to screen (0)" onClick={fitView}><Maximize size={15} /></ToolBtn>
      <span className="mx-1 h-5 w-px shrink-0 bg-line-soft" aria-hidden />
      <ToolBtn label="No comparison" active={compare === "off"} onClick={() => setCompare("off")}><Square size={15} /></ToolBtn>
      <ToolBtn label="Comparison slider" active={compare === "slider"} onClick={() => setCompare("slider")}><SplitSquareHorizontal size={15} /></ToolBtn>
      <ToolBtn label="Side by side" active={compare === "side"} onClick={() => setCompare("side")}><Columns2 size={15} /></ToolBtn>
      {compare !== "side" && (
        <button type="button" aria-label="Hold to view original (or hold backslash)" aria-pressed={holdOrig}
          onPointerDown={() => setHoldOrig(true)} onPointerUp={() => setHoldOrig(false)} onPointerLeave={() => setHoldOrig(false)}
          onKeyDown={(ev) => { if (ev.key === " " || ev.key === "Enter") setHoldOrig(true); }} onKeyUp={() => setHoldOrig(false)}
          className={`ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 font-medium ${holdOrig ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-3"}`}>
          <Eye size={14} /> Hold for original
        </button>
      )}
      <span className="ml-2 hidden shrink-0 pr-1 tabular-nums text-muted xl:inline">Canvas {cw} × {ch} px · Working {renderer.ww} × {renderer.wh}</span>
    </div>
  );

  if (!state) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!slot && (
        <div className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line-soft bg-white px-2 py-1">
          {toolbar}
        </div>
      )}
      <div
        ref={wrap} data-viewport tabIndex={0} aria-label="Image canvas. Scroll or pinch to zoom, drag with space held to pan."
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-surface-2 outline-none"
        style={{ cursor: painting && !space ? "none" : gesture.current?.kind === "pan" ? "grabbing" : "grab" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => setCursor(null)}
      >
        {displaySide ? (
          <div className="absolute inset-0 grid grid-cols-2">
            <div className="relative overflow-hidden border-r border-line">{box(<canvas ref={origSideRef} className="checker h-full w-full shadow-sm" />, "Original")}</div>
            <div className="relative overflow-hidden">
              {box(
                <>
                  <canvas ref={editedRef} className="checker absolute inset-0 h-full w-full shadow-sm" />
                  {showScan && (
                    <div className="reveal-scan" aria-hidden>
                      <div className="reveal-scan-bar" />
                      <div className="reveal-scan-line" />
                    </div>
                  )}
                </>,
                "Edited",
              )}
            </div>
          </div>
        ) : revealActive ? (
          <>
            {box(
              <>
                <canvas ref={origRef} className="checker absolute inset-0 h-full w-full shadow-sm" />
                <canvas
                  ref={editedRef}
                  className="checker absolute inset-0 h-full w-full shadow-sm"
                  style={{ clipPath: `inset(0 ${100 - (reveal ?? 0)}% 0 0)` }}
                />
                <div className="pointer-events-none absolute top-0 bottom-0 z-10" style={{ left: `${reveal ?? 0}%` }} aria-hidden>
                  <div className="reveal-sweep-glow absolute top-0 bottom-0 right-0 w-16" />
                  <div className="absolute top-0 bottom-0 -translate-x-1/2 w-[3px] bg-white shadow-[0_0_0_1px_rgba(46,69,167,.7),0_0_16px_rgba(46,69,167,.9)]" />
                  <div className="absolute left-0 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-brand text-lg text-white shadow-xl">
                    ✂
                  </div>
                </div>
              </>,
            )}
            <div className="pointer-events-none absolute left-3 top-3 flex gap-2 text-[11px] font-medium">
              <span className="rounded-md bg-brand px-2 py-0.5 text-white">← Edited</span>
              <span className="rounded-md bg-ink-2/85 px-2 py-0.5 text-white">Original</span>
            </div>
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
              Removing background…
            </div>
          </>
        ) : (
          <>
            {box(
              <>
                <canvas ref={editedRef} className={`checker absolute inset-0 h-full w-full shadow-sm ${showOrig ? "invisible" : ""}`} />
                {(compare === "slider" || showOrig) && (
                  <canvas ref={origRef} className="checker absolute inset-0 h-full w-full"
                    style={{ clipPath: showOrig ? undefined : `inset(0 ${100 - split}% 0 0)` }} />
                )}
                {showScan && (
                  <div className="reveal-scan" aria-hidden>
                    <div className="reveal-scan-bar" />
                    <div className="reveal-scan-line" />
                  </div>
                )}
              </>,
              !hasMask && !showScan && compare === "off" ? "Original" : undefined,
            )}
            {compare === "slider" && !showOrig && (
              <SplitHandle split={split} setSplit={setSplit} boxW={boxW * zoom} left={size.w / 2 + pan.x - (boxW * zoom) / 2} />
            )}
            {(compare === "slider" || showOrig) && (
              <div className="pointer-events-none absolute left-3 top-3 flex gap-2 text-[11px] font-medium">
                <span className="rounded-md bg-ink-2/85 px-2 py-0.5 text-white">Original</span>
                {!showOrig && <span className="rounded-md bg-brand px-2 py-0.5 text-white">Edited →</span>}
              </div>
            )}
            {showScan && (
              <div role="status" className="pointer-events-none absolute left-1/2 top-3 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-full bg-ink-2/85 py-1 pl-3 pr-3 text-[11px] font-medium text-white shadow-lg">
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                <span className="truncate">{seg?.pct !== undefined ? `${seg.text} · ${seg.pct}%` : seg?.text ?? "Working…"}</span>
              </div>
            )}
          </>
        )}
        {painting && cursor && !space && (
          <div aria-hidden className="pointer-events-none absolute rounded-full border-2 border-white mix-blend-difference"
            style={{ width: brush.size, height: brush.size, left: size.w / 2 + cursor.x - brush.size / 2, top: size.h / 2 + cursor.y - brush.size / 2 }} />
        )}
      </div>
      {slot ? createPortal(toolbar, slot) : null}
    </div>
  );
}

function ToolBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${active ? "border-brand bg-brand/10 text-brand" : "border-transparent text-ink-3 hover:bg-surface"}`}
    >
      {children}
    </button>
  );
}

function SplitHandle({ split, setSplit, boxW, left }: { split: number; setSplit: (n: number) => void; boxW: number; left: number }) {
  const drag = useRef(false);
  const x = left + (boxW * split) / 100;
  const move = (clientX: number, el: HTMLElement) => {
    const r = el.parentElement!.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((clientX - r.left - left) / boxW) * 100)));
  };
  return (
    <div
      role="slider" aria-label="Comparison position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)} tabIndex={0}
      className="absolute top-0 bottom-0 z-10 w-8 -translate-x-1/2 cursor-ew-resize touch-none"
      style={{ left: x }}
      onPointerDown={(ev) => { ev.stopPropagation(); drag.current = true; (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); }}
      onPointerMove={(ev) => { if (drag.current) { ev.stopPropagation(); move(ev.clientX, ev.currentTarget as HTMLElement); } }}
      onPointerUp={(ev) => { ev.stopPropagation(); drag.current = false; }}
      onKeyDown={(ev) => { if (ev.key === "ArrowLeft") setSplit(Math.max(0, split - 2)); if (ev.key === "ArrowRight") setSplit(Math.min(100, split + 2)); }}
    >
      <div className="mx-auto h-full w-0.5 bg-white shadow-[0_0_0_1px_rgba(46,69,167,.6)]" />
      <div className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-brand text-white shadow-lg">⇆</div>
    </div>
  );
}
