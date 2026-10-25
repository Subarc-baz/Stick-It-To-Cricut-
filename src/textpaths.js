/* ============================================================
   TextPaths (v6) — pure geometry, no DOM. Turns opentype.js glyph outlines into
   flat polylines, honouring the editor's own per-glyph placement (curve / warp).
   Also: font-string parsing and font-face matching.
   Units: editor pixels (96 per inch).
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextPaths = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'emoji', 'math'];

  /* "italic bold 48px "My Font", sans-serif"  ->  {size, bold, italic, family, familyList} */
  function parseFontString(font) {
    var m = String(font || 'bold 48px sans-serif').match(/^(.*?)\s*(\d+(?:\.\d+)?)px\s+(.+)$/);
    if (!m) return { size: 48, bold: true, italic: false, family: 'sans-serif', css: 'sans-serif', generic: true };
    var style = m[1].trim().split(/\s+/).filter(Boolean);
    var css = m[3].trim(), first = css.split(',')[0].trim().replace(/^["']|["']$/g, '');
    return { size: parseFloat(m[2]) || 48, bold: style.indexOf('bold') >= 0 || style.some(function (s) { return /^[6-9]00$/.test(s); }),
      italic: style.indexOf('italic') >= 0 || style.indexOf('oblique') >= 0, family: first, css: css, generic: GENERIC.indexOf(first.toLowerCase()) >= 0 };
  }
  /* CSS family value for a font name: quoted so names with spaces/digits are legal. */
  function cssFamily(name) { return '"' + String(name).replace(/["\\\n\r]/g, '') + '", sans-serif'; }

  function styleFlags(styleName) {
    var s = String(styleName || '');
    return { bold: /bold|black|heavy|semibold|demibold|extrabold|ultrabold/i.test(s), italic: /italic|oblique/i.test(s) };
  }

  /* Choose the face of `family` that best matches the requested weight/slant.
     faces: [{family, style, bold, italic}] -> {face, exact} | null */
  function matchFace(faces, family, bold, italic) {
    var fam = String(family || '').toLowerCase(), best = null, bestScore = -1;
    faces.forEach(function (f) {
      if (String(f.family).toLowerCase() !== fam) return;
      var sc = 0;
      if (!!f.bold === !!bold) sc += 10; if (!!f.italic === !!italic) sc += 10;
      var st = String(f.style || '').toLowerCase();
      if (st === 'regular' || st === 'bold' || st === 'italic' || st === 'bold italic' || st === 'book' || st === 'roman') sc += 3;
      if (/condensed|narrow|light|thin|extra|semi|demi|black|medium/.test(st)) sc -= 2;
      sc -= Math.min(st.length, 40) / 100;
      if (sc > bestScore) { bestScore = sc; best = f; }
    });
    return best ? { face: best, exact: !!best.bold === !!bold && !!best.italic === !!italic } : null;
  }

  /* ---------- outline flattening ---------- */
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function steps(len) { return Math.max(6, Math.min(64, Math.ceil(len / 1.5))); }
  function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

  /* opentype.js path commands -> [{points:[[x,y]..], closed:true}] */
  function flattenCommands(cmds) {
    var out = [], cur = null, x = 0, y = 0, sx = 0, sy = 0;
    function begin(px, py) { if (cur && cur.points.length > 2) out.push(cur); cur = { points: [[px, py]], closed: true }; sx = x = px; sy = y = py; }
    function finish() {
      if (!cur) return;
      var p = cur.points; if (p.length > 1 && Math.abs(p[0][0] - p[p.length - 1][0]) < 1e-9 && Math.abs(p[0][1] - p[p.length - 1][1]) < 1e-9) p.pop();
      if (p.length > 2) out.push(cur); cur = null;
    }
    (cmds || []).forEach(function (c) {
      var i, n, t, mt, a, b, d;
      switch (c.type) {
        case 'M': finish(); begin(c.x, c.y); break;
        case 'L': if (!cur) begin(x, y); cur.points.push([c.x, c.y]); x = c.x; y = c.y; break;
        case 'Q':
          if (!cur) begin(x, y);
          n = steps(dist(x, y, c.x1, c.y1) + dist(c.x1, c.y1, c.x, c.y));
          for (i = 1; i <= n; i++) { t = i / n; mt = 1 - t; cur.points.push([mt * mt * x + 2 * mt * t * c.x1 + t * t * c.x, mt * mt * y + 2 * mt * t * c.y1 + t * t * c.y]); }
          x = c.x; y = c.y; break;
        case 'C':
          if (!cur) begin(x, y);
          n = steps(dist(x, y, c.x1, c.y1) + dist(c.x1, c.y1, c.x2, c.y2) + dist(c.x2, c.y2, c.x, c.y));
          for (i = 1; i <= n; i++) {
            t = i / n; mt = 1 - t; a = mt * mt * mt; b = 3 * mt * mt * t; d = 3 * mt * t * t;
            cur.points.push([a * x + b * c.x1 + d * c.x2 + t * t * t * c.x, a * y + b * c.y1 + d * c.y2 + t * t * t * c.y]);
          }
          x = c.x; y = c.y; break;
        case 'Z': finish(); x = sx; y = sy; break;
      }
    });
    finish();
    return out;
  }

  /* font: an opentype.js Font. o: {text, x, y}. opts: {size, glyphs}
     measure (optional): width(str) in px from the browser (canvas measureText) for plain text; see below.
     glyphs (optional): the editor's textGlyphs(o).glyphs, [{ch,x,y,angle,sx,sy,width}] —
     when present each glyph is placed exactly as the canvas draws it (centre-aligned,
     scaled, rotated about its baseline point). Otherwise the string is laid out whole,
     left-aligned at (o.x, baseline o.y) with kerning, like canvas fillText. */
  function textContours(font, o, opts) {
    opts = opts || {}; var size = opts.size || 48, out = [];
    if (!opts.glyphs && typeof opts.measure === 'function') {
      /* Place each character where the browser's own shaper puts it (kerning included): the start of char i is
         width(prefix through i) - width(char i). opentype.js 1.3.4 does not apply GPOS kerning, so laying the
         string out with it alone makes pairs like "Ra" wider than the canvas draws them. */
      var str = String(o.text || '');
      for (var i = 0; i < str.length; i++) {
        if (/^\s$/.test(str[i])) continue;
        var gx = o.x + opts.measure(str.slice(0, i + 1)) - opts.measure(str[i]);
        Array.prototype.push.apply(out, flattenCommands(font.getPath(str[i], gx, o.y, size, { kerning: false }).commands));
      }
      return out;
    }
    if (!opts.glyphs) return flattenCommands(font.getPath(String(o.text || ''), o.x, o.y, size, { kerning: true }).commands);
    opts.glyphs.forEach(function (g) {
      if (/^\s$/.test(g.ch)) return;
      var cs = flattenCommands(font.getPath(g.ch, -g.width / 2, 0, size, { kerning: false }).commands);
      var c = Math.cos(g.angle), s = Math.sin(g.angle);
      cs.forEach(function (ct) {
        ct.points = ct.points.map(function (p) { var px = p[0] * g.sx, py = p[1] * g.sy; return [g.x + px * c - py * s, g.y + px * s + py * c]; });
        out.push(ct);
      });
    });
    return out;
  }

  function contoursBounds(contours) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    contours.forEach(function (ct) { ct.points.forEach(function (p) { if (p[0] < b.minX) b.minX = p[0]; if (p[0] > b.maxX) b.maxX = p[0]; if (p[1] < b.minY) b.minY = p[1]; if (p[1] > b.maxY) b.maxY = p[1]; }); });
    return b;
  }

  /* Geometry fields of the editor's `path` object: contours stored relative to the
     bounding-box origin in a (bw x bh) frame, so move = change x/y, resize = change w/h. */
  function makePathGeometry(contours) {
    if (!contours || !contours.length) return null;
    var b = contoursBounds(contours); if (!isFinite(b.minX)) return null;
    var w = Math.max(0.01, b.maxX - b.minX), h = Math.max(0.01, b.maxY - b.minY);
    return { x: r3(b.minX), y: r3(b.minY), w: r3(w), h: r3(h), bw: r3(w), bh: r3(h),
      contours: contours.map(function (ct) { return ct.points.map(function (p) { return [r3(p[0] - b.minX), r3(p[1] - b.minY)]; }); }) };
  }
  /* path object -> absolute-pixel polylines */
  function pathObjectPolylines(o) {
    var fx = o.w / (o.bw || 1), fy = o.h / (o.bh || 1);
    return (o.contours || []).map(function (ct) { return { closed: true, points: ct.map(function (p) { return [o.x + p[0] * fx, o.y + p[1] * fy]; }) }; });
  }

  return { parseFontString: parseFontString, cssFamily: cssFamily, styleFlags: styleFlags, matchFace: matchFace, flattenCommands: flattenCommands,
    textContours: textContours, contoursBounds: contoursBounds, makePathGeometry: makePathGeometry, pathObjectPolylines: pathObjectPolylines, GENERIC: GENERIC };
});
