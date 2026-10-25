// Unit tests: src/textpaths.js + src/svgexport.js (pure code, Node). Uses the real opentype.js and a real TTF.
// Font: DejaVu Sans (set FONT_TTF to use another). Tests that need it skip if it is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const ot = require('../src/vendor/opentype.min.js');
const TP = require('../src/textpaths.js');
const SX = require('../src/svgexport.js');

const FONT = process.env.FONT_TTF || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const have = fs.existsSync(FONT);
const load = () => { const b = fs.readFileSync(FONT); return ot.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const withFont = (name, fn) => test(name, { skip: have ? false : 'font not installed: ' + FONT }, fn);
const bb = cs => TP.contoursBounds(cs);

test('parseFontString handles bold/italic, quotes, lists and generics', () => {
  let f = TP.parseFontString('italic bold 48px "Noto Sans", sans-serif');
  assert.deepEqual([f.size, f.bold, f.italic, f.family, f.generic], [48, true, true, 'Noto Sans', false]);
  f = TP.parseFontString('36px sans-serif'); assert.deepEqual([f.bold, f.italic, f.generic], [false, false, true]);
  f = TP.parseFontString('bold 12.5px Impact'); assert.deepEqual([f.size, f.family], [12.5, 'Impact']);
  f = TP.parseFontString('garbage'); assert.equal(f.size, 48);
});
test('cssFamily quotes names and strips quote/backslash characters', () => {
  assert.equal(TP.cssFamily('Noto Sans'), '"Noto Sans", sans-serif');
  assert.equal(TP.cssFamily('Bad"Name\\'), '"BadName", sans-serif');
});
test('matchFace prefers exact weight/slant, falls back to regular and reports inexact', () => {
  const faces = [{ family: 'Foo', style: 'Regular', bold: false, italic: false }, { family: 'Foo', style: 'Bold', bold: true, italic: false },
    { family: 'Foo', style: 'Light', bold: false, italic: false }, { family: 'Bar', style: 'Regular', bold: false, italic: false }];
  assert.equal(TP.matchFace(faces, 'foo', true, false).face.style, 'Bold');
  assert.equal(TP.matchFace(faces, 'Foo', false, false).face.style, 'Regular');
  const m = TP.matchFace(faces, 'Foo', false, true); assert.equal(m.exact, false);
  assert.equal(TP.matchFace(faces, 'Missing', false, false), null);
});
test('flattenCommands: closed square, curves tessellated, holes kept as separate contours', () => {
  const sq = TP.flattenCommands([{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'L', x: 10, y: 10 }, { type: 'L', x: 0, y: 10 }, { type: 'Z' }]);
  assert.equal(sq.length, 1); assert.equal(sq[0].points.length, 4); assert.ok(sq[0].closed);
  const c = TP.flattenCommands([{ type: 'M', x: 0, y: 0 }, { type: 'C', x1: 0, y1: 20, x2: 20, y2: 20, x: 20, y: 0 }, { type: 'Z' }]);
  assert.ok(c[0].points.length > 6);
  const two = TP.flattenCommands([{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 9, y: 0 }, { type: 'L', x: 9, y: 9 }, { type: 'Z' }, { type: 'M', x: 2, y: 1 }, { type: 'L', x: 3, y: 1 }, { type: 'L', x: 3, y: 2 }, { type: 'Z' }]);
  assert.equal(two.length, 2);
});
withFont('plain text outlines: right size, anchored at the baseline, counters present', () => {
  const f = load(), size = 100;
  const H = TP.textContours(f, { text: 'H', x: 200, y: 300 }, { size });
  const b = bb(H), gb = f.charToGlyph('H').getBoundingBox(), capH = (gb.y2 - gb.y1) / f.unitsPerEm * size;
  assert.ok(Math.abs((b.maxY - b.minY) - capH) < 1.5, 'cap height ' + (b.maxY - b.minY) + ' vs ' + capH);
  assert.ok(Math.abs(b.maxY - 300) < 0.5, 'baseline at o.y'); assert.ok(b.minX > 200 && b.minX < 220, 'left edge near o.x');
  assert.equal(TP.textContours(f, { text: 'O', x: 0, y: 100 }, { size }).length, 2, 'O = outer + counter');
  assert.equal(TP.textContours(f, { text: 'i', x: 0, y: 100 }, { size }).length, 2, 'i = dot + stem');
  assert.equal(TP.textContours(f, { text: '   ', x: 0, y: 0 }, { size }).length, 0);
});
withFont('plain text with a browser-supplied measure: each glyph sits where the shaper puts it (kerning respected)', () => {
  const f = load(), size = 100, adv = s => f.getAdvanceWidth(s, size, { kerning: false });
  const whole = bb(TP.textContours(f, { text: 'Rag', x: 50, y: 200 }, { size }));
  const per = bb(TP.textContours(f, { text: 'Rag', x: 50, y: 200 }, { size, measure: adv }));
  assert.ok(Math.abs(whole.minX - per.minX) < 0.01 && Math.abs(whole.maxX - per.maxX) < 0.01, 'same layout when measure == font advances');
  const kerned = bb(TP.textContours(f, { text: 'Rag', x: 50, y: 200 }, { size, measure: s => adv(s) - 3 * (s.length > 1 ? s.length - 1 : 0) }));
  assert.ok(Math.abs((per.maxX - kerned.maxX) - 6) < 0.01, 'tightening pairs by 3px each moves the last glyph 6px: ' + (per.maxX - kerned.maxX));
  assert.equal(TP.textContours(f, { text: 'a b', x: 0, y: 0 }, { size, measure: adv }).length, TP.textContours(f, { text: 'ab', x: 0, y: 0 }, { size, measure: adv }).length, 'a space adds no outline');
});
withFont('effect glyph placement: glyph centred at (g.x,g.y), rotated and scaled as the canvas does', () => {
  const f = load(), size = 100, wdt = f.getAdvanceWidth('I', size);
  const flat = bb(TP.textContours(f, { text: 'I' }, { size, glyphs: [{ ch: 'I', x: 500, y: 400, angle: 0, sx: 1, sy: 1, width: wdt }] }));
  assert.ok(Math.abs((flat.minX + flat.maxX) / 2 - 500) < 3, 'centred horizontally'); assert.ok(Math.abs(flat.maxY - 400) < 0.5, 'baseline at g.y');
  const rot = bb(TP.textContours(f, { text: 'I' }, { size, glyphs: [{ ch: 'I', x: 500, y: 400, angle: Math.PI / 2, sx: 1, sy: 1, width: wdt }] }));
  assert.ok((rot.maxX - rot.minX) > (flat.maxX - flat.minX) * 3, 'rotated 90 deg: tall stem becomes wide');
  const wide = bb(TP.textContours(f, { text: 'I' }, { size, glyphs: [{ ch: 'I', x: 500, y: 400, angle: 0, sx: 2, sy: 1, width: wdt }] }));
  assert.ok(Math.abs((wide.maxX - wide.minX) - 2 * (flat.maxX - flat.minX)) < 1);
});
test('path geometry: relative contours, move = x/y, resize = w/h, round-trip to pixels', () => {
  const g = TP.makePathGeometry([{ points: [[100, 50], [200, 50], [200, 90]], closed: true }]);
  assert.deepEqual([g.x, g.y, g.w, g.h, g.bw, g.bh], [100, 50, 100, 40, 100, 40]); assert.deepEqual(g.contours[0][0], [0, 0]);
  const o = Object.assign({ type: 'path' }, g, { x: 10, y: 20, w: 200 });                 // moved and stretched 2x horizontally
  const px = TP.pathObjectPolylines(o)[0].points; assert.deepEqual(px[1], [210, 20]); assert.deepEqual(px[2], [210, 60]);
  assert.equal(TP.makePathGeometry([]), null);
});

/* ---------------- svgexport ---------------- */
const objs = () => [
  { id: 1, type: 'rect', x: 10, y: 20, w: 100, h: 50, cornerR: 8, fill: '#ff0000', stroke: '#000', strokeW: 2, alpha: 0.5, name: 'R' },
  { id: 2, type: 'ellipse', cx: 300, cy: 100, rx: 40, ry: 20, fill: 'none', stroke: '#fff', strokeW: 1, alpha: 1 },
  { id: 3, type: 'star', cx: 500, cy: 100, r: 40, ir: 16, n: 5, fill: '#ff0', stroke: '#000', strokeW: 1 },
  { id: 4, type: 'polygon', cx: 600, cy: 100, r: 30, n: 6, fill: '#0f0', stroke: 'none' },
  { id: 5, type: 'line', x1: 0, y1: 0, x2: 50, y2: 50, stroke: '#00f', strokeW: 3 },
  { id: 6, type: 'rect', x: 0, y: 0, w: 5, h: 5, hidden: true, fill: '#000' }];
const bnds = o => (o.type === 'ellipse' ? { x: o.cx - o.rx, y: o.cy - o.ry, w: o.rx * 2, h: o.ry * 2 } : { x: o.x || 0, y: o.y || 0, w: o.w || 50, h: o.h || 50 });
test('SVG: every shape type, hidden skipped, opacity, rounded corners, in-units size', () => {
  const r = SX.build(objs(), { matW: 1152, matH: 1152, units: 'in' });
  assert.match(r.svg, /width="12in" height="12in" viewBox="0 0 1152 1152"/);
  for (const t of ['<rect', '<ellipse', '<polygon', '<line']) assert.ok(r.svg.includes(t), t);
  assert.equal((r.svg.match(/<polygon/g) || []).length, 2); assert.ok(!r.svg.includes('hidden')); assert.match(r.svg, /rx="8"/); assert.match(r.svg, /opacity="0.5"/);
  assert.match(r.svg, /<ellipse[^>]*fill="none"[^>]*stroke="#fff"/);
});
test('SVG: mm and px units', () => {
  assert.match(SX.build(objs(), { matW: 1152, matH: 1152, units: 'mm' }).svg, /width="304.8mm"/);
  assert.match(SX.build(objs(), { matW: 1152, matH: 1152, units: 'px' }).svg, /width="1152" height="1152"/);
  assert.match(SX.build(objs(), { units: 'bogus' }).svg, /in"/);
});
test('SVG: contiguous group members are wrapped in <g>, non-members are not', () => {
  const o = objs(); o[1].gid = 7; o[2].gid = 7;
  const s = SX.build(o, {}).svg; assert.match(s, /<g id="group-7">[\s\S]*<ellipse[\s\S]*<polygon[\s\S]*<\/g>/);
  assert.equal((s.match(/<g /g) || []).length, 1);
});
test('SVG: selection only, and crop to design', () => {
  const s = SX.build(objs(), { selectionIds: [1], cropToDesign: true, boundsOf: bnds, units: 'px' });
  assert.equal(s.count, 1); assert.match(s.svg, /viewBox="8 18 104 54"/);
  assert.ok(SX.build([], { cropToDesign: true, boundsOf: bnds }).warnings.length === 1);
});
test('SVG: XML special characters are escaped everywhere (names, colours, text, image src)', () => {
  const o = [{ id: 1, type: 'rect', x: 0, y: 0, w: 5, h: 5, fill: 'red" onload="x', stroke: 'none' },
    { id: 2, type: 'text', text: 'a<b>&"c', x: 0, y: 0, font: '20px x' },
    { id: 3, type: 'image', x: 0, y: 0, w: 5, h: 5, src: 'data:image/png;base64,AA"><script>' }];
  const s = SX.build(o, { textFallback: t => '<text>' + SX.esc(t.text) + '</text>', title: 'T<&>' }).svg;
  assert.ok(!/<script>/.test(s)); assert.ok(!/fill="red" onload/.test(s)); assert.match(s, /a&lt;b&gt;&amp;&quot;c/); assert.match(s, /<title>T&lt;&amp;&gt;<\/title>/);
});
test('SVG: text becomes <path> when outlines exist, live text otherwise (with a warning), images embed data', () => {
  const t = { id: 9, type: 'text', text: 'Hi', x: 0, y: 0, font: '20px x', fill: '#abc' };
  const withOut = SX.build([t], { textOutlines: { 9: [{ points: [[0, 0], [10, 0], [10, 10]], closed: true }] }, textFallback: () => '<text>Hi</text>' });
  assert.match(withOut.svg, /<path d="M0 0 L10 0 L10 10 Z"[^>]*fill="#abc"/); assert.equal(withOut.warnings.length, 0);
  const noOut = SX.build([t], { textOutlines: {}, textFallback: () => '<text>Hi</text>' });
  assert.match(noOut.svg, /<text>Hi<\/text>/); assert.equal(noOut.warnings.length, 1);
  assert.match(SX.build([{ id: 1, type: 'image', x: 0, y: 0, w: 5, h: 5, src: 'data:image/png;base64,AAAA' }], {}).svg, /<image [^>]*href="data:image\/png;base64,AAAA"/);
  assert.equal(SX.build([{ id: 1, type: 'image', x: 0, y: 0, w: 5, h: 5 }], {}).warnings.length, 1);
});
test('SVG: path objects export their contours at the current size/position', () => {
  const p = Object.assign({ id: 1, type: 'path', fill: '#123', stroke: 'none', alpha: 1 }, TP.makePathGeometry([{ points: [[0, 0], [10, 0], [10, 10]], closed: true }]));
  p.x = 100; p.y = 100; p.w *= 2;
  assert.match(SX.build([p], {}).svg, /d="M100 100 L120 100 L120 110 Z"/);
});
test('SVG output is well-formed XML (xmllint) for a mixed design', { skip: spawnSync('xmllint', ['--version']).error ? 'xmllint not installed' : false }, () => {
  const o = objs(); o[1].gid = 3; o[2].gid = 3;
  const s = SX.build(o, { textFallback: () => '' }).svg; fs.writeFileSync(process.env.TMPDIR ? process.env.TMPDIR + '/t.svg' : '/tmp/sitc-test.svg', s);
  execFileSync('xmllint', ['--noout', process.env.TMPDIR ? process.env.TMPDIR + '/t.svg' : '/tmp/sitc-test.svg']);
});
