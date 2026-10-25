# Cricut Maker 3 connectivity: research (opened sources only)

Research ran in October 2026. Everything below was read directly. "Claim" means a statement by an author or commenter that I could not independently verify.

## Bottom line
* **Verified:** there is no public, working implementation that sends cut jobs to a stock **Maker 3**. I found none in the sources below.
* **Verified:** every open-source effort I found targets the **original Cricut Maker**, and the one working effort replaces the machine's firmware rather than speaking the stock protocol.
* **Unverified:** the Maker 3's USB IDs, USB class, and whether stock communication is encrypted or authenticated. Reports about the original Maker conflict (see below).
* Therefore a browser-only, helper-service, desktop-wrapper or reuse-existing-code design **cannot control a Maker 3 today**, whatever the architecture. The missing piece is protocol knowledge, not browser capability.

## Sources and what they actually say
| Source | What I verified from it | Relevance |
|---|---|---|
| [virtualabs/cutcutgo](https://github.com/virtualabs/cutcutgo) (README read; source files not audited) | "GRBL for Cricut Maker": custom firmware for the original Maker ("Champagne" v1); replaces stock firmware; MIT; BLE channel listed as unfinished; README says Maker 3 would "require a complete reverse-engineering of their electronics" | Not reusable for Maker 3. Flashing firmware is not something this project does or recommends |
| [leHACK 2023 talk page](https://lehack.org/2023/track/cutting-ties-of-a-vinyl-cutter/) and [slides PDF](https://tagazok.virtualabs.fr/lehack23_Cutting_ties_of_a_vinyl_cutter.final.pdf) | Original Maker (PIC32MX470F512L). Slides state the stock communication is **encrypted with a secret key** and could change at any time. No protocol details published | Evidence against an easy stock-protocol implementation (original Maker only) |
| [xssfox, "Unlocking a locked/deactivated e-waste Cricut Maker" (2026-07-01)](https://sprocketfox.io/xssfox/2026/07/01/cricut-unlock/) | Original Maker uses **USB CDC**; in Wireshark captures of the serial-number packets the author saw "no checksumming or crypto". Bluetooth not investigated. No code published | Conflicts with the slides, or applies to a different layer. Neither covers Maker 3 job transfer |
| [Inkcut issue #426](https://github.com/inkcut/inkcut/issues/426) | Contributors "started investigating the Maker's USB protocol"; no findings reported | Confirms no public protocol work as of that post |
| [Inkcut forum thread](https://inkcut.org/t/new-with-inkcut-and-cricuit-maker/129/) | Inkcut has no Cricut support; Maker 3 not covered; the HPGL mentioned applies to older models | Maker 3 is not HPGL-compatible per this thread (claim) |
| slicebug README (read via an unofficial mirror, https://ohotnik.duckdns.org/XtremeCoder007/slicebug; **not run, not audited**) | Windows + installed Design Space; tested only on original Maker; reuses undocumented Design Space components; no licence stated; does not run on Linux/Wine per README | Not reusable here |
| [Hacker News thread](https://news.ycombinator.com/item?id=46761761) | Claims only: Maker 3 is "USB or Bluetooth"; Wine allows user-mode USB access; commenters say earlier projects were pressured to remove Cricut support | Context only |
| [Wikipedia: Cricut](https://en.wikipedia.org/wiki/Cricut) | 2010 and 2011 lawsuits by Provo Craft against Make-the-Cut and Sure Cuts A Lot authors; complaint alleged encryption/obfuscation of USB traffic to Design Studio | Legal and technical context for older models. Not legal advice |
| [Blink intent: WebUSB interface class filtering](https://groups.google.com/a/chromium.org/g/blink-dev/c/LZXocaeCwDw/m/GLfAffGLAAAJ) | Blink blocks Audio, Video, HID, Mass Storage, Smart Card, Wireless Controller interfaces. CDC classes are not in that list (post does not say more) | A CDC-style device is not blocked by this rule. A Maker 3 interface class is unknown |
| linux-usb.org `usb.ids` (copy downloaded for this work) | No entry matched "Cricut" or "Provo Craft" in the copy I searched | I therefore did **not** hard-code any Cricut vendor/product ID |

## Connectivity stages (task section 4)
| # | Stage | Status for Maker 3 over USB |
|---|---|---|
| 1 | Detect device | Implemented (browser chooser, read-only). Real-device behaviour **untested** |
| 2 | Identify model | Partial: reports IDs/descriptors. No verified ID table exists, so the model is not auto-identified |
| 3 | Connect | Implemented (open handle only). Untested on hardware |
| 4 | Initialise, read state | Unknown: needs the protocol |
| 5 | Prepare job | Implemented as neutral mm geometry (not a Cricut format) and unit tested |
| 6 | Transfer job | Not implemented: no verified protocol |
| 7 | Acks / status | Not implemented |
| 8 | Cut | Not implemented, deliberately blocked |

## Architecture comparison
| Option | Verdict |
|---|---|
| Browser-only (WebUSB / Web Serial) | **Chosen for discovery.** Matches your goal of running on any OS. Needs Chromium-family browser and udev access on Linux |
| Local helper service | No benefit today. Worth adding only if the real protocol needs something browsers block (unknown) |
| Desktop wrapper | Same as helper; no benefit without a protocol |
| Reuse existing code | Nothing reusable for Maker 3 (cutcutgo: firmware replacement for original Maker; slicebug: Windows/Design Space) |
| Hybrid | Reasonable later; the adapter interface in `src/machine.js` already isolates the transport |

## What would unblock real cutting (not done; needs your hardware and your decision)
1. Capture USB traffic between the **official** software and your own Maker 3 using ordinary diagnostics (Wireshark with usbmon on a machine that runs Design Space; Design Space does not officially support Linux).
2. Determine whether job data is encrypted/authenticated. If it is, a third-party implementation may be impractical or restricted. Consider the licence terms and the legal history above before proceeding.
3. Only then implement a transport + encoder behind the existing adapter interface, and test with explicit authorisation on scrap material.

Alternatively, **Export Cut Paths (SVG)** lets you use this editor for design and cut with any tool known to work with your machine.

## v6 addendum
* opentype.js 1.3.4 (MIT, `src/vendor/opentype.LICENSE`) is vendored and inlined. It parses TTF/OTF/WOFF but does **not** apply GPOS kerning, so pair kerning is taken from the browser's `measureText` instead.
* The Local Font Access API (`window.queryLocalFonts`) is Chromium-only and permission-gated; availability in Brave was not verified.
