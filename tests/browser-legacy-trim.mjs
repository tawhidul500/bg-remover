// Start the production app on port 3100, then `node tests/browser-legacy-trim.mjs`.
// Simulates an older IndexedDB project whose cropped mask has no preserved reserve.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.TEST_URL || "http://localhost:3100";
const fixture = fileURLToPath(new URL("./fixtures/portrait.jpg", import.meta.url));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
const aside = page.locator("aside");
const maskAlpha = () => page.locator("[data-viewport] canvas").first().evaluate((canvas) => {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let left = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 0.4; x++) left += d[(y * w + x) * 4 + 3];
  return left;
});
async function resizeTab() {
  await page.getByRole("button", { name: "Resize", exact: true }).first().click();
  await aside.getByRole("tab", { name: /Image/ }).click();
  await aside.locator("summary").filter({ hasText: "Trim the photo" }).click();
}

try {
  await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('input[aria-label="Choose images to upload"]').setInputFiles(fixture);
  await page.locator('input[aria-label="Project name"]').waitFor({ timeout: 30000 });
  await aside.locator("select").first().selectOption("portrait");
  await aside.getByRole("button", { name: "Remove background" }).click();
  await aside.locator("text=Background removed").first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(1500);
  await resizeTab();
  const left = aside.locator('input[aria-label="Left value"]');
  await left.fill("40"); await left.press("Enter");
  await page.waitForTimeout(1800);

  // Remove the new reserve field to reproduce an old project saved after cropping.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("cutout-studio");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(["projects", "masks"], "readwrite");
      const ps = tx.objectStore("projects").getAll();
      ps.onsuccess = () => {
        const project = ps.result[0];
        const store = tx.objectStore("masks");
        const m = store.get(project.id);
        m.onsuccess = () => {
          const saved = m.result;
          if (!saved?.current) { reject(new Error("Fixture has no saved mask")); return; }
          delete saved.maskReserve;
          store.put(saved, project.id);
        };
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[aria-label="Project name"]').waitFor({ timeout: 30000 });
  await resizeTab();
  assert.equal(await left.inputValue(), "40");
  await aside.getByRole("button", { name: "Reset crop" }).click();
  const warning = aside.getByText("This older cutout has no mask data", { exact: false });
  await warning.waitFor();
  assert.equal(await aside.getByRole("button", { name: "Rebuild the full cutout" }).count(), 1);
  const before = await maskAlpha();
  await aside.getByRole("button", { name: "Rebuild the full cutout" }).click();
  await page.getByRole("button", { name: /Run removal again/ }).waitFor({ timeout: 180000 });
  await page.waitForTimeout(1500);
  await resizeTab();
  assert.equal(await aside.getByText("This older cutout has no mask data", { exact: false }).count(), 0);
  const fresh = await maskAlpha();
  assert.ok(fresh > before, "Real model restored cutout pixels absent in the older cropped project");
  await left.fill("40"); await left.press("Enter");
  await aside.getByRole("button", { name: "Reset crop" }).click();
  assert.equal(await maskAlpha(), fresh, "Future crop resets use the new full-size mask reserve");
  assert.deepEqual(errors, []);
  console.log("PASS: Old cropped project shows honest warning; real reprocessing restores full mask and future trim resets.");
} finally {
  await browser.close();
}
