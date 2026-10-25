// Real-Chromium (headless, Playwright) tests of the built index.html.
// Run: node --test tests/      (NODE_PATH must reach playwright; see README)
// USB/Serial in these tests are MOCKS injected into the page. No Cricut hardware was involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

const FILE = process.env.APP_HTML || path.resolve(__dirname, '..', 'index.html');
const EXE = process.env.CHROMIUM || (require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] }); });
test.after(async () => { await browser.close(); });

const MOCK_USB = () => {
  window.__usbMode = 'ok'; window.__usbCalls = { writes: 0, claims: 0 };
  Object.defineProperty(navigator, 'usb', { configurable: true, value: {
    requestDevice: async () => {
      if (window.__usbMode === 'dismissed') { const e = new Error('none'); e.name = 'NotFoundError'; throw e; }
      return { vendorId: 0x1234, productId: 0xabcd, productName: 'MOCK DEVICE', manufacturerName: 'MOCK', opened: false, configurations: [],
        open: async function () { if (window.__usbMode === 'busy') { const e = new Error('busy'); e.name = 'NetworkError'; throw e; } this.opened = true; },
        close: async function () { this.opened = false; },
        transferOut: async () => { window.__usbCalls.writes++; }, claimInterface: async () => { window.__usbCalls.claims++; } };
    }, addEventListener() { }, removeEventListener() { } } });
};

async function fresh(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  if (opts.mockUsb) await page.addInitScript(MOCK_USB);
  await page.goto('file://' + FILE); await page.waitForTimeout(250);
  page.errors = errors; page.ctx = ctx;
  page.box = await page.locator('#cvs').boundingBox();
  // helpers (mat-pixel coordinates -> screen)
  page.scr = async (mx, my) => { const t = await page.evaluate(() => [zoom, panX, panY]); return [page.box.x + mx * t[0] + t[1], page.box.y + my * t[0] + t[2]]; };
  page.drag = async (a, b, o = {}) => {
    const [x1, y1] = await page.scr(...a), [x2, y2] = await page.scr(...b);
    if (o.shift) await page.keyboard.down('Shift');
    await page.mouse.move(x1, y1); await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 3 }); await page.mouse.move(x2, y2, { steps: 3 }); await page.mouse.up();
    if (o.shift) await page.keyboard.up('Shift');
  };
  page.clickAt = async (m, o = {}) => { const [x, y] = await page.scr(...m); if (o.shift) await page.keyboard.down('Shift'); await page.mouse.click(x, y); if (o.shift) await page.keyboard.up('Shift'); };
  page.draw = async (tool, a, b) => { await page.evaluate(t => setTool(t), tool); await page.drag(a, b); await page.evaluate(() => setTool('select')); };
  page.objs = () => page.evaluate(() => JSON.parse(snapshotObjects()));
  page.shapes5 = async () => {
    await page.draw('rect', [100, 100], [250, 200]); await page.draw('circle', [450, 150], [500, 190]);
    await page.draw('star', [700, 150], [760, 150]); await page.draw('polygon', [900, 150], [960, 150]); await page.draw('line', [100, 400], [300, 500]);
  };
  return page;
}
// geometry must stay self-consistent: the hit-box (x,y,w,h) must match the drawn geometry
function consistent(o) {
  const near = (a, b) => Math.abs(a - b) < 0.01;
  if (o.type === 'ellipse') return near(o.x, o.cx - o.rx) && near(o.y, o.cy - o.ry);
  if (o.type === 'star' || o.type === 'polygon') return near(o.x, o.cx - o.r) && near(o.y, o.cy - o.r);
  if (o.type === 'line') return near(o.x, Math.min(o.x1, o.x2)) && near(o.y, Math.min(o.y1, o.y2));
  return true;
}
const done = async p => { await p.ctx.close(); };

test('page loads with no JavaScript errors; machine panel present', async () => {
  const p = await fresh(); assert.deepEqual(p.errors, []);
  assert.ok(await p.evaluate(() => !!window.CricutMachine && !!document.getElementById('btnSimConn') && !!document.getElementById('btnUsbConn')));
  await done(p);
});

test('draw all five shape types with the mouse (original v4 could not: resizingText ReferenceError)', async () => {
  const p = await fresh(); await p.shapes5(); const o = await p.objs();
  assert.deepEqual(o.map(x => x.type), ['rect', 'ellipse', 'star', 'polygon', 'line']); assert.deepEqual(p.errors, []); await done(p);
});

test('dragging moves the DRAWN geometry for every shape type, not just the hit-box', async () => {
  const p = await fresh(); await p.shapes5();
  const before = await p.objs(); const centers = [[175, 150], [450, 150], [700, 150], [900, 150], [200, 450]];
  for (const c of centers) await p.drag(c, [c[0] + 100, c[1] + 80]);
  const after = await p.objs();
  after.forEach((o, i) => {
    assert.ok(consistent(o), o.type + ' geometry/hit-box diverged');
    const key = o.cx !== undefined ? 'cx' : o.x1 !== undefined ? 'x1' : 'x';
    assert.ok(o[key] - before[i][key] > 80, o.type + ' did not visibly move: ' + (o[key] - before[i][key]));
  });
  assert.deepEqual(p.errors, []); await done(p);
});

test('plain click does not move the object or add an undo step; drag is a single undo step that restores position', async () => {
  const p = await fresh(); await p.draw('rect', [100, 100], [250, 200]);
  const u0 = await p.evaluate(() => undoStack.length), x0 = (await p.objs())[0].x;
  await p.clickAt([175, 150]); assert.equal(await p.evaluate(() => undoStack.length), u0); assert.equal((await p.objs())[0].x, x0);
  await p.drag([175, 150], [275, 230]); assert.equal(await p.evaluate(() => undoStack.length), u0 + 1); assert.ok((await p.objs())[0].x > x0 + 80);
  await p.evaluate(() => undo()); assert.equal((await p.objs())[0].x, x0); await p.evaluate(() => redo()); assert.ok((await p.objs())[0].x > x0 + 80);
  assert.deepEqual(p.errors, []); await done(p);
});

test('dragging is correct while zoomed and panned (coordinate conversion)', async () => {
  const p = await fresh(); await p.draw('circle', [450, 300], [500, 340]);
  const [sx, sy] = await p.scr(450, 300); await p.mouse.move(sx, sy); for (let i = 0; i < 12; i++) await p.mouse.wheel(0, -100); await p.waitForTimeout(80);
  await p.evaluate(() => { panX += 37; panY -= 21; draw(); });
  const z = await p.evaluate(() => zoom); assert.ok(z > 1.2, 'zoomed');
  const b = (await p.objs())[0]; await p.drag([b.cx, b.cy], [b.cx + 50, b.cy + 40]);
  const a = (await p.objs())[0]; assert.ok(consistent(a));
  assert.ok(Math.abs(a.cx - b.cx - 50) <= 10 && Math.abs(a.cy - b.cy - 40) <= 10, `moved (${a.cx - b.cx},${a.cy - b.cy}) expected ~ (50,40)`);
  await done(p);
});

test('marquee selects several objects; group; clicking a member selects the group; group drags as one; ungroup', async () => {
  const p = await fresh(); await p.shapes5();
  await p.drag([50, 50], [1100, 300]);
  assert.equal(await p.evaluate(() => selIds.length), 4);
  await p.keyboard.press('Control+g'); let o = await p.objs();
  const gid = o[0].gid; assert.ok(gid); assert.equal(o.filter(x => x.gid === gid).length, 4); assert.equal(o[4].gid, undefined);
  await p.clickAt([50, 700]); assert.equal(await p.evaluate(() => selIds.length), 0);
  await p.clickAt([700, 150]);                                    // click the star only
  assert.equal(await p.evaluate(() => selIds.length), 4, 'whole group selected from one member');
  const before = await p.objs(); await p.drag([700, 150], [800, 230]); const after = await p.objs();
  const dxs = after.slice(0, 4).map((x, i) => { const k = x.cx !== undefined ? 'cx' : 'x'; return +(x[k] - before[i][k]).toFixed(2); });
  assert.ok(dxs.every(d => d === dxs[0] && d > 80), 'all members moved by the same delta: ' + dxs); after.forEach(x => assert.ok(consistent(x)));
  assert.equal(after[4].x1, before[4].x1, 'non-member did not move');
  await p.keyboard.press('Control+Shift+G'); o = await p.objs(); assert.ok(o.every(x => !x.gid));
  assert.deepEqual(p.errors, []); await done(p);
});

test('shift-click adds/removes; plain click inside multi-selection (no drag) selects just that item', async () => {
  const p = await fresh(); await p.shapes5();
  await p.clickAt([175, 150]); await p.clickAt([450, 150], { shift: true }); assert.equal(await p.evaluate(() => selIds.length), 2);
  await p.clickAt([450, 150], { shift: true }); assert.equal(await p.evaluate(() => selIds.length), 1);
  await p.clickAt([450, 150], { shift: true }); await p.clickAt([175, 150]); assert.equal(await p.evaluate(() => selIds.length), 1);
  await p.keyboard.press('Control+a'); assert.equal(await p.evaluate(() => selIds.length), 5, 'Ctrl+A selects everything'); await done(p);
});

test('grouped copy/paste remaps group ids; delete removes the whole group; undo restores it', async () => {
  const p = await fresh(); await p.shapes5(); await p.drag([50, 50], [1100, 300]); await p.keyboard.press('Control+g');
  await p.keyboard.press('Control+c'); await p.keyboard.press('Control+v'); let o = await p.objs();
  assert.equal(o.length, 9); const gids = [...new Set(o.filter(x => x.gid).map(x => x.gid))]; assert.equal(gids.length, 2);
  o.forEach(x => assert.ok(consistent(x)));
  await p.keyboard.press('Delete'); assert.equal((await p.objs()).length, 5);
  await p.evaluate(() => undo()); assert.equal((await p.objs()).length, 9); assert.deepEqual(p.errors, []); await done(p);
});

test('resize by corner handle: rect, ellipse and a group (consistent geometry, one undo step)', async () => {
  const p = await fresh(); await p.draw('rect', [100, 100], [250, 200]);
  await p.clickAt([175, 150]); let b = (await p.objs())[0];
  await p.drag([b.x + b.w, b.y + b.h], [b.x + b.w + 96, b.y + b.h + 48]); let a = (await p.objs())[0];
  assert.ok(a.w > b.w + 80 && a.h > b.h + 40, `rect resized ${b.w}x${b.h} -> ${a.w}x${a.h}`);
  await p.evaluate(() => undo()); assert.equal((await p.objs())[0].w, b.w);
  await p.draw('circle', [600, 300], [650, 340]); const ei = 1; await p.clickAt([600, 300]);
  b = (await p.objs())[ei]; await p.drag([b.x + b.w, b.y + b.h], [b.x + b.w + 40, b.y + b.h + 40]); a = (await p.objs())[ei];
  assert.ok(consistent(a) && a.rx > b.rx && a.ry > b.ry);
  await p.drag([50, 50], [800, 500]); await p.keyboard.press('Control+g'); const sb = await p.evaluate(() => selectionBounds());
  const w0 = sb.w; await p.drag([sb.x + sb.w, sb.y + sb.h], [sb.x + sb.w + 100, sb.y + sb.h + 100], { shift: true });
  const sb2 = await p.evaluate(() => selectionBounds()); assert.ok(sb2.w > w0 + 60); (await p.objs()).forEach(x => assert.ok(consistent(x)));
  assert.deepEqual(p.errors, []); await done(p);
});

test('numeric Transform panel moves and resizes the selection', async () => {
  const p = await fresh(); await p.draw('rect', [100, 100], [250, 200]); await p.clickAt([175, 150]);
  await p.fill('#tfX', '3'); await p.press('#tfX', 'Tab'); await p.fill('#tfW', '4'); await p.press('#tfW', 'Tab');
  const o = (await p.objs())[0]; assert.equal(Math.round(o.x), 288); assert.equal(Math.round(o.w), 384); assert.deepEqual(p.errors, []); await done(p);
});

test('images survive undo/redo, save/load and copy (v4: <img> serialised to {} then drawImage threw)', async () => {
  const p = await fresh();
  await p.evaluate(() => new Promise(res => { const im = new Image(); im.onload = () => { objects.push({ id: nextId++, type: 'image', img: im, src: im.src, x: 100, y: 100, w: 50, h: 50, fill: 'none', stroke: 'none', strokeW: 0, alpha: 1, name: 'px' }); draw(); res(); };
    im.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='; }));
  await p.evaluate(() => { pushUndo(); objects[0].x = 200; draw(); undo(); redo(); undo(); });
  await p.waitForTimeout(100); assert.ok(await p.evaluate(() => objects[0].img instanceof HTMLImageElement));
  await p.evaluate(() => { selectAll(); copySelected(); pasteClipboard(); }); assert.ok(await p.evaluate(() => objects.length === 2 && objects[1].img instanceof HTMLImageElement));
  assert.deepEqual(p.errors, []); await done(p);
});

test('export PNG/SVG and save-project run without errors', async () => {
  const p = await fresh(); await p.shapes5();
  await p.evaluate(() => { exportSVG(); exportPNG(); saveProject(); }); await p.waitForTimeout(200); assert.deepEqual(p.errors, []); await done(p);
});

test('SVG export contains every shape type (v4 silently dropped star, polygon and line)', async () => {
  const p = await fresh(); await p.shapes5();
  const svg = await p.evaluate(async () => { let blob; URL.createObjectURL = b => { blob = b; return 'blob:x'; }; await exportSVG(); return await blob.text(); });
  assert.equal((svg.match(/<rect/g) || []).length, 1); assert.equal((svg.match(/<ellipse/g) || []).length, 1);
  assert.equal((svg.match(/<polygon/g) || []).length, 2); assert.equal((svg.match(/<line/g) || []).length, 1); assert.deepEqual(p.errors, []); await done(p);
});

test('context menu Copy works (v4 passed a string instead of a function)', async () => {
  const p = await fresh(); await p.draw('rect', [100, 100], [250, 200]); await p.clickAt([175, 150]);
  const [x, y] = await p.scr(175, 150); await p.mouse.click(x, y, { button: 'right' });
  await p.getByRole('button', { name: /^Copy/ }).first().click();
  assert.ok(await p.evaluate(() => Array.isArray(clipboard) && clipboard.length === 1)); assert.deepEqual(p.errors, []); await done(p);
});

/* ---------------- machine panel: SIMULATION ---------------- */
async function openCutTab(p) { await p.click('.vtab[data-t="cut"]'); }
test('SIMULATOR: connect and run a simulated cut of the design; clearly labelled', async () => {
  const p = await fresh(); await p.shapes5(); await p.click('.vtab[data-t="cut"]').catch(() => { });
  await p.evaluate(() => { __machine.autoConfirm = true; }); await p.evaluate(() => document.querySelector('.vtab[data-t="cut"]').click());
  await p.click('#btnSimConn'); await p.waitForTimeout(50);
  assert.match(await p.textContent('#cutStatus'), /SIMULATED/); assert.equal(await p.textContent('#stConnTxt'), 'SIMULATED');
  await p.evaluate(() => __machine.runCut(false)); await p.waitForTimeout(100);
  const log = await p.textContent('#conOut'); assert.match(log, /Job prepared: 5 paths/); assert.match(log, /SIMULATION complete\. No hardware/);
  assert.deepEqual(p.errors, []); await done(p);
});
test('SIMULATOR: injected transfer fault is reported, app stays usable', async () => {
  const p = await fresh(); await p.shapes5();
  await p.evaluate(() => { __machine.autoConfirm = true; __machine.simOptions = { fail: 'transfer', chunkPoints: 1 }; document.querySelector('.vtab[data-t="cut"]').click(); });
  await p.click('#btnSimConn'); await p.waitForTimeout(50); await p.evaluate(() => __machine.runCut(false)); await p.waitForTimeout(100);
  assert.match(await p.textContent('#conOut'), /SIMULATED_FAULT/); await p.evaluate(() => { __machine.simOptions = {}; });
  await p.click('#btnSimConn'); await p.waitForTimeout(50); await p.evaluate(() => __machine.runCut(true)); await p.waitForTimeout(100);
  assert.match(await p.textContent('#conOut'), /SIMULATION complete/); await done(p);
});
test('cut with no machine connected / empty design gives a clear error', async () => {
  const p = await fresh(); await p.evaluate(() => __machine.runCut(false)); await p.waitForTimeout(50);
  assert.match(await p.textContent('#conOut'), /NOT_CONNECTED/);
  await p.evaluate(() => { __machine.autoConfirm = true; document.querySelector('.vtab[data-t="cut"]').click(); }); await p.click('#btnSimConn'); await p.waitForTimeout(50);
  await p.evaluate(() => __machine.runCut(false)); await p.waitForTimeout(50); assert.match(await p.textContent('#conOut'), /JOB_INVALID/); await done(p);
});

/* ---------------- machine panel: real-device paths against a MOCK navigator.usb ---------------- */
test('MOCK USB: connect shows descriptors, never claims/writes; cutting is refused with PROTOCOL_UNKNOWN', async () => {
  const p = await fresh({ mockUsb: true }); await p.shapes5();
  await p.evaluate(() => document.querySelector('.vtab[data-t="cut"]').click()); await p.click('#btnUsbConn'); await p.waitForTimeout(100);
  assert.match(await p.textContent('#cutStatus'), /0x1234:0xabcd/); assert.match(await p.textContent('#cutStatus'), /model not identified/);
  await p.evaluate(() => __machine.runCut(false)); await p.waitForTimeout(100);
  assert.match(await p.textContent('#conOut'), /PROTOCOL_UNKNOWN/);
  await p.evaluate(() => document.querySelector('.vtab[data-t="console"]').click()); await p.fill('#conIn', 'anything'); await p.press('#conIn', 'Enter'); assert.match(await p.textContent('#conOut'), /Raw send is disabled/);
  assert.deepEqual(await p.evaluate(() => window.__usbCalls), { writes: 0, claims: 0 }); assert.deepEqual(p.errors, []); await done(p);
});
test('MOCK USB: dismissed chooser and busy device are reported; can retry', async () => {
  const p = await fresh({ mockUsb: true }); await p.evaluate(() => document.querySelector('.vtab[data-t="cut"]').click());
  await p.evaluate(() => { window.__usbMode = 'dismissed'; }); await p.click('#btnUsbConn'); await p.waitForTimeout(80); assert.match(await p.textContent('#conOut'), /NO_DEVICE_SELECTED/);
  await p.evaluate(() => { window.__usbMode = 'busy'; }); await p.click('#btnUsbConn'); await p.waitForTimeout(80); assert.match(await p.textContent('#conOut'), /OPEN_FAILED/);
  await p.evaluate(() => { window.__usbMode = 'ok'; }); await p.click('#btnUsbConn'); await p.waitForTimeout(80); assert.match(await p.textContent('#cutStatus'), /0x1234/); await done(p);
});
test('no WebUSB in browser: clear message, no crash', async () => {
  const p = await fresh(); await p.evaluate(() => { try { Object.defineProperty(navigator, 'usb', { value: undefined, configurable: true }); } catch (e) { } document.querySelector('.vtab[data-t="cut"]').click(); });
  await p.click('#btnUsbConn'); await p.waitForTimeout(80); assert.match(await p.textContent('#conOut'), /UNSUPPORTED_BROWSER/); assert.deepEqual(p.errors, []); await done(p);
});
