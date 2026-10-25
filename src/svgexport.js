/* ============================================================
   SvgExport (v6) — pure SVG builder for the editor's objects. No DOM.
   Replaces v4's exportSVG body, which silently dropped stars/polygons/lines and
   ignored groups, images, rounded corners, opacity and escaping.
   Coordinates are editor pixels = SVG user units; 96 user units = 1 inch, so the
   width/height attributes can be given in in / mm / px and import at true size.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./textpaths.js'));
  else root.SvgExport = factory(root.TextPaths);
})(typeof self !== 'undefined' ? self : this, function (TP) {
  'use strict';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { v = +v; return isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0'; }
  function paint(o) {
    var a = '';
    a += ' fill="' + esc(o.fill && o.fill !== '' ? o.fill : 'none') + '"';
    if (o.stroke && o.stroke !== 'none' && (o.strokeW === undefined || o.strokeW > 0)) a += ' stroke="' + esc(o.stroke) + '" stroke-width="' + n(o.strokeW || 2) + '"';
    if (o.alpha !== undefined && o.alpha !== null && +o.alpha < 1) a += ' opacity="' + n(o.alpha) + '"';
    return a;
  }
  function pathData(polys) {
    return polys.map(function (pl) {
      return 'M' + pl.points.map(function (p) { return n(p[0]) + ' ' + n(p[1]); }).join(' L') + (pl.closed === false ? '' : ' Z');
    }).join(' ');
  }
  function starPoints(o) {
    var pts = [], i, a, r;
    if (o.type === 'polygon') for (i = 0; i < o.n; i++) { a = 2 * Math.PI / o.n * i - Math.PI / 2; pts.push([o.cx + o.r * Math.cos(a), o.cy + o.r * Math.sin(a)]); }
    else for (i = 0; i < o.n * 2; i++) { r = i % 2 === 0 ? o.r : o.ir; a = Math.PI / o.n * i - Math.PI / 2; pts.push([o.cx + r * Math.cos(a), o.cy + r * Math.sin(a)]); }
    return pts;
  }
  function unionBounds(bs) {
    if (!bs.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    bs.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* objects: editor objects. opts:
       matW, matH (px)        units: 'in' | 'mm' | 'px'      cropToDesign: bool
       selectionIds: ids|null textOutlines: {id: [{points,closed}]} | null   (text -> <path>)
       textFallback(o): SVG string for text without outlines (live <text>)    boundsOf(o): {x,y,w,h}
     returns { svg, warnings, bounds } */
  function build(objects, opts) {
    opts = opts || {};
    var warnings = [], matW = opts.matW || 1152, matH = opts.matH || 1152, units = opts.units || 'in';
    var sel = opts.selectionIds ? opts.selectionIds.reduce(function (m, i) { m[i] = 1; return m; }, {}) : null;
    var list = (objects || []).filter(function (o) { return o && !o.hidden && (!sel || sel[o.id]); });
    var bounds = [], body = [], i = 0;

    function one(o) {
      var s = '', polys, d;
      switch (o.type) {
        case 'rect': {
          var r = Math.min(+o.cornerR || 0, o.w / 2, o.h / 2);
          s = '<rect x="' + n(o.x) + '" y="' + n(o.y) + '" width="' + n(o.w) + '" height="' + n(o.h) + '"' + (r > 0 ? ' rx="' + n(r) + '" ry="' + n(r) + '"' : '') + paint(o) + '/>'; break; }
        case 'ellipse': s = '<ellipse cx="' + n(o.cx) + '" cy="' + n(o.cy) + '" rx="' + n(o.rx) + '" ry="' + n(o.ry) + '"' + paint(o) + '/>'; break;
        case 'star': case 'polygon':
          s = '<polygon points="' + starPoints(o).map(function (p) { return n(p[0]) + ',' + n(p[1]); }).join(' ') + '"' + paint(o) + '/>'; break;
        case 'line': s = '<line x1="' + n(o.x1) + '" y1="' + n(o.y1) + '" x2="' + n(o.x2) + '" y2="' + n(o.y2) + '"' + paint({ fill: 'none', stroke: o.stroke || '#fff', strokeW: o.strokeW, alpha: o.alpha }) + '/>'; break;
        case 'path': s = '<path d="' + pathData(TP.pathObjectPolylines(o)) + '"' + paint(o) + ' fill-rule="nonzero"/>'; break;
        case 'text':
          if (opts.textOutlines && opts.textOutlines[o.id] && opts.textOutlines[o.id].length) {
            var tf = (o.fill && o.fill !== 'none') ? o.fill : (o.stroke && o.stroke !== 'none' ? o.stroke : '#fff');
            s = '<path d="' + pathData(opts.textOutlines[o.id]) + '"' + paint({ fill: tf, stroke: o.stroke, strokeW: o.strokeW, alpha: o.alpha }) + ' fill-rule="nonzero"/>';
          } else if (opts.textFallback) { s = opts.textFallback(o) || ''; if (opts.textOutlines) warnings.push('Text "' + String(o.text || '').slice(0, 20) + '" exported as live text (no font file available to convert it to paths).'); }
          else warnings.push('Text "' + String(o.text || '').slice(0, 20) + '" was skipped.');
          break;
        case 'image':
          if (o.src) s = '<image x="' + n(o.x) + '" y="' + n(o.y) + '" width="' + n(o.w) + '" height="' + n(o.h) + '" href="' + esc(o.src) + '" xlink:href="' + esc(o.src) + '"' + (o.alpha < 1 ? ' opacity="' + n(o.alpha) + '"' : '') + '/>';
          else warnings.push('Image "' + (o.name || 'image') + '" has no source data and was skipped.');
          break;
        default: warnings.push('Object type "' + o.type + '" is not supported by SVG export.');
      }
      return s;
    }

    while (i < list.length) {
      var o = list[i];
      if (o.gid) {                               /* wrap each contiguous run of one group in <g> */
        var j = i, parts = [];
        while (j < list.length && list[j].gid === o.gid) { var e = one(list[j]); if (e) { parts.push('  ' + e); if (opts.boundsOf) bounds.push(opts.boundsOf(list[j])); } j++; }
        if (parts.length) body.push('<g id="group-' + esc(o.gid) + '">\n' + parts.join('\n') + '\n</g>');
        i = j;
      } else {
        var s = one(o); if (s) { body.push(s); if (opts.boundsOf) bounds.push(opts.boundsOf(o)); }
        i++;
      }
    }

    var vb = { x: 0, y: 0, w: matW, h: matH };
    if (opts.cropToDesign && bounds.length) {
      var u = unionBounds(bounds), pad = 2; vb = { x: u.x - pad, y: u.y - pad, w: u.w + 2 * pad, h: u.h + 2 * pad };
    } else if (opts.cropToDesign) warnings.push('Nothing to crop to; exported the full mat area.');
    var f = { in: 1 / 96, mm: 25.4 / 96, px: 1 }[units]; if (!f) f = 1 / 96, units = 'in';
    var wAttr = n(vb.w * f) + (units === 'px' ? '' : units), hAttr = n(vb.h * f) + (units === 'px' ? '' : units);
    var svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + wAttr + '" height="' + hAttr +
      '" viewBox="' + n(vb.x) + ' ' + n(vb.y) + ' ' + n(vb.w) + ' ' + n(vb.h) + '">\n<title>' + esc(opts.title || 'Stick-it-too-Cricut design') + '</title>\n' +
      '<desc>Exported by Stick-it-too-Cricut v6. 96 user units = 1 inch.</desc>\n' + body.join('\n') + '\n</svg>\n';
    return { svg: svg, warnings: warnings, bounds: vb, count: body.length };
  }

  return { build: build, esc: esc };
});
