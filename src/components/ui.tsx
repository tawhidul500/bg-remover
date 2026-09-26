"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { RotateCcw, X } from "lucide-react";
import { hexToRgb, rgbToHex } from "@/lib/imageops";

type BtnVariant = "primary" | "accent" | "ghost" | "outline" | "danger";
export function Button({
  children, variant = "outline", className = "", size = "md", ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg" }) {
  const v: Record<BtnVariant, string> = {
    primary: "bg-brand text-white hover:bg-brand-dark border-transparent",
    accent: "bg-accent text-white hover:bg-accent-dark border-transparent",
    ghost: "bg-transparent hover:bg-surface border-transparent text-ink-2",
    outline: "bg-white hover:bg-surface border-line text-ink-2",
    danger: "bg-white hover:bg-red-50 border-red-200 text-danger",
  };
  const s = { sm: "h-8 px-2.5 text-xs", md: "h-10 px-3.5 text-sm", lg: "h-12 px-5 text-base" }[size];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${v[variant]} ${s} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, children, active, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active ? "border-brand bg-brand/10 text-brand" : "border-transparent text-ink-3 hover:bg-surface"} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line-soft px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Hint({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "error" }) {
  const c = { info: "bg-surface text-ink-3 border-line-soft", warn: "bg-amber-50 text-amber-900 border-amber-200", error: "bg-red-50 text-danger border-red-200" }[tone];
  return <div role={tone === "error" ? "alert" : undefined} className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${c}`}>{children}</div>;
}

/** Slider + numeric input. Drag = one history action (onStart/onEnd). */
export function Slider({
  label, value, min, max, step = 1, onStart, onChange, onEnd, unit = "", defaultValue, disabled,
}: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; defaultValue?: number; disabled?: boolean;
  onStart?: () => void; onChange: (v: number) => void; onEnd?: () => void;
}) {
  const id = useId();
  const dragging = useRef(false);
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const start = () => { if (!dragging.current) { dragging.current = true; onStart?.(); } };
  const end = () => { if (dragging.current) { dragging.current = false; onEnd?.(); } };
  const commitText = () => {
    const n = Number(text);
    if (!Number.isFinite(n)) { setText(String(value)); return; }
    onStart?.(); onChange(clamp(n)); onEnd?.();
  };
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm text-ink-2">{label}</label>
        <div className="flex items-center gap-1">
          <input
            aria-label={`${label} value`}
            className="h-8 w-16 rounded-md border border-line px-1.5 text-right text-sm tabular-nums"
            inputMode="decimal" value={text} disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => { if (e.key === "Enter") commitText(); }}
          />
          {unit && <span className="w-4 text-xs text-muted">{unit}</span>}
          {defaultValue !== undefined && (
            <button type="button" aria-label={`Reset ${label}`} title={`Reset ${label}`} disabled={disabled || value === defaultValue}
              className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface disabled:opacity-30"
              onClick={() => { onStart?.(); onChange(defaultValue); onEnd?.(); }}>
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>
      <input
        id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onPointerDown={start} onPointerUp={end} onPointerCancel={end}
        onKeyDown={start} onKeyUp={end} onBlur={end}
        onChange={(e) => { start(); onChange(Number(e.target.value)); }}
      />
    </div>
  );
}

export function Toggle({ label, checked, onChange, disabled, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg py-0.5 text-left disabled:cursor-not-allowed disabled:opacity-50">
      <span className="text-sm">
        <span className="block text-ink-2">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <span aria-hidden className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-brand" : "bg-slate-300"}`}>
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-lg bg-surface p-1">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${value === o.value ? "bg-white text-brand shadow-sm" : "text-ink-3 hover:text-ink-2"}`}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberField({ label, value, onChange, min, max, suffix, disabled }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string; disabled?: boolean }) {
  const id = useId();
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  const commit = () => { const n = Number(t); if (Number.isFinite(n) && t.trim() !== "") onChange(n); else setT(String(value)); };
  return (
    <label htmlFor={id} className="block text-xs text-ink-3">
      {label}
      <div className="mt-1 flex items-center rounded-md border border-line bg-white focus-within:border-brand">
        <input id={id} inputMode="numeric" className="h-9 w-full min-w-0 rounded-md px-2 text-sm tabular-nums outline-none" value={t} min={min} max={max} disabled={disabled}
          onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
        {suffix && <span className="pr-2 text-xs text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block text-xs text-ink-3">
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink-2">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Colour picker with HEX + RGB entry and saved swatches. */
export function ColorField({ label, value, onChange, swatches, onSaveSwatch }: { label: string; value: string; onChange: (v: string) => void; swatches?: string[]; onSaveSwatch?: (c: string) => void }) {
  const id = useId();
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const rgb = hexToRgb(value) ?? [0, 0, 0];
  const setChan = (i: number, v: number) => { const c = [...rgb] as [number, number, number]; c[i] = Math.min(255, Math.max(0, Math.round(v || 0))); onChange(rgbToHex(...c)); };
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm text-ink-2">{label}</legend>
      <div className="flex items-center gap-2">
        <input id={id} aria-label={`${label} picker`} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-11 cursor-pointer rounded-md border border-line bg-white p-0.5" />
        <input aria-label={`${label} HEX`} value={hex} onChange={(e) => setHex(e.target.value)}
          onBlur={() => { const r = hexToRgb(hex); if (r) onChange(rgbToHex(...r)); else setHex(value); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="h-9 w-24 rounded-md border border-line px-2 font-mono text-sm uppercase" />
        {(["R", "G", "B"] as const).map((c, i) => (
          <input key={`${c}-${rgb[i]}`} aria-label={`${label} ${c}`} title={c} inputMode="numeric" defaultValue={rgb[i]}
            onBlur={(e) => setChan(i, Number(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="h-9 w-12 min-w-0 rounded-md border border-line px-1 text-center text-sm tabular-nums" />
        ))}
      </div>
      {swatches && (
        <div className="flex flex-wrap items-center gap-1.5">
          {swatches.map((s) => (
            <button key={s} type="button" aria-label={`Use colour ${s}`} title={s} onClick={() => onChange(s)}
              className={`h-7 w-7 rounded-md border ${s.toLowerCase() === value.toLowerCase() ? "ring-2 ring-brand ring-offset-1" : "border-line"}`} style={{ background: s }} />
          ))}
          {onSaveSwatch && (
            <button type="button" onClick={() => onSaveSwatch(value)} className="h-7 rounded-md border border-dashed border-line px-2 text-xs text-ink-3 hover:bg-surface">+ Save</button>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Accessible modal dialog using the native <dialog> element (focus trap + Esc handled by browser). */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={`${title}-h`}
      className={`m-auto w-[calc(100%-1.5rem)] ${wide ? "max-w-4xl" : "max-w-lg"} rounded-2xl border border-line-soft p-0 shadow-2xl backdrop:bg-slate-900/50`}>
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
            <h2 id={`${title}-h`} className="text-lg font-semibold text-ink-2">{title}</h2>
            <IconButton label="Close dialog" onClick={onClose}><X size={18} /></IconButton>
          </div>
          <div className="overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
