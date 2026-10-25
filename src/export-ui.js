/* Export dialog + SVG export (v6). Depends on SvgExport, TextPaths, FontLib and editor globals. */
(function () {
  'use strict';
  var SE = window.SvgExport, TP = window.TextPaths, FL = window.FontLib;
  var $ = function (id) { return document.getElementById(id); };
  var DEFAULTS = { format: 'svg', units: 'in', textAsPaths: true, cropToDesign: false, selectionOnly: false };
  var prefs = Object.assign({}, DEFAULTS);
  try { var saved = JSON.parse(localStorage.getItem('sitc_export') || 'null'); if (saved && typeof saved === 'object') ['format', 'units', 'textAsPaths', 'cropToDesign'].forEach(function (k) { if (saved[k] !== undefined) prefs[k] = saved[k]; }); } catch (e) { }
  function savePrefs() { try { localStorage.setItem('sitc_export', JSON.stringify(prefs)); } catch (e) { } }
  function num(v) { v = +v; return isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0'; }

  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }
  /* live <text> for text that cannot be converted (no font file) */
  function fallbackText(o) {
    var f = TP.parseFontString(o.font), col = (o.fill && o.fill !== 'none') ? o.fill : (o.stroke && o.stroke !== 'none' ? o.stroke : '#fff');
    var common = ' font-family="' + SE.esc(f.css.replace(/"/g, "'")) + '" font-size="' + f.size + '"' + (f.bold ? ' font-weight="bold"' : '') + (f.italic ? ' font-style="italic"' : '') +
      ' fill="' + SE.esc(col) + '"' + (o.alpha < 1 ? ' opacity="' + num(o.alpha) + '"' : '');
    if (!textHasEffect(o)) return '<text x="' + num(o.x) + '" y="' + num(o.y) + '"' + common + '>' + SE.esc(o.text || '') + '</text>';
    return '<g' + common + ' text-anchor="middle">' + textGlyphs(o).glyphs.map(function (g) {
      return '<text transform="translate(' + num(g.x) + ' ' + num(g.y) + ') rotate(' + num(g.angle * 180 / Math.PI) + ') scale(' + num(g.sx) + ' ' + num(g.sy) + ')">' + SE.esc(g.ch) + '</text>';
    }).join('') + '</g>';
  }

  /* -> {svg, warnings, bounds, count} */
  function buildSvg(opts) {
    var sel = opts.selectionOnly && selIds.length ? selIds.slice() : null, outlines = null, warn = [];
    var texts = objects.filter(function (o) { return o.type === 'text' && !o.hidden && (!sel || sel.indexOf(o.id) >= 0); });
    var prep = Promise.resolve();
    if (opts.textAsPaths && texts.length) {
      outlines = {};
      prep = Promise.all(texts.map(function (t) {
        return FL.outlineText(t).then(function (r) { outlines[t.id] = r.contours; if (!r.exact) warn.push('"' + String(t.text).slice(0, 14) + '": closest available face used (no separate bold/italic file).'); },
          function (e) { warn.push('"' + String(t.text).slice(0, 14) + '": ' + e.message); });
      }));
    }
    return prep.then(function () {
      var r = SE.build(objects, { matW: matW, matH: matH, units: opts.units, cropToDesign: opts.cropToDesign, selectionIds: sel,
        textOutlines: opts.textAsPaths ? (outlines || {}) : null, textFallback: fallbackText, boundsOf: objBounds, title: 'Stick-it-too-Cricut design' });
      r.warnings = warn.concat(r.warnings.filter(function (w) { return !/exported as live text/.test(w) || !warn.length; }));
      return r;
    });
  }
  /* Replaces v4's exportSVG(); async because text outlines need font data. Resolves to the build result. */
  function exportSVGNow(o) {
    var opts = Object.assign({}, prefs, o || {});
    if (!objects.length) { toast('Nothing to export'); return Promise.resolve(null); }
    return buildSvg(opts).then(function (r) {
      if (!r.count) { toast('Nothing to export (selection empty or all objects hidden)'); return r; }
      download(new Blob([r.svg], { type: 'image/svg+xml' }), 'design.svg');
      r.warnings.forEach(function (w) { if (window.__machine) __machine.log('WARN SVG: ' + w, 'err'); });
      toast('SVG exported' + (r.warnings.length ? ' (' + r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') + ', see Console)' : ''));
      return r;
    }, function (e) { toast('SVG export failed: ' + (e && e.message || e)); throw e; });
  }
  window.exportSVG = exportSVGNow;
  window.buildSvg = buildSvg;

  /* ---------- dialog ---------- */
  function openExportDialog(format) {
    if ($('exportDialog')) return;
    if (format) prefs.format = format;
    var ov = document.createElement('div'); ov.id = 'exportDialog';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:500;backdrop-filter:blur(8px)';
    var hasSel = selIds.length > 0, hasText = objects.some(function (o) { return o.type === 'text'; });
    ov.innerHTML = '<div style="background:var(--bg3);border:1px solid var(--bdr2);border-radius:16px;padding:22px;width:440px;max-width:94vw;color:var(--txt);display:flex;flex-direction:column;gap:12px">' +
      '<div style="font:700 16px var(--ui);color:var(--portal)">Export</div>' +
      '<div style="display:flex;gap:16px"><label><input type="radio" name="expFmt" value="svg"> SVG (vector, for cutting software)</label><label><input type="radio" name="expFmt" value="png"> PNG (picture)</label></div>' +
      '<div id="expSvgOpts" style="display:flex;flex-direction:column;gap:8px;font-size:12px">' +
        '<div class="opt-row"><label for="expUnits">Size units</label><select id="expUnits"><option value="in">inches (12 in mat = 12 in)</option><option value="mm">millimetres</option><option value="px">pixels (96 per inch)</option></select></div>' +
        '<label id="expTextRow"><input type="checkbox" id="expText"> Convert text to paths (recommended for cutting; needs the font file)</label>' +
        '<label><input type="checkbox" id="expCrop"> Crop to the design (otherwise the whole 12×12 mat)</label>' +
        '<label id="expSelRow"><input type="checkbox" id="expSel"> Selected objects only</label>' +
      '</div>' +
      '<div id="expMsg" style="font-size:11px;line-height:1.5;color:var(--dim);min-height:16px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="mbtn" id="expCancel" style="width:auto">Cancel</button><button class="mbtn go" id="expGo" style="width:auto;font-size:14px;padding:10px 22px">Export</button></div></div>';
    document.body.appendChild(ov);
    function q(s) { return ov.querySelector(s); }
    q('input[value="' + prefs.format + '"]').checked = true; q('#expUnits').value = prefs.units; q('#expText').checked = !!prefs.textAsPaths; q('#expCrop').checked = !!prefs.cropToDesign;
    q('#expSel').disabled = !hasSel; q('#expSel').checked = hasSel && !!prefs.selectionOnly; q('#expSelRow').style.opacity = hasSel ? '1' : '.5'; q('#expTextRow').style.opacity = hasText ? '1' : '.5'; q('#expText').disabled = !hasText;
    function sync() { var svg = q('input[name="expFmt"]:checked').value === 'svg'; q('#expSvgOpts').style.display = svg ? 'flex' : 'none'; }
    ov.querySelectorAll('input[name="expFmt"]').forEach(function (r) { r.onchange = sync; }); sync();
    function shut() { ov.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); shut(); } }
    document.addEventListener('keydown', onKey, true);
    q('#expCancel').onclick = shut; ov.onclick = function (e) { if (e.target === ov) shut(); };
    q('#expGo').onclick = function () {
      prefs.format = q('input[name="expFmt"]:checked').value; prefs.units = q('#expUnits').value; prefs.textAsPaths = q('#expText').checked; prefs.cropToDesign = q('#expCrop').checked; prefs.selectionOnly = q('#expSel').checked; savePrefs();
      if (prefs.format === 'png') { shut(); exportPNG(); return; }
      q('#expMsg').textContent = 'Building SVG…'; q('#expGo').disabled = true;
      exportSVGNow(prefs).then(function () { shut(); }, function (e) { q('#expMsg').textContent = 'Export failed: ' + (e && e.message || e); q('#expMsg').style.color = 'var(--red)'; q('#expGo').disabled = false; });
    };
    q('#expGo').focus();
  }
  window.openExportDialog = openExportDialog;

  var conn = $('btnConn');
  if (conn && !$('btnExport')) {
    var b = document.createElement('button'); b.className = 'hbtn'; b.id = 'btnExport'; b.title = 'Export as SVG or PNG (Ctrl+Shift+E)'; b.innerHTML = '&#11015; Export';
    b.onclick = function () { openExportDialog(); }; conn.parentNode.insertBefore(b, conn);
  }
})();
