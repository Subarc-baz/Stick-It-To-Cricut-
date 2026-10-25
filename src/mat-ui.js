/* v6.1: Mat colour picker (header). Colour is a view setting: it is not saved in projects and never appears in SVG cut files. */
(function () {
  'use strict';
  var conn = document.getElementById('btnConn'); if (!conn || document.getElementById('btnMat')) return;
  var DEFAULT = '#0c0c20', KEY = 'stickit.matColor';
  var PRESETS = [['Dark', '#0c0c20'], ['Charcoal', '#3a3a44'], ['Light gray', '#c8c8cc'], ['White', '#ffffff'], ['Cricut green', '#8fcf8f'], ['Cricut blue', '#8fb8e8'], ['Cream', '#f3ead3']];
  function apply(c, save) { if (typeof setMatColor === 'function' && setMatColor(c)) { if (save) try { localStorage.setItem(KEY, c); } catch (e) { } sync(); return true; } return false; }
  var b = document.createElement('button'); b.className = 'hbtn'; b.id = 'btnMat'; b.title = 'Change the mat colour (display only)'; b.textContent = '▦ Mat';
  var sw = document.createElement('span'); sw.id = 'matSwatch'; sw.style.cssText = 'display:inline-block;width:10px;height:10px;margin-left:6px;border:1px solid #888;border-radius:2px;vertical-align:middle'; b.appendChild(sw);
  var ex = document.getElementById('btnUndo') || document.getElementById('btnExport') || conn; ex.parentNode.insertBefore(b, ex);
  function sync() { sw.style.background = window.matColor || (typeof matColor !== 'undefined' ? matColor : DEFAULT); }
  var pop;
  function close() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); } }
  function outside(e) { if (pop && !pop.contains(e.target) && e.target !== b && !b.contains(e.target)) close(); }
  function esc(e) { if (e.key === 'Escape') close(); }
  b.onclick = function () {
    if (pop) { close(); return; }
    pop = document.createElement('div'); pop.id = 'matPopover';
    var r = b.getBoundingClientRect();
    pop.style.cssText = 'position:fixed;z-index:9999;top:' + (r.bottom + 6) + 'px;left:' + Math.max(8, Math.min(r.left, innerWidth - 236)) + 'px;width:220px;background:#12122a;border:1px solid #2c2c55;border-radius:8px;padding:10px;box-shadow:0 8px 24px #000a;color:#ddd;font-size:12px';
    var t = document.createElement('div'); t.textContent = 'Mat colour (display only)'; t.style.cssText = 'margin-bottom:8px;color:#44ff66;font-weight:600'; pop.appendChild(t);
    var g = document.createElement('div'); g.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px'; pop.appendChild(g);
    PRESETS.forEach(function (p) {
      var s = document.createElement('button'); s.type = 'button'; s.title = p[0]; s.setAttribute('aria-label', 'Mat colour ' + p[0]); s.dataset.color = p[1];
      s.style.cssText = 'width:28px;height:28px;border-radius:6px;border:2px solid #555;cursor:pointer;background:' + p[1]; s.onclick = function () { apply(p[1], true); }; g.appendChild(s);
    });
    var row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px';
    var lab = document.createElement('span'); lab.textContent = 'Custom'; var inp = document.createElement('input'); inp.type = 'color'; inp.id = 'matCustom'; inp.value = (typeof matColor !== 'undefined' ? matColor : DEFAULT);
    inp.oninput = function () { apply(inp.value, true); };
    var rs = document.createElement('button'); rs.type = 'button'; rs.className = 'hbtn'; rs.textContent = 'Reset'; rs.onclick = function () { apply(DEFAULT, true); inp.value = DEFAULT; };
    row.appendChild(lab); row.appendChild(inp); row.appendChild(rs); pop.appendChild(row);
    document.body.appendChild(pop); setTimeout(function () { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
  };
  try { var saved = localStorage.getItem(KEY); if (saved) apply(saved, false); } catch (e) { }
  sync();
})();
