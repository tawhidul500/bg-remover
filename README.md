# Cutout Studio (for Clipping World)

A background remover and image editor that runs in the browser, built with Next.js 16, React 19 and TypeScript. It's styled to match clippingworld.com (Poppins font; #2E45A7 primary, #1273EB blue and #FF872A accent) and can be embedded in the WordPress site with the included plugin.

**Workflow:** Upload → Remove background → Refine and edit → Export. You can also resize, compress or convert an image without removing its background.

## Architecture & key choices

| Concern | Choice | Why |
|---|---|---|
| Segmentation | **transformers.js 4 / ONNX Runtime Web** in a Web Worker (WebGPU, falling back to WASM) | Images never leave the device, so there's no upload, server GPU or API key to manage. |
| Default model | **IS-Net general-use** (`BritishWerewolf/IS-Net`, **Apache-2.0**, ~179 MB fp32) | Works for people, products and objects. Peak memory measured at ~1.7 GB. |
| Portrait model | **MODNet** (`Xenova/modnet`, **Apache-2.0**, ~7 MB q8) | Fast. Portraits only. |
| High-detail model | **BiRefNet-lite** (`onnx-community/BiRefNet_lite-ONNX`, **MIT**) | Only offered on WebGPU. Running it on the CPU used over 3.7 GB and was OOM-killed in testing, so it's blocked on WASM with a clear message. |
| Rendering | One Canvas 2D pipeline (`src/lib/render.ts`) used for both preview and export | Preview is the same render at a smaller scale factor `k`. Every distance and blur radius is multiplied by `k`. |
| Pixel ops | Pure TS (`src/lib/imageops.ts`) | Can be unit-tested. Blur is premultiplied and sharpening is alpha-weighted, so edges don't get dark or coloured fringes. |
| Encoding | Browser canvas encoders (PNG/JPG/WebP; AVIF only if the browser really returns `image/avif`) plus UPNG for lossless-optimised or palette PNG | Real bytes. Canvas encoders never write EXIF/GPS. |
| Persistence | IndexedDB (`idb`) — projects, the immutable original, auto/current masks and an untrimmed mask reserve, swatches, presets | Local only. There's no cross-device sync. |
| ZIP | `fflate` | Small and fast. |

Rendering order: 1 decode + EXIF orient → 2 input transform (crop/rotate/flip/resize) → 3 mask → 4 refine (expand/contract, feather) → 5 subject adjustments → 6 subject placement + shadow → 7 background (+ background adjustments) → 8 composite background → shadow → subject → 9 global adjustments → 10 export resize + encode.

Adjustment order: exposure → temperature/tint → shadows/highlights → contrast → saturation → sharpness. Alpha is never changed.

Stale protection: segmentation jobs carry an id and the input key. Results are dropped if the project, input or job changed. Cancelling ends the worker, so it really stops. Inference times out after 5 minutes.

### Moving and resizing in the editor
- Choose **Move** in Cutout or Shadow, or hold **Space** while painting, then drag the image. Drag works even at fit zoom; the Fit button resets the image to the centre. Mouse wheel zooms around the pointer; two fingers pinch and pan on touchscreens. Panning only changes your view, not the exported file.
- **Resize → Canvas** (opens by default) changes your finished picture. Pick a preset or type width/height; both update the preview without an Apply button. The chain locks the shape. Show all / Fill frame / With border and Position in frame update instantly.
- **Resize → Image** changes the working image before background removal. The original upload stays intact. Turn, flip, size, and crop preview live. On the first trim after background removal, the untrimmed auto and edited masks are retained locally. Decreasing a trim or pressing Reset crop redraws from those retained masks without another model run, including partial transparency and brush edits made while trimmed. The mask reserve is persisted and included in undo/redo. Projects already cropped in older app versions, or segmented only *after* cropping, may lack cutout data beyond that crop; the editor warns that newly revealed edges need a fresh removal in that case.
- **Resize → Subject** moves or scales the cut-out live. **Resize → Export** adjusts only the download dimensions; its live thumbnail shows the resulting crop without changing the editable canvas.
- Numeric resize fields wait briefly (~260ms) after typing before rendering; Enter and blur commit immediately. This prevents decoding and mask remapping on every keystroke. A slider drag is grouped into one undo step.

## Privacy, storage & retention
- All processing happens on the device. The server only serves the app; it receives no images and keeps no logs of image contents.
- Model weights download from Hugging Face (or `NEXT_PUBLIC_MODEL_HOST`) and are cached by the browser.
- Projects stay in the browser's IndexedDB until the user deletes them (trash icon in the tray) or clears site data. Storage quota errors are shown in the UI.
- Exports carry no metadata (no EXIF or GPS).

## Local development
```bash
npm install
cp .env.example .env     # adjust limits/branding if needed
npm run dev              # http://localhost:3000
npm test                 # unit tests (vitest)
npm run verify:models    # optional: runs real IS-Net + MODNet inference on tests/fixtures in Node
```

For browser interaction tests, run `npm run build && npx next start -p 3100` in one terminal, then `node tests/browser-resize.mjs && node tests/browser-trim.mjs && node tests/browser-legacy-trim.mjs` in another (requires `npx playwright install chromium` and Chromium system libraries). These check pan/pinch, live resize/undo, a real portrait cutout through trim → reduce trim → Reset crop → refresh → brush while cropped → refresh → Reset crop → Reset mask/undo/redo, and rebuilding an older cropped cutout with a real model. Stop the test server when done.

## Production build & deploy
```bash
npm run build && npm run start
```
Deploy to any Node host (Vercel, a VPS with PM2, Docker), for example at `https://tools.clippingworld.com`. Optionally set `ALLOWED_FRAME_ANCESTORS` to your WordPress origin(s) to stop other sites from framing the app (unset = framing allowed everywhere, which is needed for preview environments).

## WordPress integration (clippingworld.com)

The plugin in `wordpress/cutout-studio/` adds an **AI Service** menu item and a page that runs the editor inside your existing theme, so your header, footer, fonts and colours are used as-is.

1. Zip the `wordpress/cutout-studio/` folder and upload it under **Plugins → Add New → Upload Plugin**, then activate it.
   On activation it creates a published page **“AI Service – Background Remover & Image Editor”** at `/ai-service/` containing the `[cutout_studio]` shortcode.
2. Go to **Settings → Cutout Studio** and set the **App URL** to wherever this Next.js app is deployed (e.g. `https://tools.clippingworld.com`). Nothing works until this points at a live deployment.
3. The **AI Service** item is added automatically to your primary/main menu (it is skipped for footer menus). Options on the same screen:
   - **Menu label** – defaults to “AI Service”.
   - **Same look as my other menu items** (default) or **Highlighted button** like your orange “Free Trial” pill.
   - Turn auto-insert off if you'd rather place it yourself under **Appearance → Menus** (link to the AI Service page).
4. Optional shortcode attributes if you build your own page (Elementor: use the Shortcode widget in a full-width section):
   `[cutout_studio intro="no" title="…" subtitle="…" min_height="900"]`

The editor is loaded from `/embed`, which has no header, footer or navigation of its own, so there's no duplicated chrome inside your page. To stop other sites from framing it, set `ALLOWED_FRAME_ANCESTORS` on the deployment.

### Verified for the WordPress integration
Tested with a mock theme page (own header, menu, footer) framing `/embed` at 1366×900 and 420×820: the AI Service item renders with the theme's menu markup, the editor loads inside the page, a real upload reaches the canvas (1200×627), and no duplicate header appears in the frame. The plugin's PHP passes `php -l`, and its activation, settings sanitiser, menu injection (primary only, `current-menu-item` handling), shortcode output and attribute escaping were exercised against WordPress function stubs.

Not yet tested: a real WordPress install with the Astra theme and Elementor.

## Model self-hosting (optional)
Mirror these repos' files (`config.json`, `preprocessor_config.json`, `onnx/*.onnx`) under `<host>/<repo-id>/resolve/main/`, then set `NEXT_PUBLIC_MODEL_HOST=<host>/`:
- `BritishWerewolf/IS-Net`
- `Xenova/modnet`
- `onnx-community/BiRefNet_lite-ONNX`

## Verified in this environment
- Type generation, TypeScript and the production build pass. `/api/health` works under `build_and_start`.
- 29 unit tests cover: content sniffing (real JPEG fixture, APNG, animated WebP, GIF, HEIC and renamed-file rejection), header dimensions, adjustments preserving alpha, premultiplied blur without fringes, erase/restore brush maths, morphology, mask resampling and geometric mask transforms, full mask restoration when reducing/resetting trim, merging cropped brush edits without erasing hidden pixels, canvas resize/pad/align, dimension validation, unique ZIP names and bounded history.
- `node tests/browser-resize.mjs` passed in headless Chromium: drag pan at fit and after zoom, fit-to-screen reset, immediate canvas presets and debounced typed dimensions, live working-input dimensions/rotation/crop, Ctrl+Z while a crop slider is focused, non-destructive export dimensions with a live thumbnail, one-finger touch pan, two-finger pinch zoom, and the mobile settings sheet.
- `node tests/browser-trim.mjs` passed with a real portrait segmentation mask: 40% → 20% → 0% trim restored alpha exactly; the slider Home key and Reset crop restored it; the reserve and a cropped brush edit survived refresh; Reset mask, undo and redo stayed aligned with the reserve.
- `node tests/browser-legacy-trim.mjs` passed: an old mask record without a reserve shows a truthful warning; rebuilding on the expanded image with the actual portrait model restores missing alpha and future trim resets.
- Real inference in Node on test fixtures:
  - IS-Net: portrait 24.7% foreground; product (two sneakers) mask checked visually.
  - MODNet: portrait works; product fails, as expected for a portrait model.
  - BiRefNet-lite fp32 on CPU: OOM (>3.7 GB).

## Known limitations
- The browser interaction test ran in headless Chromium, not physical phones or Safari/Firefox. Test those browsers/devices before launch; WebGPU and browser downloads are not covered by the resize test.
- Adjustments, compositing and encoding run on the main thread. Very large outputs may briefly pause the UI.
- Sharpening is resolution-dependent, so a small-scale preview can look slightly different from the full-size export.
- Alignment ignores subject rotation. Input crop uses numeric sliders rather than on-canvas handles.
- Gradients and colour fills are drawn by the browser. Canvas limits (~16.7 MP on iOS) cap output size.
- First use downloads 7–179 MB of model weights.
