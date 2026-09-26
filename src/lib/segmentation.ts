// Client for the segmentation worker: bounded queue (1 job at a time), real cancellation
// (worker termination), inference timeout, and stale-result protection via job ids.
import { MODEL_HOST, MODELS, type ModelKey } from "./config";

export type SegStage =
  | { kind: "queued" }
  | { kind: "model"; device?: string; loaded?: number; total?: number; file?: string }
  | { kind: "inference"; device?: string };

interface Job {
  id: string;
  model: ModelKey;
  width: number;
  height: number;
  rgb: ArrayBuffer;
  onStage: (s: SegStage) => void;
  resolve: (m: Uint8Array) => void;
  reject: (e: Error) => void;
}

const INFERENCE_TIMEOUT_MS = 5 * 60 * 1000;

let worker: Worker | null = null;
let running: Job | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const queue: Job[] = [];

export function segmentationSupported(): string | null {
  if (typeof Worker === "undefined") return "Web Workers are not available in this browser.";
  if (typeof WebAssembly === "undefined") return "WebAssembly is not available in this browser, so the segmentation model cannot run.";
  return null;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/seg.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (!running || m.id !== running.id) return; // stale
      if (m.type === "progress") running.onStage({ kind: "model", loaded: m.loaded, total: m.total, file: m.file });
      else if (m.type === "stage") {
        running.onStage(m.stage === "inference" ? { kind: "inference", device: m.device } : { kind: "model", device: m.device });
        if (m.stage === "inference") armTimeout();
      } else if (m.type === "done") finish(null, new Uint8Array(m.mask));
      else if (m.type === "error") finish(new Error(friendly(m.error)));
    };
    worker.onerror = (e) => { finish(new Error(friendly(e.message || "The segmentation worker crashed."))); killWorker(); };
  }
  return worker;
}

function friendly(msg: string): string {
  if (/fetch|network|Failed to load|404|ERR_/i.test(msg)) return `The model files could not be downloaded (${msg}). Check your connection or content blockers, then retry.`;
  if (/memory|allocation|OOM|RangeError/i.test(msg)) return "The device ran out of memory while running the model. Reduce the working size (Resize → Input) and retry, or try the Fast portrait model.";
  return `Background removal failed: ${msg}`;
}

function armTimeout() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    finish(new Error("Background removal timed out after 5 minutes. Reduce the working size and try again."));
    killWorker();
  }, INFERENCE_TIMEOUT_MS);
}

function killWorker() { worker?.terminate(); worker = null; }

function finish(err: Error | null, mask?: Uint8Array) {
  if (timer) { clearTimeout(timer); timer = null; }
  const j = running; running = null;
  if (j) { if (err) j.reject(err); else j.resolve(mask!); }
  pump();
}

function pump() {
  if (running || !queue.length) return;
  running = queue.shift()!;
  const j = running;
  j.onStage({ kind: "model" });
  const md = MODELS[j.model];
  getWorker().postMessage({ type: "run", id: j.id, modelId: md.id, kind: md.kind, webgpuOnly: md.webgpuOnly, host: MODEL_HOST, width: j.width, height: j.height, rgb: j.rgb }, [j.rgb]);
}

/** Queue a segmentation job. `rgba` is converted to packed RGB before transfer. */
export function segment(id: string, img: ImageData, model: ModelKey, onStage: (s: SegStage) => void): Promise<Uint8Array> {
  const n = img.width * img.height;
  const rgb = new Uint8Array(n * 3);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    // Composite partially transparent input over white so the model sees the visible image.
    const a = d[i * 4 + 3] / 255;
    rgb[i * 3] = d[i * 4] * a + 255 * (1 - a); rgb[i * 3 + 1] = d[i * 4 + 1] * a + 255 * (1 - a); rgb[i * 3 + 2] = d[i * 4 + 2] * a + 255 * (1 - a);
  }
  return new Promise((resolve, reject) => {
    queue.push({ id, model, width: img.width, height: img.height, rgb: rgb.buffer, onStage, resolve, reject });
    onStage({ kind: "queued" });
    pump();
  });
}

/** Cancel a queued or running job. A running job is truly stopped by terminating the worker. */
export function cancelSegment(id: string) {
  const qi = queue.findIndex((j) => j.id === id);
  if (qi >= 0) { const [j] = queue.splice(qi, 1); j.reject(new DOMException("Cancelled", "AbortError") as unknown as Error); return; }
  if (running?.id === id) {
    killWorker();
    const j = running; running = null;
    if (timer) { clearTimeout(timer); timer = null; }
    j.reject(new DOMException("Cancelled", "AbortError") as unknown as Error);
    pump();
  }
}
