#!/usr/bin/env python3
"""Turn the release tarball into the sdxpinn-qmanager package tree.

Usage: assemble_ipk_source.py [--tarball qmanager-build/qmanager.tar.gz]
                              [--out qmanager-build/ipk-source]

Reads the tarball build.sh produced (so the package carries exactly the files a
tarball install would) and writes <out>/sdxpinn-qmanager/{CONTROL,root}: the
directory build_ipk.py packs, and the one the feed PR adds under ipk-source/.

Payload layout (on-device paths, install.sh "Package lifecycle" has the why):
  /www/**                      frontend, minus index.html (owned by luci-base)
  /www/cgi-bin/quecmanager/**  CGI endpoints
  /usr/bin/*                   daemons + the qmanager_atd broker
  /usr/lib/qmanager/*          shell libraries
  /etc/init.d/*, /etc/nftables.d/*, /etc/sysctl.d/*
  /usr/share/qmanager/         install.sh + uninstall.sh (version-stamped),
                               index.html, defaults/ (deploy-if-missing
                               /etc/qmanager config) and manifest (every
                               payload path; --configure prunes against it)

CONTROL/preinst is install.sh itself behind QM_INSTALL_ENTRY=ipk_preinst: the
new files are not on disk when opkg runs it.
"""

import argparse
import json
import os
import shutil
import sys
import tarfile

PACKAGE = "sdxpinn-qmanager"
ARCH = "sdxpinn"
DEPENDS = "sdxpinn-patch (>= 3.0), jq"
# Packages that open /dev/smd11 (the AT broker owns it), the retired websocat
# bandwidth monitor, and the predecessor QuecManager. install.sh's
# remove_conflicts / retire_bandwidth_monitor do this for tarball installs.
CONFLICTS = ("sdxpinn-quecmanager, sdxpinn-quecmanager-beta, sms-tool, "
             "socat-at-bridge, socat, websocat")
MAINTAINER = "Russel Yasol dr-dolomite@github.com Cameron Thompson iamromulan@github.com"
SOURCE = "github.com/dr-dolomite/QManager"
DESCRIPTION = "A modern web UI for Quectel RM551E modems that runs alongside LuCI"
SHARE = "usr/share/qmanager"

POSTINST = """#!/bin/sh
# Configure the files opkg just placed (install.sh --configure).
[ -n "$IPKG_INSTROOT" ] && exit 0
exec /bin/sh /usr/share/qmanager/install.sh --configure
"""

PRERM = """#!/bin/sh
# Stop and tear down QManager before opkg deletes its files. Config in
# /etc/qmanager is kept. An upgrade is handled by the new preinst instead.
[ -n "$IPKG_INSTROOT" ] && exit 0
case "$1" in upgrade) exit 0 ;; esac
/bin/sh /usr/share/qmanager/uninstall.sh --deconfigure || true
exit 0
"""

POSTRM = """#!/bin/sh
# /usr, /www and /etc are UBIFS: commit opkg's removals to flash.
[ -n "$IPKG_INSTROOT" ] && exit 0
case "$1" in upgrade) exit 0 ;; esac
sync
exit 0
"""


def fail(msg):
    print("assemble_ipk_source: error: " + msg, file=sys.stderr)
    sys.exit(1)


def read_version(repo):
    """(package.json version as build.sh stamps it, opkg Version without "v")."""
    with open(os.path.join(repo, "package.json"), encoding="utf-8") as fh:
        raw = json.load(fh)["version"]
    version = raw[1:] if raw.startswith("v") else raw
    if not version or any(c.isspace() or c == "_" for c in version):
        fail("unusable package.json version: %r" % raw)
    return raw, version


def target_for(rel):
    """Map a tarball member (below qmanager_install/) to its payload path."""
    if rel in ("install.sh", "uninstall.sh"):
        return SHARE + "/" + rel
    if rel == "out/index.html":
        return SHARE + "/index.html"
    if rel.startswith("out/"):
        return "www/" + rel[len("out/"):]
    if rel == "dependencies/qmanager_atd":
        return "usr/bin/qmanager_atd"
    if rel.startswith("scripts/etc/qmanager/"):
        return SHARE + "/defaults/" + rel[len("scripts/etc/qmanager/"):]
    for src in ("scripts/www/cgi-bin/quecmanager/", "scripts/usr/bin/",
                "scripts/usr/lib/qmanager/", "scripts/etc/init.d/",
                "scripts/etc/nftables.d/", "scripts/etc/sysctl.d/"):
        if rel.startswith(src):
            return rel[len("scripts/"):]
    return None


def main():
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tarball", default=os.path.join(repo, "qmanager-build", "qmanager.tar.gz"))
    ap.add_argument("--out", default=os.path.join(repo, "qmanager-build", "ipk-source"))
    args = ap.parse_args()

    if not os.path.isfile(args.tarball):
        fail("%s not found (run bun run package first)" % args.tarball)
    raw_version, version = read_version(repo)

    pkg_dir = os.path.join(args.out, PACKAGE)
    shutil.rmtree(pkg_dir, ignore_errors=True)
    root = os.path.join(pkg_dir, "root")
    control = os.path.join(pkg_dir, "CONTROL")
    os.makedirs(control)

    payload = {}
    unmapped = []
    with tarfile.open(args.tarball, "r:gz") as tar:
        for member in tar.getmembers():
            name = member.name
            if name.startswith("./"):
                name = name[2:]
            if not name.startswith("qmanager_install/"):
                continue
            rel = name[len("qmanager_install/"):]
            if not rel or member.isdir():
                continue
            target = target_for(rel)
            if target is None:
                unmapped.append(rel)
                continue
            if member.issym():
                payload[target] = ("link", member.linkname)
            elif member.isfile():
                payload[target] = ("file", tar.extractfile(member).read())
    if unmapped:
        fail("tarball members with no package path: " + ", ".join(sorted(unmapped)[:10]))
    for must in ("www/cgi-bin/quecmanager", "usr/bin/qmanager_atd", "usr/lib/qmanager",
                 "etc/init.d/qmanager", SHARE + "/install.sh", SHARE + "/index.html"):
        if not any(p == must or p.startswith(must + "/") for p in payload):
            fail("payload is missing " + must)
    if "www/index.html" in payload:
        fail("www/index.html would collide with luci-base")

    stamp = 'VERSION="%s"' % raw_version
    if stamp.encode() not in payload[SHARE + "/install.sh"][1]:
        fail("install.sh in the tarball is not stamped %s" % stamp)

    manifest_path = SHARE + "/manifest"
    manifest = "\n".join(sorted(set(payload) | {manifest_path})) + "\n"
    payload[manifest_path] = ("file", manifest.encode())

    installed_size = 0
    for target, (kind, data) in payload.items():
        dest = os.path.join(root, *target.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if kind == "link":
            os.symlink(data, dest)
        else:
            with open(dest, "wb") as fh:
                fh.write(data)
            installed_size += len(data)

    install_sh = payload[SHARE + "/install.sh"][1].decode("utf-8").replace("\r\n", "\n")
    shebang, _, body = install_sh.partition("\n")
    if not shebang.startswith("#!"):
        fail("install.sh has no shebang")
    preinst = ("#!/bin/sh\n"
               "# opkg preinst: install.sh, entered at ipk_preinst (stop services,\n"
               "# retire legacy features) before opkg unpacks the new files.\n"
               "QM_INSTALL_ENTRY=ipk_preinst\n" + body)

    control_text = "\n".join([
        "Package: " + PACKAGE,
        "Version: " + version,
        "Depends: " + DEPENDS,
        "Conflicts: " + CONFLICTS,
        "Replaces: " + CONFLICTS,
        "Source: " + SOURCE,
        "Section: utils",
        "Architecture: " + ARCH,
        "Installed-Size: %d" % installed_size,
        "Maintainer: " + MAINTAINER,
        "Description: " + DESCRIPTION,
    ]) + "\n"
    for name, text in (("control", control_text), ("preinst", preinst),
                       ("postinst", POSTINST), ("prerm", PRERM), ("postrm", POSTRM)):
        with open(os.path.join(control, name), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)

    print("%s %s: %d payload files, %.1f MB installed -> %s"
          % (PACKAGE, version, len(payload), installed_size / 1048576.0, pkg_dir))


if __name__ == "__main__":
    main()
