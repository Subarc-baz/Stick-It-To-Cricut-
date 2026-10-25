/* ============================================================
   FontLib (v6) — system fonts, uploaded fonts, and text -> cut-path conversion.
   - System fonts: Local Font Access API (window.queryLocalFonts). Chromium-family browsers only;
     it asks the user for permission; not verified in Brave. Face data is fetched lazily, only
     when outlines are needed.
   - Uploaded fonts (.ttf .otf .woff): registered with the FontFace API so the canvas can draw
     them, parsed with opentype.js for outlines, and stored in IndexedDB so they survive reloads.
   - Font names/metadata come from files and are untrusted: they are only ever inserted via
     textContent / value, never innerHTML.
   Depends on: opentype (vendor), TextPaths, and editor globals.
   ============================================================ */
(function () {
  'use strict';
  var TP = window.TextPaths, ot = window.opentype;
  var faces = [];                                   // {key,family,style,bold,italic,source,fd?,buffer?,parsed?,fontFace?,filename?}
  var state = { systemSupported: typeof window.queryLocalFonts === 'function', systemLoaded: false };
  var MAX_FILE = 40 * 1024 * 1024;
  var $ = function (id) { return document.getElementById(id); };

  function FontError(code, message) { var e = new Error(message); e.name = 'FontError'; e.code = code; return e; }

  /* ---------- IndexedDB (best effort; private windows may refuse) ---------- */
  function idb(fn) {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('sitc_fonts', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('faces', { keyPath: 'key' }); };
        rq.onerror = function () { res(null); };
        rq.onsuccess = function () { var db = rq.result; try { fn(db, function (v) { try { db.close(); } catch (e) { } res(v); }); } catch (e) { try { db.close(); } catch (e2) { } res(null); } };
      } catch (e) { res(null); }
    });
  }
  function dbPut(rec) { return idb(function (db, done) { var tx = db.transaction('faces', 'readwrite'); tx.objectStore('faces').put(rec); tx.oncomplete = function () { done(true); }; tx.onerror = function () { done(false); }; }); }
  function dbDelete(key) { return idb(function (db, done) { var tx = db.transaction('faces', 'readwrite'); tx.objectStore('faces').delete(key); tx.oncomplete = function () { done(true); }; tx.onerror = function () { done(false); }; }); }
  function dbAll() { return idb(function (db, done) { var rq = db.transaction('faces').objectStore('faces').getAll(); rq.onsuccess = function () { done(rq.result || []); }; rq.onerror = function () { done([]); }; }); }

  /* ---------- parsing ---------- */
  function sniff(buf) {
    var t = String.fromCharCode.apply(null, new Uint8Array(buf, 0, 4));
    if (t === 'wOF2') throw FontError('UNSUPPORTED_FORMAT', 'WOFF2 files cannot be converted to cut paths. Use the .ttf, .otf or .woff version of this font.');
    if (t === 'ttcf') throw FontError('UNSUPPORTED_FORMAT', 'TrueType Collections (.ttc) are not supported. Extract a single .ttf/.otf face from it.');
    return t;
  }
  function parseBuffer(buf) {
    sniff(buf);
    try { return ot.parse(buf); } catch (e) { throw FontError('PARSE_FAILED', 'This file is not a readable font (' + (e && e.message || e) + ').'); }
  }
  function ensureParsed(face) {
    if (face.parsed) return Promise.resolve(face.parsed);
    if (face._p) return face._p;
    face._p = Promise.resolve().then(function () {
      if (face.buffer) return face.buffer;
      if (face.fd && face.fd.blob) return face.fd.blob().then(function (b) { return b.arrayBuffer(); });
      throw FontError('NO_FONT_DATA', 'No font data is available for "' + face.family + '".');
    }).then(function (buf) { face.parsed = parseBuffer(buf); return face.parsed; })
      .catch(function (e) { face._p = null; throw (e && e.name === 'FontError') ? e : FontError('NO_FONT_DATA', 'Could not read the font data for "' + face.family + '": ' + (e && e.message || e)); });
    return face._p;
  }

  /* ---------- system fonts ---------- */
  function loadSystemFonts() {
    if (!state.systemSupported && typeof window.queryLocalFonts === 'function') state.systemSupported = true;
    if (!state.systemSupported) return Promise.reject(FontError('UNSUPPORTED', 'This browser does not provide the Local Font Access API (queryLocalFonts), so installed fonts cannot be listed. Use "Add font file(s)" instead. The API exists in Chromium-based browsers and may be disabled in Brave.'));
    return Promise.resolve().then(function () { return window.queryLocalFonts(); }).then(function (list) {
      faces = faces.filter(function (f) { return f.source !== 'system'; });
      (list || []).forEach(function (fd) {
        var fl = TP.styleFlags(fd.style);
        faces.push({ key: 'system:' + (fd.postscriptName || fd.fullName), family: fd.family, style: fd.style || 'Regular', bold: fl.bold, italic: fl.italic, source: 'system', fd: fd });
      });
      state.systemLoaded = true; try { localStorage.setItem('sitc_sysfonts', '1'); } catch (e) { }
      refreshSelects(); return families('system').length;
    }, function (e) {
      var n = e && e.name;
      if (n === 'NotAllowedError' || n === 'SecurityError') throw FontError('PERMISSION_DENIED', 'Permission to read installed fonts was denied. Allow "Fonts" for this site in the browser\'s site settings, then try again.');
      throw FontError('SYSTEM_FONTS_FAILED', 'Could not list installed fonts: ' + (e && e.message || e));
    });
  }

  /* ---------- uploads ---------- */
  function registerUpload(buf, filename, persist) {
    var font = parseBuffer(buf), nm = font.names || {};
    function pick(o) { return o ? (o.en || o[Object.keys(o)[0]]) : null; }
    var family = pick(nm.fontFamily) || String(filename || 'Uploaded font').replace(/\.[^.]+$/, ''), style = pick(nm.fontSubfamily) || 'Regular';
    var os2 = font.tables && font.tables.os2 || {}, weight = os2.usWeightClass || 400;
    var fl = TP.styleFlags(style); var italic = fl.italic || !!((os2.fsSelection || 0) & 1), bold = fl.bold || weight >= 600;
    var key = 'upload:' + family + '|' + style + '|' + (nm.postScriptName && pick(nm.postScriptName) || '');
    faces = faces.filter(function (f) { if (f.key === key) { if (f.fontFace) document.fonts.delete(f.fontFace); return false; } return true; });
    var ff = new FontFace(family, buf.slice(0), { weight: String(bold ? Math.max(weight, 700) : Math.min(weight, 500)), style: italic ? 'italic' : 'normal' });
    return ff.load().then(function () {
      document.fonts.add(ff);
      var face = { key: key, family: family, style: style, bold: bold, italic: italic, source: 'upload', buffer: buf, parsed: font, fontFace: ff, filename: filename };
      faces.push(face);
      if (persist !== false) dbPut({ key: key, family: family, style: style, bold: bold, italic: italic, filename: filename, buffer: buf });
      return face;
    });
  }
  function addFiles(files) {
    var added = [], errors = [];
    return Array.prototype.reduce.call(files || [], function (p, file) {
      return p.then(function () {
        if (file.size > MAX_FILE) { errors.push(file.name + ': file is larger than 40 MB.'); return; }
        return file.arrayBuffer().then(function (buf) { return registerUpload(buf, file.name, true); })
          .then(function (f) { added.push(f); }, function (e) { errors.push(file.name + ': ' + (e && e.message || e)); });
      });
    }, Promise.resolve()).then(function () { refreshSelects(); return { added: added, errors: errors }; });
  }
  function removeFace(face) {
    if (face.source !== 'upload') return Promise.resolve();
    if (face.fontFace) document.fonts.delete(face.fontFace);
    faces = faces.filter(function (f) { return f !== face; }); refreshSelects();
    return dbDelete(face.key);
  }
  function restore() {
    return dbAll().then(function (recs) {
      return (recs || []).reduce(function (p, r) { return p.then(function () { return registerUpload(r.buffer, r.filename, false).catch(function () { }); }); }, Promise.resolve());
    }).then(function () {
      refreshSelects();
      var want = false; try { want = localStorage.getItem('sitc_sysfonts') === '1'; } catch (e) { }
      if (want && state.systemSupported && navigator.permissions && navigator.permissions.query) {
        return navigator.permissions.query({ name: 'local-fonts' }).then(function (st) { if (st.state === 'granted') return loadSystemFonts(); }).catch(function () { });
      }
    });
  }

  /* ---------- lookup / outlines ---------- */
  function families(source) {
    var m = {}; faces.forEach(function (f) { if (!source || f.source === source) m[f.family] = 1; });
    return Object.keys(m).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  }
  function findFace(fontStr) {
    var f = TP.parseFontString(fontStr);
    if (f.generic) throw FontError('GENERIC_FAMILY', '"' + f.family + '" is a generic family, not a specific font file. Choose a specific font (Fonts…) before converting text to paths.');
    var m = TP.matchFace(faces, f.family, f.bold, f.italic);
    if (!m) throw FontError('NO_FONT_DATA', 'No font data for "' + f.family + '". Use Fonts… to load system fonts or add the font file.');
    return m;
  }
  /* -> {contours:[{points,closed}], exact:bool, face} ; contours in editor pixels */
  function outlineText(o) {
    return Promise.resolve().then(function () {
      var f = TP.parseFontString(o.font), m = findFace(o.font);
      return ensureParsed(m.face).then(function (font) {
        var glyphs = textHasEffect(o) ? textGlyphs(o).glyphs : null;
        var measure = function (str) { ctx.save(); ctx.font = o.font || 'bold 48px sans-serif'; var w = ctx.measureText(str).width; ctx.restore(); return w; };
        return { contours: TP.textContours(font, o, { size: f.size, glyphs: glyphs, measure: measure }), exact: m.exact, face: m.face };
      });
    });
  }

  function convertSelectedTextToShapes() {
    var texts = selectedObjects().filter(function (t) { return t.type === 'text' && !t.locked; });
    if (!texts.length) { toast('Select a text object first'); return Promise.resolve(0); }
    var jobs = texts.map(function (t) { return outlineText(t).then(function (r) { return { t: t, r: r }; }, function (e) { return { t: t, err: e }; }); });
    return Promise.all(jobs).then(function (res) {
      var ok = res.filter(function (x) { return x.r && x.r.contours.length; }), bad = res.filter(function (x) { return !x.r || !x.r.contours.length; });
      if (!ok.length) { var msg = bad[0] && bad[0].err ? bad[0].err.message : 'Nothing to convert (empty text?).'; toast(msg.slice(0, 160)); if (window.__machine) __machine.log('ERROR ' + msg, 'err'); return 0; }
      pushUndo(); var ids = [];
      ok.forEach(function (x) {
        var t = x.t, g = TP.makePathGeometry(x.r.contours), idx = objects.indexOf(t); if (!g || idx < 0) return;
        var po = { id: nextId++, type: 'path', name: 'Shapes: ' + String(t.text || '').slice(0, 15), fill: (t.fill && t.fill !== 'none') ? t.fill : (t.stroke && t.stroke !== 'none' ? t.stroke : '#ffffff'),
          stroke: t.stroke && t.stroke !== 'none' ? t.stroke : 'none', strokeW: t.stroke && t.stroke !== 'none' ? (t.strokeW || 1) : 0, alpha: t.alpha == null ? 1 : t.alpha };
        if (t.gid) po.gid = t.gid;
        Object.assign(po, g); objects[idx] = po; ids.push(po.id);
        if (!x.r.exact) toast('Note: "' + (t.text || '').slice(0, 12) + '" uses a bold/italic style this font family lacks as a separate file; the shapes use the closest face.');
      });
      selectMany(ids); draw();
      toast('Converted ' + ids.length + ' text object' + (ids.length > 1 ? 's' : '') + ' to shapes' + (bad.length ? ' (' + bad.length + ' skipped: ' + (bad[0].err ? bad[0].err.message : 'empty').slice(0, 80) + ')' : ''));
      return ids.length;
    });
  }
  window.convertSelectedTextToShapes = convertSelectedTextToShapes;

  /* ---------- dropdown integration ---------- */
  function refreshSelects() {
    [$('optFont'), $('stTextFont')].forEach(function (sel) {
      if (!sel) return;
      var prev = sel.value;
      Array.prototype.slice.call(sel.querySelectorAll('optgroup[data-fl]')).forEach(function (g) { g.remove(); });
      [['System fonts', 'system'], ['Added fonts', 'upload']].forEach(function (grp) {
        var fam = families(grp[1]); if (!fam.length) return;
        var og = document.createElement('optgroup'); og.label = grp[0] + ' (' + fam.length + ')'; og.setAttribute('data-fl', '1');
        fam.forEach(function (name) { var op = document.createElement('option'); op.value = TP.cssFamily(name); op.textContent = name; og.appendChild(op); });
        sel.appendChild(og);
      });
      if (prev) sel.value = prev;
    });
    document.dispatchEvent(new CustomEvent('fontlib:change'));
  }

  /* ---------- dialog ---------- */
  function openDialog() {
    if ($('fontsDialog')) return;
    var ov = document.createElement('div'); ov.id = 'fontsDialog';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:500;backdrop-filter:blur(8px)';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--bg3);border:1px solid var(--bdr2);border-radius:16px;padding:22px;width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;gap:10px;color:var(--txt)';
    function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
    var h = el('div', 'font:700 16px var(--ui);color:var(--portal)', 'Fonts');
    var status = el('div', 'font-size:12px;line-height:1.5;color:var(--dim);min-height:36px');
    var row = el('div', 'display:flex;gap:8px;flex-wrap:wrap');
    var bSys = el('button', '', 'Load system fonts'); bSys.className = 'mbtn'; bSys.style.width = 'auto'; bSys.id = 'btnLoadSystemFonts';
    var bAdd = el('button', '', 'Add font file(s)…'); bAdd.className = 'mbtn'; bAdd.style.width = 'auto'; bAdd.id = 'btnAddFontFiles';
    var file = document.createElement('input'); file.type = 'file'; file.multiple = true; file.accept = '.ttf,.otf,.woff'; file.style.display = 'none'; file.id = 'fontFileInput';
    var search = document.createElement('input'); search.placeholder = 'Search fonts…'; search.className = 'sinput'; search.style.cssText = 'width:100%'; search.id = 'fontSearch';
    var list = el('div', 'overflow-y:auto;min-height:120px;max-height:40vh;border:1px solid var(--bdr);border-radius:8px;padding:6px'); list.id = 'fontList';
    var note = el('div', 'font-size:10.5px;line-height:1.5;color:var(--dim)', 'Installed fonts need your browser\'s permission (Chromium-based browsers only). Added fonts (.ttf .otf .woff) are stored in this browser. Text can only be converted to cut paths when the font file is available.');
    var close = el('button', '', 'Close'); close.className = 'mbtn'; close.style.width = 'auto'; close.style.alignSelf = 'flex-end';
    row.appendChild(bSys); row.appendChild(bAdd); row.appendChild(file);
    [h, status, row, search, list, note, close].forEach(function (c) { box.appendChild(c); }); ov.appendChild(box); document.body.appendChild(ov);

    function say(msg, bad) { status.textContent = msg; status.style.color = bad ? 'var(--red)' : 'var(--dim)'; }
    function render() {
      var q = search.value.trim().toLowerCase(); list.textContent = '';
      var rows = {}; faces.forEach(function (f) { var k = f.source + '|' + f.family; (rows[k] = rows[k] || { family: f.family, source: f.source, faces: [] }).faces.push(f); });
      var keys = Object.keys(rows).filter(function (k) { return !q || rows[k].family.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return rows[a].family.toLowerCase() < rows[b].family.toLowerCase() ? -1 : 1; }).slice(0, 400);
      if (!keys.length) list.appendChild(el('div', 'color:var(--dim);font-size:12px;padding:8px', faces.length ? 'No matching fonts.' : 'No extra fonts loaded yet.'));
      keys.forEach(function (k) {
        var r = rows[k], line = el('div', 'display:flex;align-items:center;gap:8px;padding:3px 4px');
        var nm = el('span', 'flex:1;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', r.family); nm.style.fontFamily = TP.cssFamily(r.family); nm.title = r.family;
        line.appendChild(nm); line.appendChild(el('span', 'font:10px var(--mono);color:var(--dim)', r.source === 'system' ? 'system · ' + r.faces.length : 'added · ' + r.faces.length));
        if (r.source === 'upload') { var rm = el('button', 'padding:2px 8px', 'Remove'); rm.className = 'hbtn'; rm.onclick = function () { Promise.all(r.faces.map(removeFace)).then(function () { render(); say('Removed ' + r.family + '.'); }); }; line.appendChild(rm); }
        list.appendChild(line);
      });
    }
    function initialStatus() {
      say(state.systemLoaded ? families('system').length + ' system font families loaded.' : state.systemSupported ? 'System fonts not loaded yet. Click "Load system fonts" and allow access when the browser asks.' : 'This browser cannot list installed fonts (no Local Font Access API). You can still add font files.', !state.systemSupported && !state.systemLoaded);
      bSys.disabled = false;
    }
    bSys.onclick = function () { say('Waiting for permission…'); loadSystemFonts().then(function (n) { say(n + ' system font families loaded. Pick them in any Font dropdown.'); render(); }, function (e) { say(e.message, true); }); };
    bAdd.onclick = function () { file.click(); };
    file.onchange = function () { addFiles(file.files).then(function (r) { render(); say((r.added.length ? 'Added ' + r.added.length + ' font file(s). ' : '') + r.errors.join(' '), r.errors.length > 0 && !r.added.length); file.value = ''; }); };
    search.oninput = render;
    function shut() { ov.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); shut(); } }
    document.addEventListener('keydown', onKey, true); close.onclick = shut; ov.onclick = function (e) { if (e.target === ov) shut(); };
    initialStatus(); render(); bSys.focus();
  }

  /* ---------- buttons next to the font dropdowns + convert button in the text panel ---------- */
  function addButtons() {
    [$('optFont'), $('stTextFont')].forEach(function (sel) {
      if (!sel || sel.parentNode.querySelector('.fl-btn')) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'hbtn fl-btn'; b.textContent = 'Fonts…'; b.title = 'Load system fonts or add font files';
      b.style.cssText = 'padding:3px 8px;font-size:11px;flex:none;margin-left:4px'; b.onclick = openDialog; sel.parentNode.insertBefore(b, sel.nextSibling);
    });
    var panel = $('textPropertiesPanel'), body = panel && panel.querySelector('.spanel-body');
    if (body && !$('btnTextToShapes')) {
      var c = document.createElement('button'); c.type = 'button'; c.id = 'btnTextToShapes'; c.className = 'mbtn'; c.textContent = 'Convert text to shapes';
      c.title = 'Turns this text into editable, cuttable outlines (needs the font file: see Fonts…)'; c.style.cssText = 'margin-top:8px;padding:6px;font-size:11px'; c.onclick = convertSelectedTextToShapes; body.appendChild(c);
    }
  }
  /* The Tool Options font dropdown (#optFont) only exists while the Text tool is active, so hook the
     function that rebuilds that panel and re-attach our button + font groups every time. */
  if (typeof updateToolOpts === 'function') {
    var baseUpdateToolOpts = updateToolOpts;
    updateToolOpts = function () { var r = baseUpdateToolOpts.apply(this, arguments); addButtons(); refreshSelects(); return r; };
  }
  addButtons(); refreshSelects(); restore();

  window.FontLib = { faces: function () { return faces; }, state: state, loadSystemFonts: loadSystemFonts, addFiles: addFiles, removeFace: removeFace, outlineText: outlineText, findFace: findFace,
    ensureParsed: ensureParsed, families: families, openDialog: openDialog, restore: restore, convertSelectedTextToShapes: convertSelectedTextToShapes, FontError: FontError };
})();
