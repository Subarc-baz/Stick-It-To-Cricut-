# Known limitations and remaining work

## Hardware (the important ones)
* **No real cutting.** No verified Maker 3 job protocol is available. `sendJob()` on real adapters always refuses with `PROTOCOL_UNKNOWN`. This is intentional.
* **Model not auto-identified.** The known-device table is empty because no Cricut USB IDs were found in primary sources. Use **Copy Diagnostics** and `lsusb` to find your IDs.
* **Real device discovery is untested** on hardware, in Brave, or on Bazzite. Linux guidance in the README is general, not verified.
* **Bluetooth is not implemented.** Web Bluetooth was out of scope per your choice of USB, and no Maker 3 BLE protocol is documented in what I found.
* Opening a USB handle or listening on a serial port was not verified to be harmless on a real Maker 3. Serial listening opens the port (this can toggle DTR/RTS on some devices) and is behind an explicit button.

## Editor
* Raster images are **not exported as cut paths** (embedded in SVG only; skipped for cut paths with a warning). They need tracing.
* **Text to paths needs the font file.** Generic families (sans-serif, serif...) cannot be converted; the export falls back to `<text>` with a warning. A face missing from a family (e.g. no bold) is matched to the nearest face, so weight/slant may differ from the canvas.
* **Local Font Access API is only mock-tested.** It is Chromium-only and was **not verified in Brave or on Bazzite** (Brave may disable it). Fallback: Add font file(s). Fonts loaded from the system must be re-loaded each session unless the browser remembers the permission.
* Not supported: WOFF2 and .ttc/.otc files; variable fonts use their default instance; ligatures and complex-script shaping are not reproduced in outlines.
* Converted text is one compound path object, not separate letters, and cannot be edited as text again (undo it, or keep a copy of the text).
* No rotation, skew, boolean operations (weld/slice/attach) or SVG import beyond what v4 had.
* Radius-based shapes (star, polygon) scale uniformly even when a group is stretched non-uniformly.
* Groups are flat; grouping two groups merges them into one.
* Resizing does not scale stroke width.
* `draw()` is not frame-throttled (unchanged from v4); very large designs may redraw slowly.
* The v4 wrapper chain around `onDown/onMove/onUp/draw` was kept for safety; it works but is fragile to extend.
* The built-in Maker 3 mat is 12×12 in (as in v4); the 12×24 mat is not offered.

## Remaining work for real machine operation
See "What would unblock real cutting" in `RESEARCH.md`: capture the official software's USB traffic on your own machine, determine whether it is encrypted/authenticated, weigh the licence and legal history, then implement a transport and encoder behind the existing adapter, and test only with explicit authorisation and scrap material. Until then, use **Export Cut Paths (SVG)** with a tool known to support your machine.

## v6.1
* Mat colour is not saved inside project files (browser-local only).
* Ctrl+Z / Ctrl+Y are ignored while a text box or dropdown has keyboard focus (so typing is not disturbed); click the canvas first or use the Undo button.
