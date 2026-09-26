"use client";
import { useEffect, useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import { ACCEPT_ATTR, MAX_BATCH, MAX_DECODED_PIXELS, MAX_FILE_BYTES } from "@/lib/config";
import { formatBytes } from "@/lib/validate";

/** Drag-and-drop + file picker + clipboard paste. Content is validated later from decoded bytes. */
export default function UploadDrop({ onFiles, compact = false, listenPaste = true }: { onFiles: (f: File[]) => void; compact?: boolean; listenPaste?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!listenPaste) return;
    const h = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,[contenteditable]")) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); onFiles(files.map((f, i) => new File([f], f.name && f.name !== "image.png" ? f.name : `pasted-image-${Date.now()}${i ? `-${i}` : ""}.png`, { type: f.type }))); }
      else setPasteMsg("The clipboard doesn't contain an image file.");
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, [onFiles, listenPaste]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); }}
      className={`rounded-2xl border-2 border-dashed bg-white text-center transition-colors ${over ? "border-accent bg-orange-50" : "border-brand/30"} ${compact ? "p-6" : "p-8 sm:p-10"}`}
    >
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-brand"><ImageUp size={28} /></div>
      <button type="button" onClick={() => input.current?.click()}
        className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-7 text-base font-semibold text-white shadow-md hover:bg-accent-dark">
        Choose image
      </button>
      <p className="mt-3 text-sm text-ink-3">or drag &amp; drop files here, or paste with <kbd className="rounded border border-line px-1 text-xs">Ctrl</kbd>+<kbd className="rounded border border-line px-1 text-xs">V</kbd></p>
      <p className="mt-2 text-xs text-muted">JPG, PNG or WebP · up to {formatBytes(MAX_FILE_BYTES)} and {(MAX_DECODED_PIXELS / 1e6).toFixed(0)} megapixels each · up to {MAX_BATCH} images</p>
      {pasteMsg && <p role="status" className="mt-2 text-xs text-danger">{pasteMsg}</p>}
      <input ref={input} type="file" accept={ACCEPT_ATTR} multiple className="hidden" aria-label="Choose images to upload"
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) onFiles(f); }} />
    </div>
  );
}
