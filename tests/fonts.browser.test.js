// v6 browser tests: fonts, text -> shapes, SVG export dialog. Real Chromium; the Local Font Access API is MOCKED
// (headless Chromium cannot show the permission prompt); uploaded fonts are real files. No Cricut hardware involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FILE = process.env.APP_HTML || path.resolve(__dirname, '..', 'index.html');
const EXE = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const REG = process.env.FONT_TTF || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const BOLD = process.env.FONT_BOLD_TTF || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const skip = fs.existsSync(REG) && fs.existsSync(BOLD) ? false : 'DejaVu fonts not installed (set FONT_TTF / FONT_BOLD_TTF)';
let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] }); });
test.after(async () => { await browser.close(); });

const FAM = '"DejaVu Sans", sans-serif';
const textObj = (o = {}) => Object.assign({ id: 501, type: 'text', x: 200, y: 300, text: 'Hello', fill: '#ff0000', stroke: 'none', strokeW: 0, alpha: 1, font: '64px ' + FAM, name: 'Text: Hello', w: 0, h: 52, curve: 0, warp: 'none' }, o);

async function fresh(init) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  if (init) await page.addInitScript(init.fn, init.arg);
  await page.goto('file://' + FILE); await page.waitForTimeout(250);
  page.errors = errors; page.ctx = ctx; page.box = await page.locator('#cvs').boundingBox();
  page.scr = async (mx, my) => { const t = await page.evaluate(() => [zoom, panX, panY]), bx = await page.locator('#cvs').boundingBox(); return [bx.x + mx * t[0] + t[1], bx.y + my * t[0] + t[2]]; };
  page.addText = (o) => page.evaluate(t => { objects.push(t); nextId = Math.max(nextId, t.id + 1); selectMany([t.id]); draw(); }, textObj(o));
  page.objs = () => page.evaluate(() => JSON.parse(snapshotObjects()));
  page.upload = async (files, keepOpen) => { await page.evaluate(() => { setTool('text'); document.querySelector('#optFont').parentNode.querySelector('.fl-btn').click(); }); await page.setInputFiles('#fontFileInput', files); await page.waitForFunction(() => FontLib.faces().length > 0, null, { timeout: 5000 }).catch(() => { }); await page.waitForTimeout(150); if (!keepOpen) { await page.keyboard.press('Escape'); await page.waitForTimeout(50); } await page.evaluate(() => setTool('select')); };
  return page;
}
const done = p => p.ctx.close();
const b64 = f => fs.readFileSync(f).toString('base64');
// mock Local Font Access API with real font bytes
const SYSTEM_MOCK = { fn: ({ reg, bold, hostile, mode }) => {
  const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const fd = (family, style, ps, data) => ({ family, style, fullName: family + ' ' + style, postscriptName: ps, blob: async () => new Blob([bytes(data)]) });
  window.queryLocalFonts = async () => {
    if (mode === 'denied') { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; }
    const l = [fd('DejaVu Sans', 'Book', 'DejaVuSans', reg), fd('DejaVu Sans', 'Bold', 'DejaVuSans-Bold', bold)];
    if (hostile) l.push(fd(hostile, 'Regular', 'evil', reg)); return l;
  };
}, arg: skip ? {} : { reg: b64(REG), bold: b64(BOLD) } };
const iouJs = `(async (clone) => {
  const t = JSON.parse(JSON.stringify(clone)); t.fill = '#000'; t.stroke = 'none';
  const p = objects.find(o => o.type === 'path'); const pc = JSON.parse(JSON.stringify(p)); pc.fill = '#000'; pc.stroke = 'none';
  const tb = textBounds(t), x0 = Math.min(tb.x, pc.x) - 10, y0 = Math.min(tb.y, pc.y) - 10, w = Math.ceil(Math.max(tb.x + tb.w, pc.x + pc.w) - x0 + 10), h = Math.ceil(Math.max(tb.y + tb.h, pc.y + pc.h) - y0 + 10);
  function render(fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.translate(-x0, -y0); fn(x); return x.getImageData(0, 0, w, h).data; }
  const A = render(x => drawTextObject(x, t)), B = render(x => drawPathObj(x, pc));
  let inter = 0, uni = 0; for (let i = 3; i < A.length; i += 4) { const a = A[i] > 127, b = B[i] > 127; if (a && b) inter++; if (a || b) uni++; }
  return { iou: inter / uni, textBox: tb, pathBox: { x: pc.x, y: pc.y, w: pc.w, h: pc.h } };
})`;

test('upload a real .ttf: appears in both dropdowns (quoted family), survives reload', { skip }, async () => {
  const p = await fresh(); await p.upload(REG);
  assert.equal(await p.evaluate(() => FontLib.faces().length), 1);
  await p.evaluate(() => setTool('text'));   // #optFont only exists while the Text tool is active: groups must be re-attached
  for (const id of ['#optFont', '#stTextFont']) {
    const opt = await p.evaluate(sel => { const o = document.querySelector(sel + ' optgroup[data-fl] option'); return o && [o.value, o.textContent, o.parentNode.label]; }, id);
    assert.deepEqual(opt.slice(0, 2), [FAM, 'DejaVu Sans'], id); assert.match(opt[2], /^Added fonts/);
  }
  assert.ok(await p.evaluate(() => document.fonts.check('20px "DejaVu Sans"')));
  await p.reload(); await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => FontLib.faces().length), 1, 'restored from IndexedDB');
  assert.equal(await p.evaluate(() => FontLib.faces()[0].source), 'upload'); assert.deepEqual(p.errors, []); await done(p);
});
test('bad font files are rejected with a clear message and nothing is registered', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ft-')); const txt = path.join(dir, 'x.ttf'), w2 = path.join(dir, 'y.woff'), c = path.join(dir, 'z.otf');
  fs.writeFileSync(txt, 'this is not a font'); fs.writeFileSync(w2, Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64)])); fs.writeFileSync(c, Buffer.concat([Buffer.from('ttcf'), Buffer.alloc(64)]));
  const p = await fresh(); await p.upload([txt, w2, c], true);
  assert.equal(await p.evaluate(() => FontLib.faces().length), 0); const msg = await p.textContent('#fontsDialog > div > div:nth-child(2)');
  assert.match(msg, /not a readable font/); assert.match(msg, /WOFF2/); assert.match(msg, /Collection/); assert.deepEqual(p.errors, []); await done(p);
});
test('remove an added font: gone from dropdowns and from storage', { skip }, async () => {
  const p = await fresh(); await p.upload(REG, true); await p.click('#fontList button'); await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => FontLib.faces().length), 0); assert.equal(await p.evaluate(() => document.querySelectorAll('#optFont optgroup[data-fl]').length), 0);
  await p.reload(); await p.waitForTimeout(400); assert.equal(await p.evaluate(() => FontLib.faces().length), 0); await done(p);
});

test('SYSTEM FONTS (mocked API): load, list in dropdowns, bold face matched, lazily fetched', { skip }, async () => {
  const p = await fresh(SYSTEM_MOCK); await p.evaluate(() => FontLib.openDialog()); await p.click('#btnLoadSystemFonts'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => FontLib.families('system').join()), 'DejaVu Sans');
  assert.match(await p.textContent('#fontsDialog > div > div:nth-child(2)'), /1 system font families loaded/);
  const g = await p.evaluate(() => { const og = document.querySelector('#stTextFont optgroup[data-fl]'); return og.label + '|' + og.children[0].value; }); assert.equal(g, 'System fonts (1)|' + FAM);
  const m = await p.evaluate(() => { const r = FontLib.findFace('bold 48px "DejaVu Sans", sans-serif'), l = FontLib.findFace('48px "DejaVu Sans", sans-serif'); return [r.face.style, r.exact, l.face.style, l.exact, FontLib.faces().every(f => !f.parsed)]; });
  assert.deepEqual(m, ['Bold', true, 'Book', true, true], 'bold/regular matched; nothing parsed until needed');
  assert.deepEqual(p.errors, []); await done(p);
});
test('SYSTEM FONTS (mocked): permission denied and unsupported browser give clear messages', { skip }, async () => {
  let p = await fresh({ fn: a => { window.queryLocalFonts = async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; }; }, arg: {} });
  await p.evaluate(() => FontLib.openDialog()); await p.click('#btnLoadSystemFonts'); await p.waitForTimeout(150);
  assert.match(await p.textContent('#fontsDialog > div > div:nth-child(2)'), /Permission to read installed fonts was denied/); await done(p);
  p = await fresh(); await p.evaluate(() => { delete window.queryLocalFonts; FontLib.state.systemSupported = false; FontLib.openDialog(); }); await p.click('#btnLoadSystemFonts'); await p.waitForTimeout(100);
  assert.match(await p.textContent('#fontsDialog > div > div:nth-child(2)'), /does not provide the Local Font Access API/); assert.deepEqual(p.errors, []); await done(p);
});
test('hostile font names (HTML in a font\'s family name) are never interpreted as markup', { skip }, async () => {
  const evil = '<img src=x onerror="window.__xss=1">';
  const p = await fresh({ fn: SYSTEM_MOCK.fn, arg: Object.assign({}, SYSTEM_MOCK.arg, { hostile: evil }) });
  await p.evaluate(() => FontLib.openDialog()); await p.click('#btnLoadSystemFonts'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.__xss), undefined); assert.equal(await p.evaluate(() => document.querySelectorAll('#fontList img, #optFont img').length), 0);
  assert.ok(await p.evaluate(e => Array.from(document.querySelectorAll('#stTextFont option')).some(o => o.textContent === e), evil), 'shown as literal text');
  assert.deepEqual(p.errors, []); await done(p);
});
test('REAL queryLocalFonts in headless Chromium (no mock): reported honestly either way', async (t) => {
  const ctx = await browser.newContext(); try { await ctx.grantPermissions(['local-fonts']); } catch (e) { await ctx.close(); return t.skip('Playwright cannot grant local-fonts here: ' + e.message.split('\n')[0]); }
  const page = await ctx.newPage(); await page.goto('file://' + FILE);
  const r = await page.evaluate(async () => { try { const l = await window.queryLocalFonts(); return { n: l.length, sample: l.slice(0, 1).map(f => f.family) }; } catch (e) { return { err: e.name + ': ' + e.message }; } });
  await ctx.close(); if (r.err) return t.skip('real API unavailable in headless: ' + r.err); assert.ok(r.n > 0);
});

test('convert text -> shapes: path object, geometry matches the canvas text (pixel overlap), one undo step', { skip }, async () => {
  const p = await fresh(); await p.upload(REG); await p.addText();
  const before = await p.evaluate(() => JSON.parse(JSON.stringify(objects[0]))), u0 = await p.evaluate(() => undoStack.length);
  assert.equal(await p.evaluate(() => convertSelectedTextToShapes()), 1);
  const o = (await p.objs())[0]; assert.equal(o.type, 'path'); assert.ok(o.contours.length >= 5, 'H e l l o -> at least 5 contours (+ counters)'); assert.equal(o.fill, '#ff0000');
  assert.equal(await p.evaluate(() => undoStack.length), u0 + 1);
  const r = await p.evaluate(iouJs + '(' + JSON.stringify(before) + ')'); assert.ok(r.iou > 0.9, 'pixel overlap with canvas text ' + r.iou.toFixed(3));
  assert.ok(Math.abs(r.textBox.x - r.pathBox.x) < 4 && Math.abs(r.textBox.w - r.pathBox.w) < 5 && Math.abs(r.textBox.h - r.pathBox.h) < 6, JSON.stringify(r));
  await p.evaluate(() => undo()); assert.equal((await p.objs())[0].type, 'text'); await p.evaluate(() => redo()); assert.equal((await p.objs())[0].type, 'path');
  assert.deepEqual(p.errors, []); await done(p);
});
test('outline fidelity at large size: overlap with the canvas text is > 0.97 (no systematic offset)', { skip }, async () => {
  const p = await fresh(); await p.upload(REG); await p.addText({ font: '220px ' + FAM, text: 'Rag', x: 100, y: 500 });
  const before = await p.evaluate(() => JSON.parse(JSON.stringify(objects[0]))); await p.evaluate(() => convertSelectedTextToShapes());
  const r = await p.evaluate(iouJs + '(' + JSON.stringify(before) + ')'); assert.ok(r.iou > 0.97, 'large overlap ' + r.iou.toFixed(4)); await done(p);
});
test('bold text: with the bold file the outline matches; with only the regular file the app says it used the closest face', { skip }, async () => {
  let p = await fresh(); await p.upload([REG, BOLD]); await p.addText({ font: 'bold 64px ' + FAM });
  assert.equal(await p.evaluate(() => FontLib.findFace('bold 64px "DejaVu Sans", sans-serif').exact), true);
  const before = await p.evaluate(() => JSON.parse(JSON.stringify(objects[0]))); await p.evaluate(() => convertSelectedTextToShapes());
  const r = await p.evaluate(iouJs + '(' + JSON.stringify(before) + ')'); assert.ok(r.iou > 0.93, 'bold overlap ' + r.iou.toFixed(3)); await done(p);
  p = await fresh(); await p.upload(REG); await p.addText({ font: 'bold 64px ' + FAM });
  assert.equal(await p.evaluate(() => FontLib.findFace('bold 64px "DejaVu Sans", sans-serif').exact), false);
  await p.evaluate(() => convertSelectedTextToShapes()); assert.match(await p.textContent('.toast:last-of-type'), /closest face|Converted/); assert.equal((await p.objs())[0].type, 'path'); await done(p);
});
test('curve and warp effects are honoured by the outlines (same placement as the canvas)', { skip }, async () => {
  for (const eff of [{ curve: 60 }, { warp: 'arch' }, { warp: 'wave' }, { warp: 'bulge' }]) {
    const p = await fresh(); await p.upload(REG); await p.addText(Object.assign({ text: 'Curve Me', font: '56px ' + FAM }, eff));
    const before = await p.evaluate(() => JSON.parse(JSON.stringify(objects[0]))); await p.evaluate(() => convertSelectedTextToShapes());
    const r = await p.evaluate(iouJs + '(' + JSON.stringify(before) + ')'); assert.ok(r.iou > 0.88, JSON.stringify(eff) + ' overlap ' + r.iou.toFixed(3)); assert.deepEqual(p.errors, []); await done(p);
  }
});
test('path object behaves like any shape: drag, handle-resize, group, copy, align, undo', { skip }, async () => {
  const p = await fresh(); await p.upload(REG); await p.addText(); await p.evaluate(() => convertSelectedTextToShapes());
  const a = (await p.objs())[0];
  await p.evaluate(() => { selectAll(); const o = objects[0]; translateObj(o, 50, 40); });
  const m = (await p.objs())[0]; assert.equal(Math.round(m.x - a.x), 50);
  const [sx, sy] = await p.scr(m.x + m.w / 2, m.y + m.h / 2); await p.evaluate(() => selectMany([objects[0].id]));
  await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(sx + 60, sy + 40, { steps: 4 }); await p.mouse.up();
  const d = (await p.objs())[0]; assert.ok(d.x - m.x > 40 && d.y - m.y > 30, JSON.stringify({ m: [m.x, m.y], d: [d.x, d.y], z: await p.evaluate(() => [zoom, panX, panY, selIds.length, dragging]) }));
  const b = await p.evaluate(() => selectionBounds()), [hx, hy] = await p.scr(b.x + b.w, b.y + b.h);
  await p.mouse.move(hx, hy); await p.mouse.down(); await p.mouse.move(hx + 80, hy + 50, { steps: 4 }); await p.mouse.up();
  const r = (await p.objs())[0]; assert.ok(r.w > d.w + 50 && r.h > d.h + 20 && r.bw === d.bw, 'resized by w/h, contours untouched');
  await p.evaluate(() => { duplicateSelected(); alignObjects('left'); }); assert.equal((await p.objs()).length, 2);
  await p.evaluate(() => { selectAll(); groupSelected(); }); assert.ok((await p.objs()).every(o => o.gid));
  const j = await p.evaluate(async () => { const job = await __machine.buildJob(); return { paths: job.paths.length, bad: job.warnings.length }; }); assert.ok(j.paths >= 10 && j.bad === 0);
  assert.deepEqual(p.errors, []); await done(p);
});
test('conversion refuses cleanly: unknown font, generic family, locked text; nothing changes', { skip }, async () => {
  const p = await fresh(); await p.addText({ font: 'bold 48px "No Such Font", sans-serif' });
  assert.equal(await p.evaluate(() => convertSelectedTextToShapes()), 0); assert.equal((await p.objs())[0].type, 'text');
  assert.match(await p.textContent('.toast:last-of-type'), /No font data for "No Such Font"/);
  await p.evaluate(() => { objects[0].font = 'bold 48px sans-serif'; }); assert.equal(await p.evaluate(() => convertSelectedTextToShapes()), 0);
  assert.match(await p.textContent('#conOut'), /generic family/);
  await p.upload(REG); await p.evaluate(() => { objects[0].font = 'bold 48px ' + '"DejaVu Sans", sans-serif'; objects[0].locked = true; }); assert.equal(await p.evaluate(() => convertSelectedTextToShapes()), 0);
  assert.equal(await p.evaluate(() => undoStack.length), 0, 'no undo entry for failed conversions'); assert.deepEqual(p.errors, []); await done(p);
});
test('cut job and cut-path SVG include text automatically when the font file is known; warn when not', { skip }, async () => {
  const p = await fresh(); await p.upload(REG); await p.addText();
  let j = await p.evaluate(async () => { const job = await __machine.buildJob(); return { paths: job.paths.length, warn: job.warnings.length, len: job.stats.lengthMm }; });
  assert.ok(j.paths >= 5 && j.warn === 0 && j.len > 100, JSON.stringify(j));
  await p.evaluate(() => { objects[0].font = 'bold 48px sans-serif'; }); await p.evaluate(() => __machine.buildJob().then(() => 0, () => 0));
  assert.match(await p.textContent('#conOut'), /WARN text "Hello": .*generic family/); await done(p);
});
test('text panel follows the selection (marquee, delete, multi-select) and has Convert button', { skip }, async () => {
  const p = await fresh(); await p.addText(); const vis = () => p.evaluate(() => document.getElementById('textPropertiesPanel').style.display);
  assert.equal(await vis(), 'block'); await p.evaluate(() => { selectMany([]); }); assert.equal(await vis(), 'none');
  await p.evaluate(() => selectMany([501])); assert.equal(await vis(), 'block');
  await p.evaluate(() => { objects.push({ id: 502, type: 'rect', x: 600, y: 600, w: 50, h: 50, fill: '#fff', stroke: '#fff', strokeW: 1, alpha: 1 }); selectAll(); }); assert.equal(await vis(), 'none', 'multi-selection hides it');
  await p.evaluate(() => { selectMany([501]); deleteSelected(); }); assert.equal(await vis(), 'none');
  assert.ok(await p.evaluate(() => !!document.getElementById('btnTextToShapes'))); assert.deepEqual(p.errors, []); await done(p);
});

/* ---------------- SVG export ---------------- */
const capture = p => p.evaluate(() => { window.__blobs = []; URL.createObjectURL = b => { window.__blobs.push(b); return 'blob:x'; }; });
test('SVG export: text as paths with an added font, live text without, mm units, crop, selection only', { skip }, async () => {
  const p = await fresh(); await p.upload(REG); await p.addText(); await capture(p);
  await p.evaluate(() => { objects.push({ id: 600, type: 'rect', x: 700, y: 700, w: 100, h: 80, fill: '#00f', stroke: '#fff', strokeW: 2, alpha: 1, name: 'R' }); });
  let svg = await p.evaluate(async () => { await exportSVG({ units: 'in', textAsPaths: true, cropToDesign: false, selectionOnly: false }); return await __blobs[0].text(); });
  assert.match(svg, /width="12in" height="12in" viewBox="0 0 1152 1152"/); assert.match(svg, /<path d="M[\d. ]+ L/); assert.ok(!/<text/.test(svg)); assert.match(svg, /fill="#ff0000"/);
  svg = await p.evaluate(async () => { await exportSVG({ units: 'mm', textAsPaths: false, cropToDesign: true, selectionOnly: false }); return await __blobs[1].text(); });
  assert.match(svg, /<text x="200" y="300" font-family="&#39;DejaVu Sans&#39;, sans-serif" font-size="64" fill="#ff0000">Hello<\/text>/); assert.match(svg, /width="[\d.]+mm"/); assert.ok(!/viewBox="0 0 1152/.test(svg));
  svg = await p.evaluate(async () => { selectMany([600]); await exportSVG({ units: 'px', textAsPaths: true, cropToDesign: false, selectionOnly: true }); return await __blobs[2].text(); });
  assert.ok(/<rect/.test(svg) && !/Hello|<path/.test(svg)); assert.deepEqual(p.errors, []); await done(p);
});
test('SVG export: text whose font file is unavailable falls back to live text and logs a warning (not silently dropped)', { skip }, async () => {
  const p = await fresh(); await p.addText({ font: 'bold 40px sans-serif' }); await capture(p);
  const svg = await p.evaluate(async () => { await exportSVG({ units: 'in', textAsPaths: true }); return await __blobs[0].text(); });
  assert.match(svg, /<text [^>]*>Hello<\/text>/); assert.match(await p.textContent('#conOut'), /WARN SVG: "Hello": .*generic family/); await done(p);
});
test('SVG export: curved text without a font file keeps its per-letter placement; group and image survive', { skip }, async () => {
  const p = await fresh(); await p.addText({ font: 'bold 40px sans-serif', curve: 50 }); await capture(p);
  await p.evaluate(() => new Promise(res => { const im = new Image(); im.onload = () => { objects.push({ id: 700, type: 'image', img: im, src: im.src, x: 10, y: 10, w: 20, h: 20, fill: 'none', stroke: 'none', strokeW: 0, alpha: 1, name: 'px' }); res(); };
    im.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='; }));
  await p.evaluate(() => { objects.push({ id: 701, type: 'rect', x: 400, y: 400, w: 50, h: 50, fill: '#fff', stroke: '#000', strokeW: 1, alpha: 1 }); selectMany([700, 701]); groupSelected(); });
  const svg = await p.evaluate(async () => { await exportSVG({ units: 'in', textAsPaths: false }); return await __blobs[0].text(); });
  assert.equal((svg.match(/<text transform=/g) || []).length, 5, 'one <text> per letter'); assert.match(svg, /<g id="group-1">[\s\S]*<image [^>]*href="data:image\/png/); assert.match(svg, /xmlns:xlink/); await done(p);
});
test('Export dialog: opens from header button, Ctrl+Shift+E and context menu; options work; Esc closes; PNG still direct on Ctrl+E', { skip }, async () => {
  const p = await fresh(); await p.upload(REG); await p.keyboard.press('Escape'); await p.addText(); await capture(p);
  await p.click('#btnExport'); assert.ok(await p.isVisible('#exportDialog')); await p.keyboard.press('Escape'); assert.equal(await p.locator('#exportDialog').count(), 0);
  await p.keyboard.press('Control+Shift+E'); assert.ok(await p.isVisible('#exportDialog'));
  assert.equal(await p.isDisabled('#expSel'), false, 'selection exists'); await p.selectOption('#expUnits', 'mm'); await p.check('#expCrop'); await p.click('#expGo'); await p.waitForTimeout(300);
  const svg = await p.evaluate(async () => await __blobs[0].text()); assert.match(svg, /width="[\d.]+mm"/); assert.equal(await p.locator('#exportDialog').count(), 0);
  await p.keyboard.press('Control+Shift+E'); assert.equal(await p.evaluate(() => document.getElementById('expUnits').value), 'mm', 'preferences remembered'); await p.keyboard.press('Escape');
  await p.evaluate(() => selectMany([])); await p.keyboard.press('Control+Shift+E'); assert.ok(await p.isDisabled('#expSel'), 'no selection -> disabled'); await p.keyboard.press('Escape');
  const [x, y] = await p.scr(900, 800); await p.mouse.click(x, y, { button: 'right' }); assert.ok(await p.getByRole('button', { name: /^Export SVG/ }).count() > 0);
  assert.deepEqual(p.errors, []); await done(p);
});
test('exported SVG with text-as-paths renders (in a real browser) the same shape as the canvas text', { skip }, async () => {
  const p = await fresh(); await p.upload(REG); await p.addText(); await capture(p);
  const svg = await p.evaluate(async () => { await exportSVG({ units: 'px', textAsPaths: true }); return await __blobs[0].text(); });
  const r = await p.evaluate(async (s) => {
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); });
    const t = JSON.parse(JSON.stringify(objects[0])); t.fill = '#000'; const w = 1152, h = 1152;
    const A = (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); drawTextObject(x, t); return x.getImageData(0, 0, w, h).data; })();
    const B = (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; })();
    let inter = 0, uni = 0; for (let i = 3; i < A.length; i += 4) { const a = A[i] > 127, b = B[i] > 127 && B[i - 3] > 100; if (a && (B[i] > 127)) inter++; if (a || B[i] > 127) uni++; } return inter / uni; }, svg);
  assert.ok(r > 0.9, 'exported-SVG vs canvas overlap ' + r.toFixed(4)); await done(p);
});
