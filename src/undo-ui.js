/* v6.1: visible Undo / Redo buttons (the v4 undo/redo functions already existed, only reachable by keyboard). */
(function () {
  'use strict';
  var conn = document.getElementById('btnConn');
  if (!conn || document.getElementById('btnUndo')) return;
  function mk(id, label, title, fn) {
    var b = document.createElement('button'); b.className = 'hbtn'; b.id = id; b.title = title; b.textContent = label;
    b.onclick = function () { if (!b.disabled) { fn(); upd(); } }; return b;
  }
  var u = mk('btnUndo', '↶ Undo', 'Undo (Ctrl+Z)', function () { window.undo(); });
  var r = mk('btnRedo', '↷ Redo', 'Redo (Ctrl+Y or Ctrl+Shift+Z)', function () { window.redo(); });
  var ex = document.getElementById('btnExport') || conn;
  ex.parentNode.insertBefore(u, ex); ex.parentNode.insertBefore(r, ex);
  function upd() {
    u.disabled = !(window.undoStack && window.undoStack.length); r.disabled = !(window.redoStack && window.redoStack.length);
    u.style.opacity = u.disabled ? '.4' : ''; r.style.opacity = r.disabled ? '.4' : '';
  }
  setInterval(upd, 250); upd();
  /* Ctrl+Shift+Z = redo (v4 only handled Ctrl+Y). */
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z') && ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(e.target.tagName) < 0) {
      e.preventDefault(); e.stopImmediatePropagation(); window.redo(); upd();
    }
  }, true);
})();
