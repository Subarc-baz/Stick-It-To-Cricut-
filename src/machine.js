/* ============================================================
   CricutMachine — hardware abstraction layer (v5)

   HONEST STATUS (see docs/RESEARCH.md for sources)
   - No public, verified protocol exists for sending cut jobs to a stock
     Cricut Maker 3. Research found: the original Maker's stock protocol is
     reported encrypted (leHACK 2023 slides); open-source work (cutcutgo) replaces
     firmware on the ORIGINAL Maker only; slicebug reuses Windows Design Space
     components and was tested only on the original Maker.
   - Therefore this layer implements only what can be verified:
       1 detect / 2 identify (descriptor read-only) / 3 connect (no claim, no I/O)
       5 prepare a job (neutral geometry, fully tested)
     and a clearly-labelled SIMULATOR for the application logic.
   - Real adapters NEVER write to the device. sendJob() on real hardware throws
     PROTOCOL_UNKNOWN. Nothing here invents commands, handshakes or formats.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CricutMachine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PX_PER_IN = 96, MM_PER_IN = 25.4;
  var MAX_POINTS = 200000;

  /* ---------- errors ---------- */
  function MachineError(code, message, detail) {
    var e = new Error(message); e.name = 'MachineError'; e.code = code; e.detail = detail; return e;
  }
  var CODES = ['UNSUPPORTED_BROWSER', 'NO_DEVICE_SELECTED', 'PERMISSION_DENIED', 'OPEN_FAILED', 'DISCONNECTED',
    'TIMEOUT', 'PROTOCOL_UNKNOWN', 'JOB_INVALID', 'JOB_TOO_LARGE', 'NOT_CONNECTED', 'CANCELLED', 'SIMULATED_FAULT'];

  /* map DOMException / browser errors from WebUSB & Web Serial to our codes */
  function classifyBrowserError(err, fallback) {
    var n = err && err.name, m = (err && err.message) || String(err);
    if (n === 'NotFoundError') return MachineError('NO_DEVICE_SELECTED', 'No device was selected (chooser dismissed or no matching device).', m);
    if (n === 'SecurityError' || n === 'NotAllowedError') return MachineError('PERMISSION_DENIED', 'Permission denied by the browser or the operating system. On Linux this is usually a missing udev rule. See README > Linux access.', m);
    if (n === 'NetworkError' || n === 'InvalidStateError') return MachineError('OPEN_FAILED', 'The device could not be opened (busy, claimed by another driver/program, or unplugged). Close Design Space/other tools and retry.', m);
    return MachineError(fallback || 'OPEN_FAILED', m, m);
  }

  function withTimeout(promise, ms, what) {
    var t;
    var timer = new Promise(function (_, rej) { t = setTimeout(function () { rej(MachineError('TIMEOUT', (what || 'Operation') + ' timed out after ' + ms + ' ms.')); }, ms); });
    return Promise.race([promise, timer]).then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
  }

  /* ---------- tiny event emitter ---------- */
  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; };
  Emitter.prototype.emit = function (ev, a) { (this._h[ev] || []).forEach(function (f) { try { f(a); } catch (e) { /* listener errors must not break the machine */ } }); };

  /* ============================================================
     JOB PREPARATION  (stage 5) — pure geometry, no device I/O
     Input : the editor's `objects` array (pixels @96dpi), mat size, material settings
     Output: { units:'mm', mat:{w,h}, material, paths:[{id,name,closed,points:[[x,y]..]}], warnings:[], stats }
     ============================================================ */
  function pxToMm(v) { return v / PX_PER_IN * MM_PER_IN; }

  function arcPoints(cx, cy, rx, ry, a0, a1, n) {
    var pts = []; for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return pts;
  }
  function objectToPolylines(o, warnings, opts) {
    var P = [];
    function poly(points, closed) { P.push({ points: points, closed: closed }); }
    switch (o.type) {
      case 'rect': {
        var r = Math.min(o.cornerR || 0, o.w / 2, o.h / 2);
        if (r > 0) {
          var p = [].concat(
            arcPoints(o.x + o.w - r, o.y + r, r, r, -Math.PI / 2, 0, 8),
            arcPoints(o.x + o.w - r, o.y + o.h - r, r, r, 0, Math.PI / 2, 8),
            arcPoints(o.x + r, o.y + o.h - r, r, r, Math.PI / 2, Math.PI, 8),
            arcPoints(o.x + r, o.y + r, r, r, Math.PI, Math.PI * 1.5, 8));
          poly(p, true);
        } else poly([[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]], true);
        break; }
      case 'ellipse': {
        var rx = o.rx || 1, ry = o.ry || 1, n = Math.max(32, Math.min(256, Math.ceil(Math.max(rx, ry) / 2)));
        var pts = []; for (var i = 0; i < n; i++) { var a = 2 * Math.PI * i / n; pts.push([o.cx + rx * Math.cos(a), o.cy + ry * Math.sin(a)]); }
        poly(pts, true); break; }
      case 'polygon': {
        var pp = []; for (var k = 0; k < o.n; k++) { var aa = 2 * Math.PI / o.n * k - Math.PI / 2; pp.push([o.cx + o.r * Math.cos(aa), o.cy + o.r * Math.sin(aa)]); }
        poly(pp, true); break; }
      case 'star': {
        var sp = []; for (var j = 0; j < o.n * 2; j++) { var rr = j % 2 === 0 ? o.r : o.ir, ab = Math.PI / o.n * j - Math.PI / 2; sp.push([o.cx + rr * Math.cos(ab), o.cy + rr * Math.sin(ab)]); }
        poly(sp, true); break; }
      case 'line': poly([[o.x1, o.y1], [o.x2, o.y2]], false); break;
      case 'path': (o.contours || []).forEach(function (ct) { poly(ct.map(function (p) { return [o.x + p[0] * o.w / (o.bw || 1), o.y + p[1] * o.h / (o.bh || 1)]; }), true); }); break;
      case 'text': {
        var tp = opts && opts.textOutlines && opts.textOutlines[o.id];
        if (tp && tp.length) tp.forEach(function (c) { poly(c.points, c.closed !== false); });
        else warnings.push('Text "' + String(o.text || '').slice(0, 20) + '" was skipped: its font file is not available to build outlines. Open Fonts\u2026 and load/add the font, or use Convert Text to Shapes.');
        break; }
      case 'image': warnings.push('Image "' + (o.name || 'image') + '" was skipped: raster images are not cut paths (trace to vector first).'); break;
      default: warnings.push('Object of unknown type "' + o.type + '" was skipped.');
    }
    return P;
  }

  function prepareJob(objects, opts) {
    opts = opts || {};
    var matW = opts.matWidthPx || 12 * PX_PER_IN, matH = opts.matHeightPx || 12 * PX_PER_IN;
    var warnings = [], paths = [], total = 0, lengthMm = 0;
    if (!Array.isArray(objects)) throw MachineError('JOB_INVALID', 'Design is not a list of objects.');
    objects.forEach(function (o) {
      if (!o || o.hidden) return;
      var polys = objectToPolylines(o, warnings, opts);
      polys.forEach(function (pl) {
        var pts = pl.points.map(function (p) { return [pxToMm(p[0]), pxToMm(p[1])]; });
        for (var i = 0; i < pts.length; i++) {
          if (!isFinite(pts[i][0]) || !isFinite(pts[i][1])) throw MachineError('JOB_INVALID', 'Object "' + (o.name || o.type) + '" has non-finite coordinates.');
        }
        total += pts.length;
        if (total > MAX_POINTS) throw MachineError('JOB_TOO_LARGE', 'Job exceeds ' + MAX_POINTS + ' points.');
        var segs = pl.closed ? pts.length : pts.length - 1;
        for (var s = 0; s < segs; s++) { var a = pts[s], b = pts[(s + 1) % pts.length]; lengthMm += Math.hypot(b[0] - a[0], b[1] - a[1]); }
        paths.push({ id: o.id, name: o.name || o.type, gid: o.gid || null, closed: pl.closed, points: pts });
      });
    });
    if (!paths.length) throw MachineError('JOB_INVALID', 'Nothing to cut: the design has no visible cut paths.', warnings);
    var mm = { w: pxToMm(matW), h: pxToMm(matH) };
    var bb = bounds(paths);
    var outside = bb.minX < -0.01 || bb.minY < -0.01 || bb.maxX > mm.w + 0.01 || bb.maxY > mm.h + 0.01;
    if (outside) warnings.push('Some paths extend beyond the ' + (mm.w / MM_PER_IN).toFixed(0) + 'x' + (mm.h / MM_PER_IN).toFixed(0) + ' in mat.');
    var m = opts.material || {};
    return {
      units: 'mm', mat: mm, outsideMat: outside,
      material: { name: m.name || null, pressure: num(m.pressure, 175), speed: num(m.speed, 4), passes: Math.max(1, Math.min(10, num(m.passes, 1))), blade: m.blade || 'fine' },
      paths: paths, warnings: warnings, bounds: bb,
      stats: { paths: paths.length, points: total, lengthMm: Math.round(lengthMm * 100) / 100 }
    };
  }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function bounds(paths) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    paths.forEach(function (p) { p.points.forEach(function (q) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }); });
    return b;
  }
  function validateJob(job) {
    if (!job || job.units !== 'mm' || !Array.isArray(job.paths) || !job.paths.length) throw MachineError('JOB_INVALID', 'Job is empty or malformed.');
    job.paths.forEach(function (p) {
      if (!Array.isArray(p.points) || p.points.length < 2) throw MachineError('JOB_INVALID', 'A path has fewer than 2 points.');
      p.points.forEach(function (q) { if (!isFinite(q[0]) || !isFinite(q[1])) throw MachineError('JOB_INVALID', 'A path has non-finite coordinates.'); });
    });
    return true;
  }
  /* Neutral interchange: lets the user cut with ANY other tool; not a Cricut format. */
  function jobToSVG(job) {
    var d = job.paths.map(function (p) {
      return 'M' + p.points.map(function (q) { return q[0].toFixed(3) + ' ' + q[1].toFixed(3); }).join(' L') + (p.closed ? ' Z' : '');
    }).join(' ');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + job.mat.w.toFixed(2) + 'mm" height="' + job.mat.h.toFixed(2) + 'mm" viewBox="0 0 ' +
      job.mat.w.toFixed(3) + ' ' + job.mat.h.toFixed(3) + '">\n<path d="' + d + '" fill="none" stroke="#000" stroke-width="0.1"/>\n</svg>\n';
  }

  /* ============================================================
     STAGES — what is real, per adapter
     ============================================================ */
  var STAGE_NAMES = ['Detect device', 'Identify model / connection', 'Establish connection', 'Initialise & read state',
    'Prepare cutting job', 'Transfer job', 'Acknowledgements / status', 'Execute cut'];
  function describeStages(adapter) {
    var sim = adapter && adapter.isSimulation, real = adapter && !adapter.isSimulation;
    var S = function (status, note) { return { status: status, note: note }; };
    var r = [];
    r.push(S(sim ? 'simulated' : 'implemented', sim ? 'Simulated device.' : 'WebUSB / Web Serial chooser; read-only.'));
    r.push(S(sim ? 'simulated' : 'partial', sim ? 'Simulated.' : 'Reports USB descriptors. No verified Maker 3 ID table exists, so the model is not auto-identified.'));
    r.push(S(sim ? 'simulated' : 'implemented', sim ? 'Simulated.' : 'Opens a handle only. No interface claim, no transfers.'));
    r.push(S(sim ? 'simulated' : 'unknown', sim ? 'Simulated.' : 'Requires the unpublished protocol.'));
    r.push(S('implemented', 'Geometry to millimetre paths. Unit tested. Not a Cricut format.'));
    r.push(S(sim ? 'simulated' : 'not-implemented', sim ? 'Simulated chunked transfer.' : 'No verified protocol; blocked on purpose.'));
    r.push(S(sim ? 'simulated' : 'not-implemented', sim ? 'Simulated progress events.' : 'No verified protocol.'));
    r.push(S(sim ? 'simulated' : 'not-implemented', sim ? 'Simulated only. Nothing moves.' : 'Never attempted without a verified protocol and explicit user authorisation.'));
    return r.map(function (x, i) { x.n = i + 1; x.name = STAGE_NAMES[i]; return x; });
  }

  /* ============================================================
     ADAPTERS
     ============================================================ */
  function BaseAdapter() { Emitter.call(this); this.state = 'disconnected'; this.info = null; }
  BaseAdapter.prototype = Object.create(Emitter.prototype);
  BaseAdapter.prototype._set = function (s) { this.state = s; this.emit('state', s); };
  BaseAdapter.prototype.isConnected = function () { return this.state === 'connected'; };

  /* ----- Simulator: exercises the application logic. Labelled everywhere. ----- */
  function SimulatedMachine(opts) {
    BaseAdapter.call(this); opts = opts || {};
    this.isSimulation = true; this.label = 'SIMULATED Cricut Maker 3 (no hardware)';
    this.latency = opts.latencyMs == null ? 0 : opts.latencyMs;
    this.fail = opts.fail || null;          // 'connect' | 'transfer' | 'cut' | 'timeout' | 'disconnect'
    this.chunk = opts.chunkPoints || 500;
    this._cancel = false; this.jobsReceived = 0;
  }
  SimulatedMachine.prototype = Object.create(BaseAdapter.prototype);
  SimulatedMachine.prototype._wait = function () { var ms = this.latency; return new Promise(function (r) { setTimeout(r, ms); }); };
  SimulatedMachine.prototype.connect = function () {
    var self = this;
    if (this.fail === 'connect') return Promise.reject(MachineError('OPEN_FAILED', 'Simulated connection failure.'));
    return this._wait().then(function () { self.info = { simulated: true, model: 'Simulated Maker 3', vendorId: null, productId: null }; self._set('connected'); return self.info; });
  };
  SimulatedMachine.prototype.disconnect = function () { this._set('disconnected'); return Promise.resolve(); };
  SimulatedMachine.prototype.cancel = function () { this._cancel = true; };
  SimulatedMachine.prototype.sendJob = function (job, opts) {
    var self = this; opts = opts || {};
    if (!this.isConnected()) return Promise.reject(MachineError('NOT_CONNECTED', 'Simulated machine is not connected.'));
    try { validateJob(job); } catch (e) { return Promise.reject(e); }
    this._cancel = false;
    var total = job.paths.reduce(function (n, p) { return n + p.points.length; }, 0), sent = 0;
    var run = new Promise(function (resolve, reject) {
      function step() {
        if (self._cancel) return reject(MachineError('CANCELLED', 'Simulated job cancelled.'));
        if (self.fail === 'disconnect' && sent > 0) { self._set('disconnected'); return reject(MachineError('DISCONNECTED', 'Simulated cable pulled mid-transfer.')); }
        if (self.fail === 'transfer' && sent > 0) return reject(MachineError('SIMULATED_FAULT', 'Simulated transfer failure.'));
        if (self.fail === 'timeout') return; // never resolves -> exercised via withTimeout
        sent = Math.min(total, sent + self.chunk);
        self.emit('progress', { stage: 'transfer', sent: sent, total: total, simulated: true });
        if (sent < total) return setTimeout(step, self.latency);
        if (self.fail === 'cut') return reject(MachineError('SIMULATED_FAULT', 'Simulated cut failure (e.g. blade/mat fault).'));
        self.jobsReceived++;
        resolve({ simulated: true, stats: job.stats, message: 'SIMULATION complete. No hardware was involved and nothing was cut.' });
      }
      setTimeout(step, self.latency);
    });
    return opts.timeoutMs ? withTimeout(run, opts.timeoutMs, 'Simulated job') : run;
  };

  /* ----- Real hardware: read-only probes ----- */
  var KNOWN = [];   // intentionally empty: no verified Cricut Maker 3 IDs were found in primary sources
  function registerKnownDevice(d) { KNOWN.push({ vendorId: d.vendorId, productId: d.productId, model: d.model, verified: !!d.verified, source: d.source || 'user' }); }
  function identify(vid, pid) { for (var i = 0; i < KNOWN.length; i++) if (KNOWN[i].vendorId === vid && KNOWN[i].productId === pid) return KNOWN[i]; return null; }
  function hex4(n) { return n == null ? null : '0x' + ('0000' + n.toString(16)).slice(-4); }

  function describeUsbDevice(d) {
    var ifaces = [];
    (d.configurations || []).forEach(function (c) {
      (c.interfaces || []).forEach(function (i) {
        (i.alternates || []).forEach(function (a) {
          ifaces.push({ configuration: c.configurationValue, interface: i.interfaceNumber, alternate: a.alternateSetting,
            classCode: a.interfaceClass, subclass: a.interfaceSubclass, protocol: a.interfaceProtocol,
            endpoints: (a.endpoints || []).map(function (e) { return { n: e.endpointNumber, dir: e.direction, type: e.type, packet: e.packetSize }; }) });
        });
      });
    });
    return { transport: 'webusb', vendorId: d.vendorId, productId: d.productId, vendorIdHex: hex4(d.vendorId), productIdHex: hex4(d.productId),
      manufacturer: d.manufacturerName || null, product: d.productName || null, serial: d.serialNumber || null,
      usbVersion: d.usbVersionMajor != null ? d.usbVersionMajor + '.' + d.usbVersionMinor : null,
      interfaces: ifaces, known: identify(d.vendorId, d.productId) };
  }

  function RealUsbAdapter(nav) {
    BaseAdapter.call(this); this.isSimulation = false; this.label = 'USB device (read-only)';
    this.nav = nav || (typeof navigator !== 'undefined' ? navigator : {}); this.device = null; this._onDisc = null;
  }
  RealUsbAdapter.prototype = Object.create(BaseAdapter.prototype);
  RealUsbAdapter.supported = function (nav) { nav = nav || (typeof navigator !== 'undefined' ? navigator : {}); return !!nav.usb; };
  RealUsbAdapter.prototype.connect = function (opts) {
    var self = this; opts = opts || {};
    if (!this.nav.usb) return Promise.reject(MachineError('UNSUPPORTED_BROWSER', 'WebUSB is not available in this browser or context (needs Chromium/Brave over https:// or localhost or file://).'));
    this._set('connecting');
    /* empty filter list = show every USB device; the user picks. We do not guess Cricut IDs. */
    return this.nav.usb.requestDevice({ filters: opts.filters || [] }).then(function (dev) {
      self.device = dev;
      return withTimeout(dev.open(), opts.timeoutMs || 8000, 'Opening the USB device');
    }).then(function () {
      self.info = describeUsbDevice(self.device);
      if (self.nav.usb.addEventListener) {
        self._onDisc = function (ev) { if (ev.device === self.device) { self._set('disconnected'); self.emit('lost', MachineError('DISCONNECTED', 'USB device was unplugged.')); } };
        self.nav.usb.addEventListener('disconnect', self._onDisc);
      }
      self._set('connected'); return self.info;
    }).catch(function (e) { self._set('disconnected'); throw (e && e.name === 'MachineError') ? e : classifyBrowserError(e); });
  };
  RealUsbAdapter.prototype.disconnect = function () {
    var self = this, d = this.device; this.device = null;
    if (this._onDisc && this.nav.usb && this.nav.usb.removeEventListener) this.nav.usb.removeEventListener('disconnect', this._onDisc);
    return (d && d.opened ? d.close() : Promise.resolve()).catch(function () { }).then(function () { self._set('disconnected'); });
  };
  RealUsbAdapter.prototype.sendJob = function () {
    return Promise.reject(MachineError('PROTOCOL_UNKNOWN', 'Cutting is disabled for real hardware: no verified Cricut Maker 3 job protocol is available, and this application will not send guessed data to a machine.'));
  };

  function RealSerialAdapter(nav) {
    BaseAdapter.call(this); this.isSimulation = false; this.label = 'Serial port (read-only)';
    this.nav = nav || (typeof navigator !== 'undefined' ? navigator : {}); this.port = null; this._reader = null;
  }
  RealSerialAdapter.prototype = Object.create(BaseAdapter.prototype);
  RealSerialAdapter.supported = function (nav) { nav = nav || (typeof navigator !== 'undefined' ? navigator : {}); return !!nav.serial; };
  RealSerialAdapter.prototype.connect = function () {
    var self = this;
    if (!this.nav.serial) return Promise.reject(MachineError('UNSUPPORTED_BROWSER', 'Web Serial is not available in this browser. Brave disables it by default: enable brave://flags/#brave-web-serial-api, or use Chrome/Chromium.'));
    this._set('connecting');
    return this.nav.serial.requestPort({}).then(function (port) {
      self.port = port; var i = (port.getInfo && port.getInfo()) || {};
      self.info = { transport: 'webserial', vendorId: i.usbVendorId == null ? null : i.usbVendorId, productId: i.usbProductId == null ? null : i.usbProductId,
        vendorIdHex: hex4(i.usbVendorId), productIdHex: hex4(i.usbProductId), known: identify(i.usbVendorId, i.usbProductId) };
      self._set('connected'); return self.info;   // port is NOT opened here (opening can toggle DTR/RTS)
    }).catch(function (e) { self._set('disconnected'); throw (e && e.name === 'MachineError') ? e : classifyBrowserError(e); });
  };
  /* Receive-only. Never writes. */
  RealSerialAdapter.prototype.listen = function (baudRate, timeoutMs) {
    var self = this;
    if (!this.port) return Promise.reject(MachineError('NOT_CONNECTED', 'Select a serial port first.'));
    return withTimeout(this.port.open({ baudRate: baudRate || 115200 }), timeoutMs || 8000, 'Opening the serial port').then(function () {
      var reader = self.port.readable.getReader(); self._reader = reader;
      (function pump() {
        reader.read().then(function (r) {
          if (r.done) return;
          self.emit('rx', Array.prototype.map.call(r.value, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(' '));
          pump();
        }).catch(function (e) { self.emit('lost', classifyBrowserError(e, 'DISCONNECTED')); });
      })();
    }).catch(function (e) { throw (e && e.name === 'MachineError') ? e : classifyBrowserError(e); });
  };
  RealSerialAdapter.prototype.disconnect = function () {
    var self = this, r = this._reader, p = this.port; this._reader = null; this.port = null;
    return Promise.resolve().then(function () { return r && r.cancel(); }).then(function () { return p && p.readable && p.close(); })
      .catch(function () { }).then(function () { self._set('disconnected'); });
  };
  RealSerialAdapter.prototype.sendJob = RealUsbAdapter.prototype.sendJob;

  /* diagnostics text the user can paste into a bug report / use to write a udev rule */
  function diagnosticsText(adapter, extra) {
    var i = adapter && adapter.info;
    var L = ['Stick-it-too-Cricut v5 diagnostics', 'adapter: ' + (adapter ? adapter.label : 'none'), 'simulation: ' + !!(adapter && adapter.isSimulation),
      'state: ' + (adapter ? adapter.state : 'n/a'), 'userAgent: ' + (typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a')];
    if (i) { L.push('info: ' + JSON.stringify(i, null, 2)); }
    if (extra) L.push(extra);
    return L.join('\n');
  }
  function udevRuleFor(vendorId, productId) {
    if (!isFinite(vendorId) || !isFinite(productId)) throw MachineError('JOB_INVALID', 'vendorId/productId required.');
    var v = ('0000' + vendorId.toString(16)).slice(-4), p = ('0000' + productId.toString(16)).slice(-4);
    return '# Grants the logged-in desktop user access to this USB device (no root, no group changes).\n' +
      'SUBSYSTEM=="usb", ATTR{idVendor}=="' + v + '", ATTR{idProduct}=="' + p + '", TAG+="uaccess"\n' +
      'SUBSYSTEM=="tty", ATTRS{idVendor}=="' + v + '", ATTRS{idProduct}=="' + p + '", TAG+="uaccess"\n';
  }

  return {
    MachineError: MachineError, CODES: CODES, classifyBrowserError: classifyBrowserError, withTimeout: withTimeout,
    prepareJob: prepareJob, validateJob: validateJob, jobToSVG: jobToSVG, describeStages: describeStages,
    SimulatedMachine: SimulatedMachine, RealUsbAdapter: RealUsbAdapter, RealSerialAdapter: RealSerialAdapter,
    registerKnownDevice: registerKnownDevice, identify: identify, describeUsbDevice: describeUsbDevice,
    diagnosticsText: diagnosticsText, udevRuleFor: udevRuleFor, _constants: { MAX_POINTS: MAX_POINTS }
  };
});
