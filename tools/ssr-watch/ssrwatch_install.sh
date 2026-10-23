#!/bin/sh
# ssrwatch_install.sh <stage_dir>: install the SSR watcher (dev-only, runs ON
# the device, BusyBox ash). <stage_dir> holds ssrwatch.sh,
# ssrwatch_summary.sh and ssr_watch.init. Every write is temp + sync + mv +
# sync. A watch in progress is kept (state and ssr.log are not touched).
#
# It also keeps the rollback broker on flash: /tmp/qm_atd_041 (tmpfs, lost on
# reboot) is copied to $DIR/qmanager_atd.041 when its md5 is the 0.4.1 build.

S=${1:-}
[ -n "$S" ] && [ -d "$S" ] || { echo "usage: ssrwatch_install.sh <stage_dir>" >&2; exit 2; }
DIR=/usrdata/ssr_watch
BIN=$DIR/bin
MD5_041=14112f99eb2a68dce66db6f3aa5ce90b

for f in ssrwatch.sh ssrwatch_summary.sh ssr_watch.init; do
    [ -f "$S/$f" ] || { echo "ssrwatch_install: $S/$f missing" >&2; exit 1; }
    sh -n "$S/$f" || { echo "ssrwatch_install: $f fails sh -n" >&2; exit 1; }
done

# _put <src> <dest> <mode>
_put() {
    cp "$1" "$2.new" || return 1
    chmod "$3" "$2.new"
    sync
    mv -f "$2.new" "$2"
    sync
}

mkdir -p "$BIN" || exit 1

_put "$S/ssrwatch.sh" "$BIN/ssrwatch.sh" 755 || exit 1
_put "$S/ssrwatch_summary.sh" "$BIN/ssrwatch_summary.sh" 755 || exit 1
_put "$S/ssr_watch.init" /etc/init.d/ssr_watch 755 || exit 1

if [ ! -f "$DIR/qmanager_atd.041" ] && [ -f /tmp/qm_atd_041 ] &&
    [ "$(md5sum /tmp/qm_atd_041 | cut -d' ' -f1)" = "$MD5_041" ]; then
    _put /tmp/qm_atd_041 "$DIR/qmanager_atd.041" 755 || exit 1
fi

/etc/init.d/ssr_watch enable
/etc/init.d/ssr_watch restart
sync

echo "ssrwatch_install: done"
md5sum "$BIN/ssrwatch.sh" "$BIN/ssrwatch_summary.sh" /etc/init.d/ssr_watch "$DIR/qmanager_atd.041" 2>&1
ls -l /etc/rc.d/ | grep ssr_watch
