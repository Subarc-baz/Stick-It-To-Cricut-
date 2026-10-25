# Test report (v6)

Environment: cloud Linux container, Node 22.22.0, Playwright 1.56.0, headless **Chromium 141** (not Brave, not Bazzite). **No Cricut hardware was available. No test touched a real device.** Every device in these tests is a mock injected into the page or the labelled simulator.

## Results
| Suite | Result |
|---|---|
| `tests/unit.test.js` (machine layer, Node) | **22 / 22 passed** |
| `tests/textpaths.unit.test.js` (outline geometry, font matching) | **16 / 16 passed** |
| `tests/browser.test.js` (built `index.html` in real Chromium) | **20 / 20 passed** |
| `tests/fonts.browser.test.js` (fonts, text-to-shapes, SVG export; `queryLocalFonts` is a **mock**) | **20 / 20 passed** |
| `tests/undo.browser.test.js` (Undo/Redo buttons, shortcuts) | **2 / 2 passed** |
| `tests/mat.browser.test.js` (mat colour, undo of text-to-shapes via the UI) | **4 / 4 passed** |
| **Total** | **84 / 84** |
| Syntax check (`node --check`) of every JS file, plus parse of all 4 inline `<script>` blocks in `index.html` | passed |
| Packaged copy: ZIP extracted to an empty directory and the full suite re-run there | passed (see the final message for the run) |

One failing test existed during development, a test-helper bug (my helper overwrote Playwright's `click`), and one test used a single wheel event where twelve were needed. Both were fixed in the tests, not the app. No application code was changed to make a test pass.

## What the browser tests cover
Draw all five shape types with the mouse; drag each and check the **drawn geometry** moved (not only the hit-box); click without movement adds no undo step; a drag is one undo step and undo/redo restore position; dragging while zoomed and panned; marquee multi-select; group; selecting a group from one member; group moves by one common delta and leaves non-members alone; ungroup; Shift-click add/remove; copy/paste of groups remaps group ids; delete and undo of a group; corner-handle resize for a rect, an ellipse and a group (Shift keeps aspect); numeric X/Y/W/H panel; images across undo/redo/copy; export PNG/SVG and save project; context-menu Copy; no uncaught page errors in any of them.
Machine panel: simulator connect and cut, injected transfer fault then recovery, cut with nothing connected, empty design, mock USB connect (verifies **zero** `transferOut` and `claimInterface` calls), raw console send blocked for real devices, dismissed chooser, busy device, retry, and a browser with no WebUSB.

## What the unit tests cover
Job geometry (96 px = 25.4 mm, every shape type, rounded rects, hidden objects, text/image skipped **with warnings**, NaN, empty, oversized, off-mat, SVG output); simulator success, progress, not-connected, invalid job, connect failure, mid-transfer fault, cable pull, cancel, timeout; mock WebUSB (unsupported, descriptors only, dismissed, permission denied, busy, open timeout, unplug event, send refused with nothing written); mock Web Serial (port not opened on select, receive-only listener never writes); empty known-device table; stage report honesty; udev rule and diagnostics text.

## Baseline evidence on the original v4 (`tests/original-baseline.js`)
Run on the untouched original in the same Chromium: page error `resizingText is not defined`, and **no rectangle or ellipse could be created by mouse** (objects.length stayed 0). With only that one-line fix applied, rectangles drag correctly but an ellipse's `x/y` changed while its `cx/cy` did not (drawing stayed put).
Running the v5 browser suite against the original fails all 13 editor tests. That number is **not** a meaningful before/after comparison, because most of those tests exercise features v4 never had (grouping, multi-select, machine panel). The baseline probe above is the fair evidence.

## Not done / not possible
* **Real hardware of any kind: not tested.** Real WebUSB/Web Serial against a physical device, udev behaviour, kernel driver binding, Maker 3 enumeration: all untested.
* Brave, Firefox, Bazzite, Flatpak browsers: not tested. Only headless Chromium 141.
* Job transfer and cutting: not implemented (no verified protocol), so nothing to test.
* Not run: load/performance profiling, touch input, high-DPI beyond the default, very large designs beyond the 200,000-point guard, text-effect rendering (unchanged v4 code).
* A human has not used the UI. I looked at two screenshots (`docs/img/`) and found it rendered correctly.
* The pre-existing text-tool resize handle and text effects code were left unchanged and are covered only by "no page errors" in the flows above.

## v6 notes
* Font tests need DejaVu Sans / Bold (or `FONT_TTF`, `FONT_BOLD_TTF`); they skip otherwise.
* Fidelity: converted text and exported SVG were rendered and compared with the canvas by pixel overlap (IoU > 0.97 at large size for converted shapes, > 0.9 for exported SVG), plus bold face, hostile font names (no HTML injection), undo/redo/save/load of path objects.
* The real `queryLocalFonts` permission flow was **not** tested (headless Chromium, mock only). Brave and Bazzite untested. I viewed three screenshots (`docs/img/shot-v6-*.png`); no human used the UI.
