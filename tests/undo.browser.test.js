// v6.1: visible Undo/Redo buttons + Ctrl+Shift+Z. Real Chromium.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const FILE = process.env.APP_HTML || path.resolve(__dirname, '..', 'index.html');
const EXE = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] }); });
test.after(async () => { await browser.close(); });

async function setup() {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message)); await page.goto('file://' + FILE); await page.waitForTimeout(250); page.errs = errs; return page;
}
async function drawRect(page, x1, y1, x2, y2) {
  const bx = await page.locator('#cvs').boundingBox();
  await page.evaluate(() => setTool('rect'));
  await page.mouse.move(bx.x + x1, bx.y + y1); await page.mouse.down(); await page.mouse.move(bx.x + x2, bx.y + y2, { steps: 5 }); await page.mouse.up();
}
const count = p => p.evaluate(() => objects.length);

test('undo/redo buttons exist, start disabled, work, and track state', async () => {
  const p = await setup();
  assert.ok(await p.locator('#btnUndo').count() && await p.locator('#btnRedo').count());
  assert.equal(await p.locator('#btnUndo').isDisabled(), true);
  assert.equal(await p.locator('#btnRedo').isDisabled(), true);
  await drawRect(p, 300, 300, 450, 400); await p.waitForTimeout(350);
  assert.equal(await count(p), 1);
  assert.equal(await p.locator('#btnUndo').isDisabled(), false);
  await p.click('#btnUndo'); assert.equal(await count(p), 0);
  await p.waitForTimeout(350);
  assert.equal(await p.locator('#btnRedo').isDisabled(), false);
  assert.equal(await p.locator('#btnUndo').isDisabled(), true);
  await p.click('#btnRedo'); assert.equal(await count(p), 1);
  assert.deepEqual(p.errs, []);
});

test('multiple steps undo in order; Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z still work', async () => {
  const p = await setup();
  await drawRect(p, 300, 300, 400, 380); await drawRect(p, 500, 300, 600, 380);
  assert.equal(await count(p), 2);
  await p.click('#btnUndo'); assert.equal(await count(p), 1);
  await p.click('#btnUndo'); assert.equal(await count(p), 0);
  await p.click('#btnRedo'); await p.click('#btnRedo'); assert.equal(await count(p), 2);
  await p.keyboard.press('Control+z'); assert.equal(await count(p), 1);
  await p.keyboard.press('Control+Shift+z'); assert.equal(await count(p), 2);
  await p.keyboard.press('Control+z'); await p.keyboard.press('Control+y'); assert.equal(await count(p), 2);
  assert.deepEqual(p.errs, []);
});
