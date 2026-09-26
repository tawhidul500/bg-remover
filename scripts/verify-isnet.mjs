// Dev verification: IS-Net general-use (Apache-2.0) via transformers.js AutoModel + custom pre/post-processing.
import { AutoModel, RawImage, Tensor } from "@huggingface/transformers";
const t0 = Date.now();
const model = await AutoModel.from_pretrained("BritishWerewolf/IS-Net", { config: { model_type: "custom" }, dtype: "fp32" });
console.log("loaded", (Date.now() - t0) / 1000, "s", "inputs", model.sessions?.model?.inputNames, "outputs", model.sessions?.model?.outputNames?.slice(-2));
const S = 1024;
for (const f of ["portrait.jpg", "product.jpg"]) {
  const img = (await RawImage.read("tests/fixtures/" + f)).rgb();
  const r = await img.resize(S, S);
  const px = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) px[c * S * S + i] = r.data[i * 3 + c] / 255 - 0.5;
  const t1 = Date.now();
  const out = await model({ input_image: new Tensor("float32", px, [1, 3, S, S]) });
  const o = out.output_image ?? Object.values(out)[0];
  const d = o.data; let mi = Infinity, ma = -Infinity;
  for (const v of d) { if (v < mi) mi = v; if (v > ma) ma = v; }
  const m8 = new Uint8ClampedArray(S * S);
  for (let i = 0; i < S * S; i++) m8[i] = ((d[i] - mi) / (ma - mi || 1)) * 255;
  const mask = await new RawImage(m8, S, S, 1).resize(img.width, img.height);
  let lo = 0, hi = 0, mid = 0; const n = img.width * img.height;
  for (let i = 0; i < n; i++) { const a = mask.data[i]; if (a < 16) lo++; else if (a > 239) hi++; else mid++; }
  console.log(f, o.dims, `range ${mi.toFixed(3)}..${ma.toFixed(3)}`, `bg=${(lo / n * 100).toFixed(1)}% fg=${(hi / n * 100).toFixed(1)}% partial=${(mid / n * 100).toFixed(1)}%`, "corner", mask.data[2 * img.width + 2], "centre", mask.data[(img.height >> 1) * img.width + (img.width >> 1)], (Date.now() - t1) / 1000 + "s");
  await mask.save(`/tmp/isnet-${f.replace(".jpg", ".png")}`);
}
