# Changes from v4 (original is preserved byte-for-byte in `original/`)

`tools/patch_core.py` derives `src/app.html` from the original with asserted, single-purpose replacements; `tools/build.js` inlines the new modules into `index.html`. Nothing was deleted from v4's features.

## Bug fixes (each confirmed by a test, in a real browser)
1. `resizingText` undeclared: every `mousemove`/`mouseup` threw, so shapes could not be drawn or dragged.
2. Drag moved only `x/y`; ellipse/star/polygon/line draw from other fields, so the drawing and its hit-box separated. Same bug affected align and paste (offset only `x/y`).
3. Undo snapshot for a drag was pushed after the move (undo was a no-op), and every plain click pushed an undo entry.
4. Images were serialised to `{}` by undo/redo/save/autosave, after which `drawImage` threw on every redraw. Images now carry `src` and are rehydrated; `draw()` also guards incomplete images.
5. Context-menu "Copy" passed a string instead of a function.
6. Delete, Bring to Front, Send to Back, Lock, Hide, Align acted on one object only.
7. Rubber-band selection picked only the first contained object ("phase 2" comment in v4).
8. The X/Y/W/H Transform fields displayed values but had no handlers.
9. SVG export silently dropped stars, polygons and lines.

## New features
* Multi-selection (marquee, Shift-click, Ctrl+A), **Group / Ungroup** (Ctrl+G / Ctrl+Shift+G, buttons, context menu). Groups are a shared `gid` on flat objects, so drawing, hit-testing, undo, save/load and export needed no changes. Nested groups are flattened.
* Corner-handle resize for every shape and any selection (Shift keeps aspect); numeric Transform panel.
* Drag threshold (3 screen px) so clicks never jitter or dirty the document.
* Machine tab: read-only WebUSB / Web Serial discovery, simulator with fault injection, 8-stage status, diagnostics, cut-path SVG (mm) export, receive-only serial listener, working Console, header and status-bar connection indicators.
* `src/machine.js` adapter interface (`connect / disconnect / sendJob`) so other models or transports can be added later.

## Deliberately not changed
Text tool, text effects, game, donate dialog, materials list, minimap, webcam/QR/eyedropper, auto-save, visual design. The minimap/empty-canvas/marquee `draw`/`onDown` wrapper chain from v4 was kept; replacing it is a larger refactor than was justified.

# v6 additions (on top of v5)
* **SVG export dialog** (`src/export-ui.js`, `src/svgexport.js`): units, crop, selection-only, text as paths or as `<text>`. Replaces v4's `exportSVG` (which dropped stars/polygons/lines in v4, fixed in v5); now async.
* **Fonts** (`src/fonts.js`): Local Font Access API, uploaded fonts via FontFace + IndexedDB, search, remove. Font names are treated as untrusted (only `textContent`/`value`, tested with hostile names).
* **Text to cut paths** (`src/textpaths.js`, vendored opentype.js 1.3.4): new `path` object type (move/resize/undo/save/copy/group/export all supported), "Convert Text to Shapes", curve/warp text outlined using the app's own glyph placement.
* Kerning: opentype.js 1.3.4 does not apply GPOS kerning, so plain text is placed per character using the browser's own `measureText`, matching the canvas (verified by pixel overlap tests).
* Text panel now stays visible with a single object selected from the layers list (v5 text-panel fix) and refreshes after layer changes.
* Shortcuts: Ctrl+Shift+E opens the export dialog; Ctrl+E unchanged (PNG).
* **Undo / Redo header buttons** (`src/undo-ui.js`) and Ctrl+Shift+Z for redo. The undo engine itself is v4/v5 code (80 steps), unchanged; it was only reachable by keyboard.
* **Mat colour** (`src/mat-ui.js`, patch step 10e): the mat was hard-coded `#0c0c20` in the editor, minimap and PNG export; it is now `matColor` with a contrast-aware grid (`matInk`). Display only; persisted in localStorage; excluded from SVG.
* Undo after "Convert Text to Shapes" is tested through the real buttons (convert, Undo button, Redo button, Ctrl+Z); it works in headless Chromium. See LIMITATIONS for what I could not reproduce.
