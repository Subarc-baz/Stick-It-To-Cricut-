// v6.1: mat colour + undo of text->shapes through the real UI. Real Chromium.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const FILE = process.env.APP_HTML || path.resolve(__dirname, '..', 'index.html');
const EXE = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const REG = process.env.FONT_TTF || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] }); });
test.after(async () => { await browser.close(); });
async function setup(ctxOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1500, height: 950 } }, ctxOpts)), page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message)); await page.goto('file://' + FILE); await page.waitForTimeout(250); page.errs = errs; page.ctx = ctx; return page;
}
// canvas pixel at design coords (inside the mat)
const px = (p, x, y) => p.evaluate(([x, y]) => { const d = ctx.getImageData(Math.round(x * zoom + panX), Math.round(y * zoom + panY), 1, 1).data; return [d[0], d[1], d[2]]; }, [x, y]);
const near = (a, b, t = 3) => a.every((v, i) => Math.abs(v - b[i]) <= t);

test('mat colour: presets, custom, reset, black object becomes visible on a light mat', async () => {
  const p = await setup();
  await p.evaluate(() => { gridOn = false; objects.push({ id: 1, type: 'rect', x: 100, y: 100, w: 100, h: 100, fill: '#000000', stroke: 'none', strokeW: 0, alpha: 1, name: 'Black' }); nextId = 2; draw(); });
  assert.ok(near(await px(p, 400, 400), [0x0c, 0x0c, 0x20]));
  await p.click('#btnMat'); assert.equal(await p.locator('#matPopover').count(), 1);
  await p.click('#matPopover button[title="White"]');
  assert.ok(near(await px(p, 400, 400), [255, 255, 255]));
  assert.ok(near(await px(p, 150, 150), [0, 0, 0]), 'black rect still black');
  await p.evaluate(() => { const i = document.getElementById('matCustom'); i.value = '#c8c8cc'; i.dispatchEvent(new Event('input')); });
  assert.ok(near(await px(p, 400, 400), [0xc8, 0xc8, 0xcc]));
  await p.click('#matPopover button:text("Reset")');
  assert.ok(near(await px(p, 400, 400), [0x0c, 0x0c, 0x20]));
  await p.keyboard.press('Escape'); assert.equal(await p.locator('#matPopover').count(), 0);
  assert.deepEqual(p.errs, []);
});

test('mat colour: grid contrasts on light mats, invalid colours rejected, swatch follows, not in SVG, no undo entry', async () => {
  const p = await setup();
  const r = await p.evaluate(() => {
    const bad = [setMatColor('red'), setMatColor('#12'), setMatColor('url(x)'), setMatColor('#GGGGGG')];
    setMatColor('#ffffff'); const light = matInk(0.1); setMatColor('#0c0c20'); const dark = matInk(0.1);
    return { bad, light, dark, undo: undoStack.length, col: matColor };
  });
  assert.deepEqual(r.bad, [false, false, false, false]); assert.match(r.light, /^rgba\(0,0,0/); assert.match(r.dark, /^rgba\(255,255,255/); assert.equal(r.undo, 0);
  await p.evaluate(() => { objects.push({ id: 1, type: 'rect', x: 10, y: 10, w: 50, h: 50, fill: '#123456', stroke: 'none', strokeW: 0, alpha: 1, name: 'R' }); nextId = 2; setMatColor('#ffffff'); });
  const svg = await p.evaluate(async () => (await buildSvg({ units: 'in', textOutlines: false })).svg);
  assert.ok(!/ffffff/i.test(svg.replace(/stroke="#ffffff"/gi, '')) || !/fill="#ffffff"/i.test(svg), 'mat colour must not be in the cut file');
  assert.ok(/123456/.test(svg)); assert.deepEqual(p.errs, []);
});

test('mat colour persists across reloads in the same browser profile', async () => {
  const p = await setup();
  await p.click('#btnMat'); await p.click('#matPopover button[title="Cream"]'); await p.keyboard.press('Escape');
  await p.reload(); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => matColor), '#f3ead3');
  assert.deepEqual(p.errs, []);
});

test('undo restores text after "Convert Text to Shapes" via the real buttons', { skip: fs.existsSync(REG) ? false : 'no DejaVu' }, async () => {
  const p = await setup(); p.on('dialog', d => d.accept());
  const b64 = fs.readFileSync(REG).toString('base64');
  await p.evaluate(async (b) => {
    await FontLib.addFiles([new File([Uint8Array.from(atob(b), c => c.charCodeAt(0))], 'DejaVuSans.ttf')]);
    objects.push({ id: 1, type: 'text', x: 100, y: 200, text: 'Hi', fill: '#fff', stroke: 'none', strokeW: 0, alpha: 1, font: '64px "DejaVu Sans", sans-serif', name: 'Text: Hi', w: 0, h: 52, curve: 0, warp: 'none' }); nextId = 2; selectMany([1]); draw();
  }, b64);
  await p.waitForTimeout(400);
  await p.evaluate(() => setTool('text')); await p.evaluate(() => selectMany([1]));
  await p.click('#btnTextToShapes'); await p.waitForTimeout(500);
  assert.deepEqual(await p.evaluate(() => objects.map(o => o.type)), ['path']);
  assert.equal(await p.locator('#btnUndo').isDisabled(), false);
  await p.click('#btnUndo'); assert.deepEqual(await p.evaluate(() => objects.map(o => o.type)), ['text']);
  await p.click('#btnRedo'); assert.deepEqual(await p.evaluate(() => objects.map(o => o.type)), ['path']);
  await p.keyboard.press('Control+z'); assert.deepEqual(await p.evaluate(() => objects.map(o => o.type)), ['text']);
  assert.deepEqual(p.errs, []);
});
