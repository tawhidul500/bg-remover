/// <reference lib="webworker" />
// Background-removal worker. Runs an ONNX segmentation model with transformers.js / ONNX Runtime Web
// (WebGPU when available, otherwise WebAssembly). Images never leave the device.
import { AutoModel, env, pipeline, RawImage, Tensor } from "@huggingface/transformers";

type Msg = { type: "run"; id: string; modelId: string; kind: "isnet" | "pipeline"; webgpuOnly: boolean; host: string; width: number; height: number; rgb: ArrayBuffer };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
env.allowLocalModels = false;
env.useBrowserCache = true;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Runner = (img: RawImage) => Promise<Uint8Array>;
const runners = new Map<string, Promise<Runner>>();
let device: "webgpu" | "wasm" | null = null;

async function pickDevice(): Promise<"webgpu" | "wasm"> {
  if (device) return device;
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    device = gpu && (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch { device = "wasm"; }
  return device;
}

const ISNET_SIZE = 1024;

/** IS-Net: stretch to 1024², RGB/255 − 0.5, min-max normalise output, bilinear-resize back to image size. */
async function loadIsnet(modelId: string, dev: "webgpu" | "wasm", progress_callback: (p: unknown) => void): Promise<Runner> {
  const model = await AutoModel.from_pretrained(modelId, { config: { model_type: "custom" } as never, dtype: "fp32", device: dev, progress_callback });
  return async (img) => {
    const S = ISNET_SIZE;
    const r = await img.resize(S, S);
    const px = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) px[c * S * S + i] = r.data[i * 3 + c] / 255 - 0.5;
    const out = await model({ input_image: new Tensor("float32", px, [1, 3, S, S]) });
    const o = (out.output_image ?? Object.values(out)[0]) as Tensor;
    const d = o.data as Float32Array;
    let mi = Infinity, ma = -Infinity;
    for (let i = 0; i < S * S; i++) { const v = d[i]; if (v < mi) mi = v; if (v > ma) ma = v; }
    const m8 = new Uint8ClampedArray(S * S);
    const k = ma - mi || 1;
    for (let i = 0; i < S * S; i++) m8[i] = ((d[i] - mi) / k) * 255;
    const mask = await new RawImage(m8, S, S, 1).resize(img.width, img.height);
    return new Uint8Array(mask.data);
  };
}

async function loadPipeline(modelId: string, dev: "webgpu" | "wasm", progress_callback: (p: unknown) => void): Promise<Runner> {
  const isModnet = modelId.includes("modnet");
  const dtype = dev === "webgpu" ? "fp16" : isModnet ? "q8" : "fp32";
  const pipe = await pipeline("background-removal", modelId, { device: dev, dtype, progress_callback });
  return async (img) => {
    const out = (await pipe(img)) as RawImage | RawImage[];
    const res = Array.isArray(out) ? out[0] : out;
    if (!res || res.channels !== 4 || res.width !== img.width || res.height !== img.height) throw new Error("The model returned an unexpected mask shape.");
    const mask = new Uint8Array(img.width * img.height);
    for (let i = 0; i < mask.length; i++) mask[i] = res.data[i * 4 + 3];
    return mask;
  };
}

function getRunner(m: Msg): Promise<Runner> {
  if (m.host) env.remoteHost = m.host;
  if (!runners.has(m.modelId)) {
    const p = (async () => {
      const dev = await pickDevice();
      if (m.webgpuOnly && dev !== "webgpu") throw new Error("This model needs WebGPU, which isn't available in this browser. Choose the General (IS-Net) model instead.");
      const progress_callback = (p: unknown) => {
        const q = p as { status: string; file?: string; loaded?: number; total?: number };
        if (q.status === "progress" && q.total) ctx.postMessage({ type: "progress", id: m.id, file: q.file, loaded: q.loaded, total: q.total });
      };
      const load = (d: "webgpu" | "wasm") => (m.kind === "isnet" ? loadIsnet(m.modelId, d, progress_callback) : loadPipeline(m.modelId, d, progress_callback));
      ctx.postMessage({ type: "stage", id: m.id, stage: "model", device: dev });
      try { return await load(dev); } catch (e) {
        if (dev !== "webgpu" || m.webgpuOnly) throw e;
        device = "wasm";
        ctx.postMessage({ type: "stage", id: m.id, stage: "model", device: "wasm" });
        return await load("wasm");
      }
    })();
    p.catch(() => runners.delete(m.modelId));
    runners.set(m.modelId, p);
  }
  return runners.get(m.modelId)!;
}

ctx.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    const run = await getRunner(m);
    ctx.postMessage({ type: "stage", id: m.id, stage: "inference", device });
    const mask = await run(new RawImage(new Uint8ClampedArray(m.rgb), m.width, m.height, 3));
    ctx.postMessage({ type: "done", id: m.id, mask: mask.buffer, device }, [mask.buffer]);
  } catch (err) {
    ctx.postMessage({ type: "error", id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
