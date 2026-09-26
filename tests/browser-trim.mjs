// Start a production build on port 3100, then `node tests/browser-trim.mjs`.
// Only uses the development portrait fixture; nothing is seeded in the live app.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.TEST_URL || "http://localhost:3100";
const photo = fileURLToPath(new URL("./fixtures/portrait.jpg", import.meta.url));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));

const aside = page.locator("aside");
const photoCanvas = () => page.locator("[data-viewport] canvas").first();
async function alphaSummary() {
  return photoCanvas().evaluate((canvas) => {
    const { width: w, height: h } = canvas;
    const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let leftAlpha = 0, totalAlpha = 0, subjectX = -1, subjectY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      totalAlpha += a;
      if (x < w * 0.4) leftAlpha += a;
      if (subjectX < 0 && x > w * 0.35 && x < w * 0.7 && y > h * 0.25 && y < h * 0.8 && a > 245) {
        subjectX = x; subjectY = y;
      }
    }
    return { w, h, leftAlpha, totalAlpha, subjectX, subjectY };
  });
}
async function editTrim(value) {
  const field = aside.locator('input[aria-label="Left value"]');
  await field.fill(String(value));
  await field.press("Enter");
  await page.waitForTimeout(200);
}

try {
  await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('input[aria-label="Choose images to upload"]').setInputFiles(photo);
  await page.locator('input[aria-label="Project name"]').waitFor({ timeout: 30000 });
  await aside.locator("select").first().selectOption("portrait");
  await aside.getByRole("button", { name: "Remove background" }).click();
  await aside.locator('text=Background removed').first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(1750);
  await page.getByRole("button", { name: "Resize", exact: true }).first().click();
  await aside.getByRole("tab", { name: /Image/ }).click();
  await aside.locator("summary").filter({ hasText: "Trim the photo" }).click();
  const full = await alphaSummary();
  assert.ok(full.leftAlpha > 50000 && full.subjectX >= 0, "Fixture contains real subject pixels left of centre");

  await editTrim(40);
  assert.equal(await aside.locator('input[aria-label="Left value"]').inputValue(), "40");
  await editTrim(20);
  assert.equal(await aside.locator('input[aria-label="Left value"]').inputValue(), "20");
  await editTrim(0);
  const restored = await alphaSummary();
  assert.equal(restored.w, full.w);
  assert.equal(restored.h, full.h);
  assert.equal(restored.leftAlpha, full.leftAlpha, "Reducing the trim restores actual cutout alpha, not a transparent band");
  console.log("PASS: 40% → 20% → 0% trim restores the original cutout alpha exactly.");

  await editTrim(40);
  const trimSlider = aside.getByRole("slider", { name: "Left", exact: true });
  await trimSlider.focus();
  await trimSlider.press("Home");
  await page.waitForTimeout(250);
  assert.equal(await aside.locator('input[aria-label="Left value"]').inputValue(), "0");
  assert.equal((await alphaSummary()).leftAlpha, full.leftAlpha, "Reducing the actual slider restores hidden mask data");
  console.log("PASS: Returning the trim slider to zero restores masked edges.");

  await editTrim(30);
  await aside.getByRole("button", { name: "Reset crop" }).click();
  assert.equal((await alphaSummary()).leftAlpha, full.leftAlpha, "Reset crop restores hidden cutout pixels");
  console.log("PASS: Reset crop restores the cutout without running segmentation again.");

  await editTrim(40);
  // Complete autosave before refresh.
  await page.waitForTimeout(1800);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[aria-label="Project name"]').waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Resize", exact: true }).first().click();
  await aside.getByRole("tab", { name: /Image/ }).click();
  await aside.locator("summary").filter({ hasText: "Trim the photo" }).click();
  assert.equal(await aside.locator('input[aria-label="Left value"]').inputValue(), "40");
  await aside.getByRole("button", { name: "Reset crop" }).click();
  assert.equal((await alphaSummary()).leftAlpha, full.leftAlpha, "Archive survives refresh");
  console.log("PASS: Archived untrimmed mask survives refresh and restores from Reset crop.");

  // Paint while trimmed. The edited region must be kept, while previously hidden
  // edges still restore from the archive.
  await editTrim(35);
  const trimmed = await alphaSummary();
  const el = await photoCanvas().boundingBox();
  assert.ok(el && trimmed.subjectX >= 0);
  const px = el.x + el.width * (trimmed.subjectX + 0.5) / trimmed.w;
  const py = el.y + el.height * (trimmed.subjectY + 0.5) / trimmed.h;
  await page.getByRole("button", { name: "Cutout", exact: true }).first().click();
  await aside.getByRole("radio", { name: "Erase" }).click();
  await page.mouse.move(px, py);
  await page.mouse.down(); await page.mouse.move(px + 4, py + 4, { steps: 3 }); await page.mouse.up();
  await page.waitForTimeout(1800);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[aria-label="Project name"]').waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Resize", exact: true }).first().click();
  await aside.getByRole("tab", { name: /Image/ }).click();
  await aside.locator("summary").filter({ hasText: "Trim the photo" }).click();
  await aside.getByRole("button", { name: "Reset crop" }).click();
  const withStroke = await alphaSummary();
  assert.ok(withStroke.leftAlpha > 0 && Math.abs(withStroke.leftAlpha - full.leftAlpha) < full.leftAlpha * 0.05,
    "Reset crop restores subject pixels hidden behind the trim");
  assert.ok(withStroke.totalAlpha < full.totalAlpha - 500,
    "The cropped erase stroke is still present after restoring the hidden edges");
  console.log("PASS: Manual brush stroke survives crop reset; hidden mask edges return.");

  await page.getByRole("button", { name: "Cutout", exact: true }).first().click();
  await aside.getByRole("button", { name: /Reset mask to automatic result/ }).click();
  await page.waitForTimeout(250);
  assert.equal((await alphaSummary()).totalAlpha, full.totalAlpha,
    "Reset mask removes the trimmed brush edit from the full archive too");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(250);
  assert.equal((await alphaSummary()).totalAlpha, withStroke.totalAlpha,
    "Undo restores the brush edit and its archived mask");
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(250);
  assert.equal((await alphaSummary()).totalAlpha, full.totalAlpha,
    "Redo restores the full automatic mask");
  console.log("PASS: Reset mask, undo, and redo keep the preserved mask consistent.");

  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: No browser runtime errors.");
} finally {
  await browser.close();
}
