import { Eraser, Image as ImageIcon, Layers, Lock, Maximize2, Palette, Scissors, Shrink, SlidersHorizontal, SunDim } from "lucide-react";
import LandingUpload from "@/components/LandingUpload";
import { SiteFooter, SiteHeader } from "@/components/site";
import { APP_NAME, MAX_BATCH, MAX_DECODED_PIXELS, MAX_FILE_BYTES, PARENT_SITE_URL } from "@/lib/config";

const FEATURES = [
  { icon: Scissors, title: "Automatic background removal", body: "An open-source segmentation model creates a real alpha mask, with soft edges where the model supports them." },
  { icon: Eraser, title: "Erase & restore brushes", body: "Fix mistakes with adjustable size, hardness and opacity, plus feathering and expand/contract controls." },
  { icon: Palette, title: "New backgrounds", body: "Transparent, solid colour, linear or radial gradients, your own background photo, or a blurred original." },
  { icon: SlidersHorizontal, title: "Colour adjustments", body: "Exposure, contrast, highlights, shadows, saturation, temperature, tint and sharpness — for subject, background or everything." },
  { icon: Maximize2, title: "Resize before & after", body: "Set the working size, the canvas size with fit/fill/padding presets, and a separate export size." },
  { icon: SunDim, title: "Rendered shadows", body: "Drop shadow that follows the subject’s silhouette, plus a soft ground shadow. Exported with transparency." },
  { icon: Shrink, title: "Compression", body: "Compress the original or the edit to JPG, WebP or PNG, with real encoded sizes and an optional target size." },
  { icon: Layers, title: "Batch & ZIP", body: `Process up to ${MAX_BATCH} of your images with shared settings and download the results as a ZIP.` },
  { icon: Lock, title: "Private by design", body: "Images are processed in your browser and saved only in this browser’s storage. No account needed." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero-gradient relative overflow-hidden">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 lg:grid-cols-[1.05fr_1fr] lg:py-16">
            <div className="text-white">
              <p className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide">Free online tool · {APP_NAME}</p>
              <h1 className="text-3xl font-bold leading-tight sm:text-4xl lg:text-[44px]">Remove image backgrounds and edit your photos in one place</h1>
              <p className="mt-4 max-w-xl text-base text-white/90 sm:text-lg">
                Upload a photo, cut out the subject automatically, refine the edges, add a new background, adjust colours, resize, add a shadow, compress and download a PNG, JPG or WebP.
              </p>
              <ul className="mt-5 space-y-1.5 text-sm text-white/90">
                <li>✓ Runs in your browser — images are not uploaded to a server</li>
                <li>✓ No account required, work is autosaved locally</li>
                <li>✓ Works on desktop, tablet and phone</li>
              </ul>
            </div>
            <div className="rounded-3xl bg-white/10 p-2 shadow-2xl ring-1 ring-white/20 sm:p-3">
              <LandingUpload />
            </div>
          </div>
        </section>

        <section id="features" className="bg-surface py-16" aria-labelledby="features-h">
          <div className="mx-auto max-w-7xl px-4">
            <h2 id="features-h" className="text-center text-2xl font-bold text-ink-2 sm:text-3xl"><span className="text-brand">Everything you need</span> from upload to export</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-ink-3">Upload → Remove background → Refine and edit → Export. You can also resize, compress or convert an image without removing its background.</p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-2xl border border-line-soft bg-white p-6 shadow-sm">
                  <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-brand"><f.icon size={22} /></div>
                  <h3 className="font-semibold text-ink-2">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14" aria-labelledby="limits-h">
          <div className="mx-auto grid max-w-5xl gap-8 px-4 md:grid-cols-2">
            <div>
              <h2 id="limits-h" className="text-xl font-bold text-ink-2">Files & limits</h2>
              <ul className="mt-3 space-y-2 text-sm text-ink-3">
                <li><b>Formats in:</b> JPG/JPEG, PNG (including transparency) and WebP. Files are checked by their contents, not their name.</li>
                <li><b>Not supported:</b> animated PNG/WebP, GIF, HEIC, AVIF, SVG — you’ll get a clear message instead of a half-processed result.</li>
                <li><b>Size:</b> up to {Math.round(MAX_FILE_BYTES / 1048576)} MB and {(MAX_DECODED_PIXELS / 1e6).toFixed(0)} megapixels per image.</li>
                <li><b>Formats out:</b> PNG, JPG and WebP (AVIF when your browser can genuinely encode it).</li>
                <li><b>First run:</b> the segmentation model (7–225 MB depending on choice) downloads once and is cached by your browser.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-line-soft bg-surface p-6">
              <ImageIcon className="text-brand" />
              <h2 className="mt-2 text-xl font-bold text-ink-2">Need studio-quality edits?</h2>
              <p className="mt-2 text-sm text-ink-3">Automatic results depend on the photo. For hair, glass, jewellery or large catalogues, our team can hand-finish your images.</p>
              <a href={`${PARENT_SITE_URL}/request-quote/`} className="mt-4 inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-dark">Request a quote</a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
