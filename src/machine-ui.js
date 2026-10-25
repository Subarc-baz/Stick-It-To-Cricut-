/* Machine panel + console wiring (v5). Depends on CricutMachine (machine.js) and the editor globals. */
(function () {
  'use strict';
  var CM = window.CricutMachine, adapter = null, busy = false;
  var $ = function (id) { return document.getElementById(id); };
  var ctrl = window.__machine = {};

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function log(text, cls) {
    var out = $('conOut'); if (!out) return;
    var d = document.createElement('div'); d.className = 'cline ' + (cls || 'sys');
    d.textContent = ($('conTS') && $('conTS').checked ? '[' + new Date().toLocaleTimeString() + '] ' : '') + text;
    out.appendChild(d); if (!$('conAuto') || $('conAuto').checked) out.scrollTop = out.scrollHeight;
  }
  function setStatus(text, on, sim) {
    $('cutStatus').textContent = text; $('cutDot').className = 'dot' + (on ? ' on' : '');
    $('cutDot').style.background = sim && on ? 'var(--amber)' : ''; $('cutDot').style.boxShadow = sim && on ? '0 0 10px var(--amber)' : '';
    var short = !on ? 'Disconnected' : sim ? 'SIMULATED' : 'Device (read-only)';
    if ($('stConnTxt')) $('stConnTxt').textContent = short; if ($('stDot')) $('stDot').className = 'dot' + (on ? ' on' : '');
    var hb = $('btnConn'); if (hb) hb.innerHTML = '<span class="dot' + (on ? ' on' : '') + '"></span> ' + (on ? short : 'Connect');
  }
  function fail(e) {
    var msg = (e && e.message) || String(e);
    log('ERROR [' + ((e && e.code) || 'ERR') + '] ' + msg, 'err'); toast(msg.slice(0, 120)); return e;
  }

  /* ---------- panel markup ---------- */
  var box = $('btnSerialConn') && $('btnSerialConn').parentElement;
  if (!box) return;
  $('btnSerialConn').textContent = 'Select Serial Port (Web Serial)';
  var banner = document.createElement('div');
  banner.id = 'machBanner';
  banner.style.cssText = 'font-size:11px;line-height:1.5;color:var(--amber);border:1px solid var(--amber);border-radius:8px;padding:8px 10px;margin-bottom:10px';
  banner.innerHTML = '<b>Real cutting is not available.</b> No public, verified Cricut Maker 3 job protocol exists, so real devices are discovery-only (read-only). The <b>Simulator</b> exercises the app logic and moves nothing.';
  box.insertBefore(banner, box.children[1]);
  function addBtn(id, label, fn) { var b = document.createElement('button'); b.className = 'mbtn'; b.id = id; b.textContent = label; b.onclick = fn; box.appendChild(b); return b; }
  addBtn('btnUsbConn', 'Connect USB Device (WebUSB)', connectUsb);
  addBtn('btnSimConn', 'Use SIMULATED Machine', connectSim);
  addBtn('btnDisc', 'Disconnect', disconnect);
  addBtn('btnDiag', 'Copy Diagnostics', copyDiag);
  addBtn('btnSvgJob', 'Export Cut Paths (SVG, mm)', exportJobSvg);
  var stages = document.createElement('div'); stages.id = 'machStages'; stages.style.cssText = 'font-size:11px;margin-top:6px'; box.appendChild(stages);

  function renderStages() {
    var icon = { implemented: '✅', partial: '⚠️', simulated: '🧪', unknown: '❓', 'not-implemented': '⛔' };
    stages.innerHTML = '<div style="color:var(--portal);font:700 10px var(--ui);letter-spacing:1.5px;margin-bottom:4px">STAGE STATUS' + (adapter ? (adapter.isSimulation ? ' — SIMULATION' : ' — REAL DEVICE') : '') + '</div>' +
      CM.describeStages(adapter || { isSimulation: false }).map(function (s) {
        return '<div title="' + esc(s.note) + '" style="padding:2px 0;color:var(--txt)">' + icon[s.status] + ' ' + s.n + '. ' + esc(s.name) + ' <span style="color:var(--dim)">(' + s.status + ')</span></div>';
      }).join('');
  }

  /* ---------- connection ---------- */
  function attach(a) {
    adapter = a; ctrl.adapter = a;
    a.on('state', function (s) { if (s === 'disconnected') { setStatus('Not Connected', false); renderStages(); } });
    a.on('lost', function (e) { fail(e); setStatus('Connection lost', false); });
    a.on('rx', function (hex) { log(hex, 'rx'); });
    a.on('progress', function (p) { ctrl.lastProgress = p; });
  }
  function describe(info) {
    if (!info) return '';
    if (info.simulated) return 'SIMULATED device';
    return (info.vendorIdHex || '?') + ':' + (info.productIdHex || '?') + (info.product ? ' "' + info.product + '"' : '') + (info.known ? ' = ' + info.known.model : ' (model not identified)');
  }
  function guard(fn) {
    return function () {
      if (busy) return Promise.resolve();
      busy = true;
      return Promise.resolve().then(fn).catch(fail).then(function () { busy = false; }, function () { busy = false; });
    };
  }
  function swap(newA) {
    var old = adapter; adapter = null;
    return (old ? old.disconnect() : Promise.resolve()).then(function () { attach(newA); });
  }
  function connectSim() {
    return guard(function () {
      return swap(new CM.SimulatedMachine(ctrl.simOptions)).then(function () { return adapter.connect(); }).then(function (info) {
        setStatus('SIMULATED machine connected', true, true); log('SIMULATION: virtual machine connected. No hardware involved.', 'sys'); renderStages();
      });
    })();
  }
  function connectUsb() {
    return guard(function () {
      log('Opening browser USB chooser (read-only probe)...', 'sys');
      return swap(new CM.RealUsbAdapter()).then(function () { return adapter.connect(); }).then(function (info) {
        setStatus('USB device opened (read-only): ' + describe(info), true); log('USB device: ' + JSON.stringify(info), 'rx');
        log('Opened a handle only. No interface was claimed and nothing was sent.', 'sys'); renderStages();
      });
    })().then(function () { if (adapter && !adapter.isConnected()) renderStages(); });
  }
  function connectSerial() {
    return guard(function () {
      log('Opening browser serial chooser (port will NOT be opened)...', 'sys');
      return swap(new CM.RealSerialAdapter()).then(function () { return adapter.connect(); }).then(function (info) {
        setStatus('Serial port selected: ' + describe(info), true); log('Serial port: ' + JSON.stringify(info), 'rx'); renderStages();
      });
    })();
  }
  function disconnect() {
    return guard(function () { if (!adapter) return; var a = adapter; adapter = null; ctrl.adapter = null; return a.disconnect().then(function () { setStatus('Not Connected', false); log('Disconnected.', 'sys'); renderStages(); }); })();
  }
  function copyDiag() {
    var t = CM.diagnosticsText(adapter);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Diagnostics copied'); }, function () { log(t, 'sys'); toast('Clipboard unavailable: diagnostics printed to Console'); });
  }

  /* ---------- job preparation / cutting ---------- */
  function material() {
    var sel = document.querySelector('.mitem.sel');
    return { name: sel ? sel.textContent : null, pressure: $('matP').value, speed: $('matS').value, passes: $('matPa').value, blade: $('matB').value };
  }
  /* async: text objects need font data to become cut outlines */
  function buildJob() {
    var texts = objects.filter(function (o) { return o.type === 'text' && !o.hidden; }), outlines = {};
    return Promise.all(texts.map(function (t) { return window.FontLib.outlineText(t).then(function (r) { outlines[t.id] = r.contours; }, function (e) { log('WARN text "' + String(t.text).slice(0, 14) + '": ' + e.message, 'err'); }); }))
      .then(function () { return CM.prepareJob(objects, { matWidthPx: matW, matHeightPx: matH, material: material(), textOutlines: outlines }); });
  }
  function exportJobSvg() {
    return buildJob().then(function (job) {
      job.warnings.forEach(function (w) { log('WARN ' + w, 'err'); });
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([CM.jobToSVG(job)], { type: 'image/svg+xml' })); a.download = 'cut-paths.svg'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); toast('Cut paths exported (' + job.stats.paths + ' paths)');
      return job;
    }).catch(fail);
  }
  function runCut(testOnly) {
    return guard(function () {
      if (!adapter || !adapter.isConnected()) throw CM.MachineError('NOT_CONNECTED', 'Connect a machine (or the simulator) first.');
      return Promise.resolve(testOnly ? CM.prepareJob([{ id: 0, type: 'rect', x: 96, y: 96, w: 96, h: 96, name: 'Test square' }], { material: material() }) : buildJob()).then(function (job) {
      job.warnings.forEach(function (w) { log('WARN ' + w, 'err'); });
      log('Job prepared: ' + job.stats.paths + ' paths, ' + job.stats.points + ' points, ' + job.stats.lengthMm + ' mm of cut line.', 'sys');
      if (job.outsideMat && !ctrl.autoConfirm) { if (!confirm('Some paths extend beyond the mat. Continue the simulation anyway?')) throw CM.MachineError('CANCELLED', 'Cancelled.'); }
      if (!adapter.isSimulation) return adapter.sendJob(job);   // throws PROTOCOL_UNKNOWN with an explanation
      if (!ctrl.autoConfirm && !confirm('SIMULATION ONLY. Run a simulated cut of ' + job.stats.paths + ' paths? Nothing will move.')) throw CM.MachineError('CANCELLED', 'Cancelled.');
      return adapter.sendJob(job, { timeoutMs: 30000 }).then(function (r) { log(r.message, 'sys'); toast('SIMULATION complete (nothing was cut)'); });
      });
    })();
  }
  ctrl.runCut = runCut; ctrl.buildJob = buildJob; ctrl.connectSim = connectSim; ctrl.connectUsb = connectUsb; ctrl.disconnect = disconnect; ctrl.log = log;

  var go = document.querySelector('.cut-panel .mbtn.go'); if (go) { go.disabled = false; go.title = 'Runs a SIMULATED cut, or explains why real cutting is unavailable'; go.onclick = function () { runCut(false); }; }
  var hb = $('btnCut'); if (hb) { hb.disabled = false; hb.onclick = function () { runCut(false); }; }
  document.querySelectorAll('.cut-panel .mbtn').forEach(function (b) {
    var t = b.textContent.trim();
    if (t === 'Test Cut') b.onclick = function () { runCut(true); };
    if (t === 'Load Mat' || t === 'Unload Mat') b.onclick = function () {
      if (adapter && adapter.isSimulation) log('SIMULATION: ' + t + ' (no motion).', 'sys');
      else log('"' + t + '" needs the unpublished machine protocol and is not available for real hardware.', 'err');
    };
  });
  $('btnSerialConn').onclick = connectSerial;

  /* ---------- console ---------- */
  function sendConsole() {
    var inp = $('conIn'), v = inp.value.trim(); if (!v) return; inp.value = '';
    if (!adapter) { log('Not connected.', 'err'); return; }
    log(v, 'tx');
    if (adapter.isSimulation) log('SIMULATION: command ignored. Raw commands are not part of any verified protocol.', 'rx');
    else log('Raw send is disabled for real hardware: no verified protocol, and unverified data is never sent to a machine.', 'err');
  }
  var sb = document.querySelector('.con-input button'); if (sb) sb.onclick = sendConsole;
  if ($('conIn')) $('conIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendConsole(); });
  var tb = document.querySelector('.con-toolbar');
  if (tb) {
    var lb = document.createElement('button'); lb.className = 'hbtn'; lb.textContent = 'Listen (receive-only)'; lb.id = 'btnListen';
    lb.title = 'Opens the selected serial port and prints received bytes. Never transmits.';
    lb.onclick = guard(function () {
      if (!adapter || !adapter.listen) throw CM.MachineError('NOT_CONNECTED', 'Select a serial port first (Cut tab).');
      return adapter.listen(+$('conBaud').value).then(function () { log('Listening (receive-only) at ' + $('conBaud').value + ' baud.', 'sys'); });
    });
    tb.appendChild(lb);
  }
  if ($('btnConn')) $('btnConn').onclick = function () { var t = document.querySelector('.vtab[data-t="cut"]'); if (t) t.click(); };
  renderStages();
  if (!CM.RealUsbAdapter.supported()) log('WebUSB unavailable in this browser/context.', 'err');
  if (!CM.RealSerialAdapter.supported()) log('Web Serial unavailable in this browser (Brave: enable brave://flags/#brave-web-serial-api).', 'err');
})();
