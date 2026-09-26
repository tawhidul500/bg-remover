// Browser acceptance check. Start the built app on port 3100, then run:
//   node tests/browser-resize.mjs
// Uses the development-only portrait fixture; nothing is seeded in the live app.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const portrait = fileURLToPath(new URL("./fixtures/portrait.jpg", import.meta.url));
const base = process.env.TEST_URL || "http://localhost:3100";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('input[aria-label="Choose images to upload"]').setInputFiles(portrait);
  await page.locator('input[aria-label="Project name"]').waitFor({ timeout: 30000 });
  const view = page.locator("[data-viewport]");
  const image = page.locator("[data-viewport] canvas").first();
  const bounds = () => image.boundingBox();
  const rect = await view.boundingBox();
  assert.ok(rect && rect.width > 200, "Editor canvas is visible");
  const panFrom = async (dx, dy) => {
    const r = await view.boundingBox();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 });
    await page.mouse.up();
  };

  const fit = await bounds();
  await panFrom(80, 40);
  const moved = await bounds();
  assert.ok(Math.abs((moved?.x ?? 0) - fit.x - 80) < 5, `Hand pan at fit did not move 80px: ${moved?.x - fit.x}`);
  assert.ok(Math.abs((moved?.y ?? 0) - fit.y - 40) < 5, `Hand pan at fit did not move 40px: ${moved?.y - fit.y}`);
  await page.getByRole("button", { name: /Zoom in/ }).click();
  const zoomed = await bounds();
  assert.ok(zoomed.width > moved.width, "Zoom in increases displayed image size");
  await panFrom(-60, 30);
  const movedZoom = await bounds();
  assert.ok(Math.abs(movedZoom.x - zoomed.x + 60) < 5, "Hand pan works after zooming");
  await page.getByRole("button", { name: /Fit to screen/ }).click();
  const reset = await bounds();
  assert.ok(Math.abs(reset.x - fit.x) < 5 && Math.abs(reset.y - fit.y) < 5, "Fit restores centred view");
  console.log("PASS: Hand tool pans smoothly at fit and after zoom; Fit recentres.");

  await page.getByRole("button", { name: "Resize", exact: true }).first().click();
  const aside = page.locator("aside");
  const toolbar = page.locator("#view-toolbar-slot");
  const dims = () => toolbar.locator("text=/Canvas .* Working .*/").textContent();
  assert.equal(await aside.getByRole("tab", { name: /Canvas/ }).getAttribute("aria-selected"), "true");
  assert.equal(await aside.getByRole("button", { name: /Apply/ }).count(), 0, "No Apply buttons in resize");
  await aside.getByRole("button", { name: /Square 1:1/ }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Canvas 1080 × 1080 px"));
  assert.match(await dims(), /Canvas 1080 × 1080 px/);
  await aside.getByRole("textbox", { name: "Resize width" }).fill("900");
  await page.waitForFunction(() => document.body.textContent?.includes("Canvas 900 × 1080 px"));
  assert.match(await dims(), /Canvas 900 × 1080 px/);
  console.log("PASS: Canvas presets and typed dimensions update the preview without Apply.");

  await aside.getByRole("tab", { name: /Image/ }).click();
  await aside.getByRole("textbox", { name: "Resize width" }).fill("500");
  await page.waitForFunction(() => document.body.textContent?.includes("Working 500 × 750"));
  assert.match(await dims(), /Working 500 × 750/);
  assert.match(await dims(), /Canvas 900 × 1080/);
  await aside.getByRole("button", { name: "Right", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Working 750 × 500"));
  console.log("PASS: Working image resize and rotation preview live, independently of canvas.");

  await aside.locator("summary").filter({ hasText: "Trim the photo" }).click();
  const cropBefore = await dims();
  const cropLeft = aside.getByRole("slider", { name: "Left", exact: true });
  await cropLeft.focus();
  await cropLeft.press("ArrowRight");
  await page.waitForFunction((previous) => !document.body.textContent?.includes(previous), cropBefore);
  await page.keyboard.press("Control+z");
  await page.waitForFunction((previous) => document.body.textContent?.includes(previous), cropBefore);
  assert.equal(await dims(), cropBefore, "Undo restores a live crop even while the slider stays focused");
  console.log("PASS: Cropping updates live and Ctrl+Z works with the crop slider focused.");

  await aside.getByRole("tab", { name: /Export/ }).click();
  const thumb = aside.getByRole("img", { name: "Live download size preview" });
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas[aria-label="Live download size preview"]');
    return !!c && c.width > 0 && c.height > 0;
  });
  const thumbBefore = await thumb.evaluate((c) => ({ w: c.width, h: c.height }));
  await aside.getByRole("button", { name: "Unlock aspect ratio" }).click();
  await aside.getByRole("textbox", { name: "Resize width" }).fill("640");
  await page.waitForFunction((oldWidth) => {
    const c = document.querySelector('canvas[aria-label="Live download size preview"]');
    return !!c && c.width !== oldWidth;
  }, thumbBefore.w);
  const thumbAfter = await thumb.evaluate((c) => ({ w: c.width, h: c.height }));
  assert.notDeepEqual(thumbAfter, thumbBefore, "Export preview reflects new output shape");
  assert.match(await dims(), /Canvas 900 × 1080/, "Export resize does not destroy canvas size");
  console.log("PASS: Export dimensions update a live thumbnail without changing editable canvas.");

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  try {
    const phone = await mobile.newPage();
    phone.on("pageerror", (err) => errors.push(err.message));
    await phone.goto(`${base}/editor`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await phone.locator('input[aria-label="Choose images to upload"]').setInputFiles(portrait);
    await phone.locator('input[aria-label="Project name"]').waitFor({ timeout: 30000 });
    const phoneView = phone.locator("[data-viewport]");
    const phoneImage = phone.locator("[data-viewport] canvas").first();
    const r = await phoneView.boundingBox();
    const initial = await phoneImage.boundingBox();
    const touch = await mobile.newCDPSession(phone);
    const tx = r.x + r.width / 2, ty = r.y + r.height / 2;
    const send = (type, touchPoints) => touch.send("Input.dispatchTouchEvent", { type, touchPoints });
    await send("touchStart", [{ id: 1, x: tx, y: ty }]);
    for (let i = 1; i <= 8; i++) await send("touchMove", [{ id: 1, x: tx + i * 6, y: ty + i * 4 }]);
    await send("touchEnd", []);
    const dragged = await phoneImage.boundingBox();
    assert.ok(Math.abs(dragged.x - initial.x - 48) < 7, "One-finger hand drag works at fit on a phone");
    await send("touchStart", [{ id: 1, x: tx - 30, y: ty }, { id: 2, x: tx + 30, y: ty }]);
    for (let i = 1; i <= 8; i++) await send("touchMove", [{ id: 1, x: tx - 30 - i * 5, y: ty }, { id: 2, x: tx + 30 + i * 5, y: ty }]);
    await send("touchEnd", []);
    const pinched = await phoneImage.boundingBox();
    assert.ok(pinched.width > dragged.width * 1.4, "Pinch zoom enlarges image on a phone");
    await phone.getByRole("button", { name: "Resize", exact: true }).last().click();
    const sheet = phone.getByRole("dialog", { name: "Resize settings" });
    assert.equal(await sheet.getByRole("tab", { name: /Canvas/ }).getAttribute("aria-selected"), "true");
    await sheet.getByRole("button", { name: /Square 1:1/ }).click();
    assert.equal(await sheet.getByRole("button", { name: /Square 1:1/ }).getAttribute("aria-pressed"), "true");
    assert.equal(await sheet.getByRole("button", { name: /Apply/ }).count(), 0);
    assert.ok((await phoneView.boundingBox()).height > 100, "Canvas stays visible beside mobile settings");
    console.log("PASS: Touch pan, pinch zoom, and live Resize work in the mobile sheet.");
  } finally { await mobile.close(); }

  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: No browser runtime errors.");
} finally {
  await browser.close();
}
