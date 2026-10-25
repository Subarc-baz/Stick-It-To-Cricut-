#!/usr/bin/env bash
# Prints (does NOT install) a udev rule granting the logged-in desktop user access to one USB device.
# Usage: tools/make-udev-rule.sh 0xVVVV 0xPPPP     (get the IDs from `lsusb` or the app's "Copy Diagnostics")
set -euo pipefail
[[ $# -eq 2 ]] || { echo "usage: $0 0xVENDOR 0xPRODUCT" >&2; exit 2; }
v=$(printf '%04x' "$(($1))"); p=$(printf '%04x' "$(($2))")
cat <<RULE
# Grants the logged-in desktop user access to USB device ${v}:${p} (no root, no group changes).
SUBSYSTEM=="usb", ATTR{idVendor}=="${v}", ATTR{idProduct}=="${p}", TAG+="uaccess"
SUBSYSTEM=="tty", ATTRS{idVendor}=="${v}", ATTRS{idProduct}=="${p}", TAG+="uaccess"
RULE
echo "# Install:  <this output> | sudo tee /etc/udev/rules.d/70-cricut.rules && sudo udevadm control --reload && sudo udevadm trigger" >&2
