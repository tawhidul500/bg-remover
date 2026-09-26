import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site";
import { APP_NAME, MAX_DECODED_PIXELS, MAX_FILE_BYTES, MAX_OUTPUT_PIXELS, MODELS } from "@/lib/config";

export const metadata: Metadata = { title: `Help & privacy – ${APP_NAME}` };

const SHORTCUTS: [string, string][] = [
  ["Ctrl/⌘ + Z", "Undo"], ["Ctrl/⌘ + Shift + Z or Ctrl + Y", "Redo"], ["Ctrl/⌘ + E", "Open export"],
  ["E / R", "Erase / restore brush"], ["H or V", "Move (pan) mode"], ["[ and ]", "Smaller / larger brush"],
  ["Space + drag", "Pan while painting"], ["+ / − / 0", "Zoom in / out / fit"], ["Hold \\", "Show original"],
];

export default function Help() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 text-ink-3">
        <h1 className="text-3xl font-bold text-ink-2">Help &amp; privacy</h1>

        <h2 className="mt-8 text-xl font-semibold text-ink-2">How it works</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
          <li>Upload JPG, PNG or WebP images (drag &amp; drop, choose, or paste).</li>
          <li>In <b>Cutout</b>, choose a model and press <b>Remove background</b>. The first run downloads the model once.</li>
          <li>Refine with the erase/restore brushes, feathering and expand/contract.</li>
          <li>Pick a background, adjust colours, resize, and add shadows.</li>
          <li>Use <b>Export</b> for PNG/JPG/WebP, or <b>Compress</b> for size-optimised files. Batch results download as a ZIP.</li>
        </ol>

        <h2 className="mt-8 text-xl font-semibold text-ink-2">Where your images are processed</h2>
        <p className="mt-2 text-sm">Everything — decoding, background removal, editing and encoding — runs <b>on your device</b> in the browser. Your images are <b>not uploaded</b> to our server or any third-party service. The only network downloads are the application itself and the model weights, fetched from Hugging Face (or the site’s own model host if configured) and cached by your browser.</p>

        <h2 className="mt-8 text-xl font-semibold text-ink-2">Storage &amp; retention</h2>
        <p className="mt-2 text-sm">Projects (original image, masks and settings) are autosaved in this browser’s IndexedDB so you can recover them after a refresh. They stay until you delete them (trash icon in the image tray) or clear site data. They are <b>not synced</b> across devices or browsers. The server keeps no copies of your images, so there is nothing server-side to delete.</p>

        <h2 className="mt-8 text-xl font-semibold text-ink-2">Metadata</h2>
        <p className="mt-2 text-sm">Exports are re-encoded by the browser, which writes no EXIF, GPS/location or camera metadata. Orientation from the original EXIF is applied to the pixels on import.</p>

        <h2 className="mt-8 text-xl font-semibold text-ink-2">Models &amp; licences</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {Object.values(MODELS).map((m) => <li key={m.id}><b>{m.label}</b> — <code>{m.id}</code>, {m.license} licence. {m.note}</li>)}
          <li>Inference runtime: transformers.js / ONNX Runtime Web (Apache-2.0), WebGPU when available, otherwise WebAssembly.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold text-ink-2">Limits</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>Upload: {Math.round(MAX_FILE_BYTES / 1048576)} MB and {(MAX_DECODED_PIXELS / 1e6).toFixed(0)} MP per file.</li>
          <li>Output: up to {(MAX_OUTPUT_PIXELS / 1e6).toFixed(1)} MP (browser canvas limits, especially on iPhone/iPad).</li>
          <li>Enlarging uses interpolation — it does not add detail and is not “AI upscaling”.</li>
          <li>Automatic cutouts are not perfect on every photo; fine hair, glass and low-contrast edges may need brush work.</li>
          <li>Unsupported: animated images, GIF, HEIC/HEIF, AVIF input, SVG.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold text-ink-2">Keyboard shortcuts</h2>
        <table className="mt-2 w-full text-sm">
          <tbody>{SHORTCUTS.map(([k, v]) => <tr key={k} className="border-b border-line-soft"><td className="py-1.5 pr-4 font-mono text-xs">{k}</td><td>{v}</td></tr>)}</tbody>
        </table>

        <p className="mt-10"><Link href="/editor" className="inline-flex h-11 items-center rounded-full bg-accent px-6 font-semibold text-white">Open the editor</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}
