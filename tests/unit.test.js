// Unit tests for src/machine.js  —  run: node --test tests/
// NOTE: every "device" here is a MOCK or the SIMULATOR. No Cricut hardware was involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const CM = require('../src/machine.js');

const rect = { id: 1, type: 'rect', x: 96, y: 96, w: 96, h: 192, name: 'R' };
const rejects = (p, code) => assert.rejects(p, e => { assert.equal(e.code, code, e.message); return true; });

test('prepareJob: 96px = 25.4mm, rectangle becomes a closed 4-point path', () => {
  const j = CM.prepareJob([rect]);
  assert.equal(j.units, 'mm'); assert.equal(j.paths.length, 1); assert.ok(j.paths[0].closed);
  assert.deepEqual(j.paths[0].points[0].map(v => +v.toFixed(3)), [25.4, 25.4]);
  assert.deepEqual(j.paths[0].points[2].map(v => +v.toFixed(3)), [50.8, 76.2]);
  assert.equal(j.stats.lengthMm, +(2 * 25.4 + 2 * 50.8).toFixed(2));
  assert.ok(Math.abs(j.mat.w - 304.8) < 1e-9);
});
test('prepareJob: all supported shape types produce paths', () => {
  const j = CM.prepareJob([rect,
    { id: 2, type: 'ellipse', cx: 400, cy: 400, rx: 50, ry: 30, name: 'E' },
    { id: 3, type: 'polygon', cx: 600, cy: 400, r: 40, n: 6 },
    { id: 4, type: 'star', cx: 800, cy: 400, r: 40, ir: 16, n: 5 },
    { id: 5, type: 'line', x1: 10, y1: 10, x2: 100, y2: 50 },
    { id: 6, type: 'rect', x: 100, y: 600, w: 100, h: 100, cornerR: 20 }]);
  assert.equal(j.paths.length, 6);
  assert.equal(j.paths.find(p => p.id === 4).points.length, 10);
  assert.equal(j.paths.find(p => p.id === 3).points.length, 6);
  assert.equal(j.paths.find(p => p.id === 5).closed, false);
  assert.ok(j.paths.find(p => p.id === 6).points.length > 4, 'rounded rect is tessellated');
});
test('prepareJob: hidden skipped; text/image skipped WITH a warning', () => {
  const j = CM.prepareJob([rect, { ...rect, id: 9, hidden: true }, { id: 7, type: 'text', text: 'Hello', x: 0, y: 0 }, { id: 8, type: 'image', name: 'pic' }]);
  assert.equal(j.paths.length, 1); assert.equal(j.warnings.length, 2);
  assert.match(j.warnings.join('|'), /Text "Hello"/); assert.match(j.warnings.join('|'), /pic/);
});
test('prepareJob: empty design, non-array and NaN coordinates are rejected', () => {
  assert.throws(() => CM.prepareJob([]), e => e.code === 'JOB_INVALID');
  assert.throws(() => CM.prepareJob([{ id: 1, type: 'text', text: 'x' }]), e => e.code === 'JOB_INVALID');
  assert.throws(() => CM.prepareJob(null), e => e.code === 'JOB_INVALID');
  assert.throws(() => CM.prepareJob([{ ...rect, x: NaN }]), e => e.code === 'JOB_INVALID');
});
test('prepareJob: too many points -> JOB_TOO_LARGE', () => {
  const many = Array.from({ length: 30000 }, (_, i) => ({ id: i, type: 'star', cx: 50, cy: 50, r: 30, ir: 10, n: 5 }));
  assert.throws(() => CM.prepareJob(many), e => e.code === 'JOB_TOO_LARGE');
});
test('prepareJob: beyond-mat warning and material defaults/clamping', () => {
  const j = CM.prepareJob([{ ...rect, x: 1100, w: 300 }], { material: { passes: 99, pressure: 'abc' } });
  assert.ok(j.outsideMat); assert.match(j.warnings.join(), /beyond/);
  assert.equal(j.material.passes, 10); assert.equal(j.material.pressure, 175);
});
test('jobToSVG is well-formed and carries every path', () => {
  const j = CM.prepareJob([rect, { id: 5, type: 'line', x1: 0, y1: 0, x2: 96, y2: 96 }]);
  const svg = CM.jobToSVG(j);
  assert.match(svg, /^<svg[^>]+width="304\.80mm"/); assert.equal((svg.match(/M/g) || []).length, 2); assert.ok(svg.includes('Z'));
});
test('validateJob rejects malformed jobs', () => {
  assert.throws(() => CM.validateJob({}), e => e.code === 'JOB_INVALID');
  assert.throws(() => CM.validateJob({ units: 'mm', paths: [{ points: [[0, 0]] }] }), e => e.code === 'JOB_INVALID');
  assert.throws(() => CM.validateJob({ units: 'mm', paths: [{ points: [[0, 0], [NaN, 1]] }] }), e => e.code === 'JOB_INVALID');
});

/* ---------------- simulator (SIMULATION) ---------------- */
const job = () => CM.prepareJob([rect]);
test('SIM: connect, progress events, successful job is labelled simulated', async () => {
  const m = new CM.SimulatedMachine({ chunkPoints: 2 }); assert.equal(m.isSimulation, true);
  const prog = []; m.on('progress', p => prog.push(p));
  await m.connect(); assert.ok(m.isConnected());
  const r = await m.sendJob(job());
  assert.equal(r.simulated, true); assert.match(r.message, /nothing was cut/);
  assert.ok(prog.length >= 2 && prog.every(p => p.simulated)); assert.equal(m.jobsReceived, 1);
});
test('SIM: job before connect -> NOT_CONNECTED; bad job -> JOB_INVALID', async () => {
  const m = new CM.SimulatedMachine();
  await rejects(m.sendJob(job()), 'NOT_CONNECTED');
  await m.connect(); await rejects(m.sendJob({ units: 'mm', paths: [] }), 'JOB_INVALID');
});
test('SIM: injected faults surface as the right error codes', async () => {
  await rejects(new CM.SimulatedMachine({ fail: 'connect' }).connect(), 'OPEN_FAILED');
  for (const [fail, code] of [['transfer', 'SIMULATED_FAULT'], ['cut', 'SIMULATED_FAULT'], ['disconnect', 'DISCONNECTED']]) {
    const m = new CM.SimulatedMachine({ fail, chunkPoints: 1 }); await m.connect(); await rejects(m.sendJob(job()), code);
    if (fail === 'disconnect') assert.equal(m.state, 'disconnected');
  }
});
test('SIM: connection timeout and cancellation', async () => {
  const m = new CM.SimulatedMachine({ fail: 'timeout' }); await m.connect();
  await rejects(m.sendJob(job(), { timeoutMs: 50 }), 'TIMEOUT');
  const c = new CM.SimulatedMachine({ chunkPoints: 1, latencyMs: 5 }); await c.connect();
  const p = c.sendJob(job()); setTimeout(() => c.cancel(), 8); await rejects(p, 'CANCELLED');
});

/* ---------------- real adapters against MOCK browser APIs ---------------- */
function mockUsb(opts = {}) {
  const calls = { writes: 0, claims: 0, opens: 0, closes: 0 }, listeners = {};
  const dev = { vendorId: 0x1234, productId: 0xabcd, productName: 'MOCK', manufacturerName: 'M', serialNumber: 'S', usbVersionMajor: 2, usbVersionMinor: 0, opened: false,
    configurations: [{ configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 10, interfaceSubclass: 0, interfaceProtocol: 0, endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk', packetSize: 64 }] }] }] }],
    open: async () => { calls.opens++; if (opts.openError) throw Object.assign(new Error('busy'), { name: opts.openError }); if (opts.hang) await new Promise(() => { }); dev.opened = true; },
    close: async () => { calls.closes++; dev.opened = false; },
    transferOut: async () => { calls.writes++; }, controlTransferOut: async () => { calls.writes++; }, claimInterface: async () => { calls.claims++; } };
  return { calls, dev, usb: { requestDevice: async () => { if (opts.requestError) throw Object.assign(new Error('x'), { name: opts.requestError }); return dev; },
    addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: () => { }, _fire: ev => listeners.disconnect && listeners.disconnect(ev) } };
}
test('USB: unsupported browser -> UNSUPPORTED_BROWSER', async () => {
  assert.equal(CM.RealUsbAdapter.supported({}), false);
  await rejects(new CM.RealUsbAdapter({}).connect(), 'UNSUPPORTED_BROWSER');
});
test('USB: connect reads descriptors only (no claim, no writes) and reports unidentified model', async () => {
  const m = mockUsb(); const a = new CM.RealUsbAdapter({ usb: m.usb });
  const info = await a.connect();
  assert.equal(info.vendorIdHex, '0x1234'); assert.equal(info.productIdHex, '0xabcd'); assert.equal(info.known, null);
  assert.equal(info.interfaces[0].classCode, 10); assert.equal(info.interfaces[0].endpoints[0].type, 'bulk');
  assert.deepEqual([m.calls.writes, m.calls.claims], [0, 0]);
  await a.disconnect(); assert.equal(m.calls.closes, 1);
});
test('USB: chooser dismissed, permission denied, busy device', async () => {
  await rejects(new CM.RealUsbAdapter({ usb: mockUsb({ requestError: 'NotFoundError' }).usb }).connect(), 'NO_DEVICE_SELECTED');
  await rejects(new CM.RealUsbAdapter({ usb: mockUsb({ openError: 'SecurityError' }).usb }).connect(), 'PERMISSION_DENIED');
  await rejects(new CM.RealUsbAdapter({ usb: mockUsb({ openError: 'NetworkError' }).usb }).connect(), 'OPEN_FAILED');
});
test('USB: open timeout and interrupted connection (unplug)', async () => {
  await rejects(new CM.RealUsbAdapter({ usb: mockUsb({ hang: true }).usb }).connect({ timeoutMs: 40 }), 'TIMEOUT');
  const m = mockUsb(); const a = new CM.RealUsbAdapter({ usb: m.usb }); await a.connect();
  let lost = null; a.on('lost', e => lost = e); m.usb._fire({ device: m.dev });
  assert.equal(lost.code, 'DISCONNECTED'); assert.equal(a.state, 'disconnected');
});
test('USB: sendJob on real hardware is refused (PROTOCOL_UNKNOWN) and writes nothing', async () => {
  const m = mockUsb(); const a = new CM.RealUsbAdapter({ usb: m.usb }); await a.connect();
  await rejects(a.sendJob(job()), 'PROTOCOL_UNKNOWN'); assert.equal(m.calls.writes, 0);
});
test('known-device table is empty until a user registers an ID; registered IDs are matched', async () => {
  assert.equal(CM.identify(0x1234, 0xabcd), null);
  CM.registerKnownDevice({ vendorId: 0x1234, productId: 0xabcd, model: 'Example', verified: false });
  assert.equal(CM.identify(0x1234, 0xabcd).model, 'Example');
  const info = await new CM.RealUsbAdapter({ usb: mockUsb().usb }).connect(); assert.equal(info.known.model, 'Example');
});
test('Serial: unsupported, select does not open the port, listen is receive-only', async () => {
  await rejects(new CM.RealSerialAdapter({}).connect(), 'UNSUPPORTED_BROWSER');
  const calls = { open: 0, write: 0 }; let chunks = [new Uint8Array([1, 0xab])];
  const port = { getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0xabcd }),
    open: async () => { calls.open++; },
    readable: { getReader: () => ({ read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true }, cancel: async () => { } }) },
    writable: { getWriter: () => { calls.write++; throw new Error('must never be called'); } }, close: async () => { } };
  const a = new CM.RealSerialAdapter({ serial: { requestPort: async () => port } });
  const info = await a.connect(); assert.equal(info.vendorIdHex, '0x1234'); assert.equal(calls.open, 0);
  const rx = []; a.on('rx', h => rx.push(h)); await a.listen(115200); await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(rx, ['01 ab']); assert.equal(calls.write, 0); await rejects(a.sendJob(job()), 'PROTOCOL_UNKNOWN');
});
test('Serial: chooser dismissed -> NO_DEVICE_SELECTED; listen before select -> NOT_CONNECTED', async () => {
  await rejects(new CM.RealSerialAdapter({ serial: { requestPort: async () => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }); } } }).connect(), 'NO_DEVICE_SELECTED');
  await rejects(new CM.RealSerialAdapter({ serial: {} }).listen(), 'NOT_CONNECTED');
});
test('stages: real device never claims transfer/cut is implemented; simulator labels everything simulated', () => {
  const real = CM.describeStages({ isSimulation: false }), sim = CM.describeStages({ isSimulation: true });
  assert.equal(real.length, 8); assert.deepEqual(real.slice(5).map(s => s.status), ['not-implemented', 'not-implemented', 'not-implemented']);
  assert.equal(real[4].status, 'implemented'); assert.ok(sim.filter(s => s.n !== 5).every(s => s.status === 'simulated'));
});
test('udev rule generator + diagnostics', () => {
  const r = CM.udevRuleFor(0x1234, 0xabc); assert.match(r, /idVendor\}=="1234"/); assert.match(r, /idProduct\}=="0abc"/); assert.match(r, /uaccess/);
  assert.throws(() => CM.udevRuleFor(NaN, 1));
  assert.match(CM.diagnosticsText(new CM.SimulatedMachine()), /simulation: true/);
});
