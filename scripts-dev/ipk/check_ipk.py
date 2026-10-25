#!/usr/bin/env python3
"""Structural check of a built sdxpinn-qmanager .ipk.

Usage: check_ipk.py <file.ipk | dir holding sdxpinn-qmanager_*.ipk>

Fails (exit 1) unless the package is what the device's opkg and the package
lifecycle in install.sh expect: the feed's gzip'd-tar container with members
in order, root-owned entries, executable LF-only scripts, the preinst entry
point, no /www/index.html (luci-base owns it), and a manifest that lists
exactly the payload.
"""

import glob
import gzip
import io
import os
import sys
import tarfile

PKG = "sdxpinn-qmanager"
EXPECT_DEPENDS = "sdxpinn-patch (>= 3.0), jq"
SCRIPTS = ("preinst", "postinst", "prerm", "postrm")
MANIFEST = "usr/share/qmanager/manifest"

errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)


def open_tgz(data):
    return tarfile.open(fileobj=io.BytesIO(gzip.decompress(data)), mode="r:")


def members(tar):
    out = {}
    for m in tar.getmembers():
        name = m.name[2:] if m.name.startswith("./") else m.name
        data = tar.extractfile(m).read() if m.isfile() else None
        out[name.rstrip("/")] = (m, data)
    return out


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "qmanager-build"
    if os.path.isdir(target):
        found = sorted(glob.glob(os.path.join(target, PKG + "_*.ipk")), key=os.path.getmtime)
        if not found:
            print("check_ipk: no %s_*.ipk in %s" % (PKG, target), file=sys.stderr)
            return 1
        target = found[-1]
    with open(target, "rb") as fh:
        raw = fh.read()

    check(raw[:2] == b"\x1f\x8b", "outer container is not gzip")
    outer = open_tgz(raw)
    names = [m.name for m in outer.getmembers()]
    check(names == ["debian-binary", "control.tar.gz", "data.tar.gz"],
          "outer members are %s" % names)
    debian = outer.extractfile("debian-binary").read()
    check(debian.strip() == b"2.0", "debian-binary is %r" % debian)

    ctrl = members(open_tgz(outer.extractfile("control.tar.gz").read()))
    data = members(open_tgz(outer.extractfile("data.tar.gz").read()))

    fields = {}
    for line in (ctrl.get("control", (None, b""))[1] or b"").decode().splitlines():
        if ":" in line and not line.startswith(" "):
            k, _, v = line.partition(":")
            fields[k] = v.strip()
    check(fields.get("Package") == PKG, "Package is %r" % fields.get("Package"))
    check(fields.get("Architecture") == "sdxpinn", "Architecture is %r" % fields.get("Architecture"))
    check(fields.get("Depends") == EXPECT_DEPENDS, "Depends is %r" % fields.get("Depends"))
    check(fields.get("Version", "").startswith(tuple("0123456789")), "Version is %r" % fields.get("Version"))
    check(os.path.basename(target) == "%s_%s_sdxpinn.ipk" % (PKG, fields.get("Version")),
          "file name does not match Version")

    for name in SCRIPTS:
        m, body = ctrl.get(name, (None, None))
        if m is None:
            errors.append("CONTROL/%s missing" % name)
            continue
        check(m.mode & 0o777 == 0o755, "CONTROL/%s mode %o" % (name, m.mode))
        check(body.startswith(b"#!/bin/sh\n"), "CONTROL/%s shebang" % name)
        check(b"\r" not in body, "CONTROL/%s has CR" % name)
    pre = ctrl.get("preinst", (None, b""))[1] or b""
    check(b"\nQM_INSTALL_ENTRY=ipk_preinst\n" in pre and b"\nipk_preinst() {" in pre,
          "preinst is not install.sh behind QM_INSTALL_ENTRY=ipk_preinst")

    for name, (m, body) in list(ctrl.items()) + list(data.items()):
        check(m.uid == 0 and m.gid == 0, "%s not owned by root" % name)

    check("www/index.html" not in data, "payload ships www/index.html (luci-base owns it)")
    for must in ("usr/share/qmanager/index.html", "usr/share/qmanager/install.sh",
                 "usr/share/qmanager/uninstall.sh", "etc/init.d/qmanager", MANIFEST):
        check(must in data, "payload is missing %s" % must)

    atd = data.get("usr/bin/qmanager_atd", (None, b""))
    check(atd[1] and atd[1][:4] == b"\x7fELF" and atd[0].mode & 0o777 == 0o755,
          "usr/bin/qmanager_atd is not a 0755 ELF")

    for name, (m, body) in data.items():
        if not m.isfile():
            continue
        script = body.startswith(b"#!") or name.endswith(".sh") or name.startswith(("usr/bin/", "etc/init.d/"))
        if script:
            check(m.mode & 0o777 == 0o755, "%s mode %o" % (name, m.mode))
            if not body.startswith(b"\x7fELF"):
                check(b"\r" not in body, "%s has CR" % name)

    listed = set((data.get(MANIFEST, (None, b""))[1] or b"").decode().split())
    shipped = set(n for n, (m, _) in data.items() if not m.isdir() and n)
    check(listed == shipped, "manifest differs from payload: +%s -%s"
          % (sorted(listed - shipped)[:5], sorted(shipped - listed)[:5]))

    size = int(fields.get("Installed-Size", "0") or 0)
    print("%s: %d payload files, %.1f MB packed, %.1f MB installed"
          % (os.path.basename(target), len(shipped), len(raw) / 1048576.0, size / 1048576.0))
    if errors:
        for e in errors:
            print("  FAIL " + e, file=sys.stderr)
        return 1
    print("  all structural checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
