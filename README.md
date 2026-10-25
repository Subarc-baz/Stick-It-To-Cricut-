# Stick-it-too-Cricut v6

A single-file, in-browser cutting-design editor (your v4 app) with fixed canvas interaction, real multi-select / grouping / resizing, and a hardware layer for the **Cricut Maker 3 over USB**.

> ## Read this first: what v6 can and cannot do
> **v6 cannot cut on a real Maker 3.** No public, verified protocol for sending cut jobs to a stock Maker 3 exists (see `docs/RESEARCH.md`), and this app will not send guessed data to a machine.
> What it **does** do with real hardware: let you pick a USB/serial device in the browser and **read its descriptors** (vendor/product ID, interfaces, endpoints). It claims no interface and writes nothing.
> A **Simulator** exercises the whole cut workflow in software and is labelled SIMULATION everywhere. Nothing moves.

## Run it
`index.html` is self-contained. Either:
* open it directly in Brave/Chrome/Chromium (`file://` works for the editor), or
* serve it locally, which is the safest context for WebUSB: `./tools/serve.sh` then open `http://localhost:8080/`.

No install, no dependencies, no network access, no telemetry.

## New in v6
* **SVG export** (Export button or **Ctrl+Shift+E**; Ctrl+E is still a quick PNG). Real vector output, 96 units = 1 inch, size in in / mm / px, optional crop-to-design and selected-objects-only. Right-click also offers "Export SVG...". Rectangles, ellipses, stars, polygons, lines, text and converted shapes are exported; raster images are embedded as images.
* **Fonts...** (Text tool options): **Load system fonts** (Chromium's Local Font Access API; the browser asks permission) and **Add font file(s)** (.ttf / .otf / .woff, remembered in this browser). WOFF2 and .ttc are rejected with a message.
* **Text becomes cut paths**: the export dialog's "Convert text to paths" outlines text with the font file; **Convert Text to Shapes** turns selected text into an editable compound path object you can move and resize. Curved/warped text effects are outlined as drawn. Needs the actual font file: system fonts are read from the installed font, uploaded fonts from the file.
* Machine tab "Export Cut Paths (SVG, mm)" now includes text outlines too.
* `exportSVG()` is now asynchronous.
* **Mat colour** (header "Mat" button): presets (dark, charcoal, light gray, white, Cricut green/blue, cream), a custom colour and Reset, so black objects are visible. The grid switches to dark lines on light mats. It is a display setting only: it is remembered in this browser, is not saved in project files and never appears in SVG cut files; PNG export uses it as the background.
* **Undo / Redo buttons** in the header (v4 only had Ctrl+Z / Ctrl+Y, with no visible control). They grey out when there is nothing to undo or redo. **Ctrl+Shift+Z** also redoes. Undo keeps up to 80 steps.
* Not verified on real Brave/Bazzite: the Local Font Access API (only tested against a mock; see `docs/LIMITATIONS.md`). If it is unavailable, use **Add font file(s)**; fonts on Bazzite are usually in `~/.local/share/fonts` or `/usr/share/fonts`.

## What changed from v4 (summary; full list in `docs/CHANGES.md`)
| Area | v4 problem (verified in Chromium) | v5 |
|---|---|---|
| Drawing/dragging | `resizingText` was never declared, so **every mouse move/release threw a ReferenceError**; shapes could not be drawn or dragged | Declared |
| Dragging shapes | Only `x/y` changed; ellipse/star/polygon/line draw from `cx/cy/x1..y2`, so the **hit-box moved but the drawing stayed** | One `translateObj()` moves every coordinate field |
| Undo of a drag | Undo snapshot was taken *after* the move, so undo did nothing | Snapshot taken at drag start, one undo step per drag, none for plain clicks |
| Images | `<img>` serialised to `{}` by undo/save/autosave, so `drawImage` threw afterwards | Images stored by `src`, rehydrated on undo/redo/load/paste |
| Context menu | "Copy" passed a string, not a function | Fixed |
| Selection | Marquee selected only the first object | Multi-select, Shift-click, marquee, **Group / Ungroup** (Ctrl+G / Ctrl+Shift+G), group move/resize/copy/delete |
| Resizing | Only text had a handle | Corner handles for every shape and any selection; numeric X/Y/W/H panel now works |
| Machine tab | Stub button, no code | Connect (USB / serial, read-only), Simulator, stage report, diagnostics, cut-path SVG export |

## Machine tab
* **Connect USB Device (WebUSB)** and **Select Serial Port (Web Serial)** open the browser's own chooser. Both are read-only.
* **Use SIMULATED Machine** runs jobs against a virtual device: progress, cancel, and injectable faults.
* **Export Cut Paths (SVG, mm)** writes the design's cut lines in millimetres, so you can cut with any other tool that is known to work with your machine.
* **Copy Diagnostics** copies the device IDs and browser info. Send these with any compatibility report.
* The Stage panel shows which of the 8 connectivity stages are real, simulated, or not implemented.
* Text is exported as outlines when the font file is available; raster images are skipped with a warning.

## Linux access (general guidance, **not tested on Bazzite or with a real Cricut**)
1. Use a Chromium-based browser. WebUSB works in Chrome/Chromium/Brave. **Web Serial is off by default in Brave**: enable `brave://flags/#brave-web-serial-api`. Firefox supports neither API.
2. Without a udev rule the browser usually gets "permission denied". After you have the vendor/product ID (`lsusb`, or **Copy Diagnostics**), generate a rule that grants your logged-in desktop user access without root or group changes:
   `./tools/make-udev-rule.sh 0xVVVV 0xPPPP` prints the rule. To install it: `sudo tee /etc/udev/rules.d/70-cricut.rules`, then `sudo udevadm control --reload && sudo udevadm trigger`. It is reversible by deleting that file. On Bazzite `/etc` is writable and survives updates.
3. If the kernel has bound a driver to the device (for example `cdc_acm` creating `/dev/ttyACM0`), WebUSB may be unable to open it; use Web Serial instead. This is a hypothesis to verify with `lsusb -v` and `dmesg`.
4. Flatpak browsers sandbox device access; behaviour was not tested. A native or layered install is the simplest first test.

## Tests
```
npm install                       # installs Playwright (dev only)
npx playwright install chromium   # or set CHROMIUM=/path/to/chrome
npm test                          # 84 tests: 22 + 16 unit, 20 + 20 + 2 + 4 real-browser
# font tests need DejaVu fonts or FONT_TTF / FONT_BOLD_TTF=/path/to.ttf
npm run build                     # rebuilds index.html from src/
```
Everything involving a device uses mocks or the simulator. See `docs/TEST_REPORT.md` for exactly what was and was not run.

## Layout
```
index.html            built single-file app (open this)
original/             your untouched v4 file
src/app.html          v4 with minimal patches (tools/patch_core.py derives it from original/)
src/core-engine.js    selection, grouping, transforms, drag/resize, path objects
src/textpaths.js      glyph outlines -> polylines, curve/warp placement
src/svgexport.js      SVG builder
src/fonts.js          system fonts, font upload, text-to-shapes
src/export-ui.js      Export dialog
src/undo-ui.js        Undo / Redo header buttons
src/mat-ui.js         Mat colour picker
src/vendor/           opentype.js 1.3.4 (MIT, inlined)
src/machine.js        hardware layer: job preparation, simulator, read-only USB/serial probes
src/machine-ui.js     Cut tab + Console wiring
tools/                build.js, patch_core.py, serve.sh, make-udev-rule.sh
tests/                unit + browser tests, screenshot helper, original-baseline probe
docs/                 RESEARCH, CHANGES, TEST_REPORT, LIMITATIONS, screenshots
```

## Troubleshooting
* **"WebUSB is not available"**: use Chromium/Brave over `localhost` or `file://`.
* **"Permission denied"**: install the udev rule (above), replug the device.
* **"Device could not be opened (busy)"**: close Design Space or anything else using the device.
* **Chooser shows nothing**: the device is not enumerated; check the cable and `lsusb`.
* **Cut button says protocol unknown**: expected for real hardware; see the box at the top.
