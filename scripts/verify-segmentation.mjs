import { pipeline, RawImage } from "@huggingface/transformers";
const model = process.argv[2];
const t0 = Date.now();
const seg = await pipeline("background-removal", model, { session_options: { enableCpuMemArena: false, enableMemPattern: false, intraOpNumThreads: 2 }, dtype: process.argv[3] || (model.includes("modnet") ? "q8" : "fp32") });
console.log("loaded", model, (Date.now()-t0)/1000, "s");
for (const f of ["portrait.jpg", "product.jpg"]) {
  const img = await RawImage.read("tests/fixtures/" + f);
  const t1 = Date.now();
  const out = await seg(img.rgb());
  const r = Array.isArray(out) ? out[0] : out;
  let lo=0, hi=0, mid=0; const n = r.width*r.height;
  for (let i=0;i<n;i++){ const a=r.data[i*4+3]; if(a<16) lo++; else if(a>239) hi++; else mid++; }
  // centre vs corner alpha
  const at=(x,y)=>r.data[(y*r.width+x)*4+3];
  console.log(f, `${r.width}x${r.height} ch=${r.channels}`, `bg=${(lo/n*100).toFixed(1)}% fg=${(hi/n*100).toFixed(1)}% partial=${(mid/n*100).toFixed(1)}%`, "corner", at(2,2), "centre", at(r.width>>1, r.height>>1), ((Date.now()-t1)/1000)+"s");
  await r.save(`/tmp/${model.split("/")[1]}-${f.replace(".jpg",".png")}`);
}
