#!/bin/sh
# check.sh - verify the Connection Quality x Watchdog neutral files against
# manifest.sha256 (dev-only, never installed).
#
#   check.sh            recompute and diff; exit 1 on any mismatch
#   check.sh --update   rewrite the manifest after an INTENTIONAL change to a
#                       neutral file (then copy the same change to the other
#                       repo, so both manifests stay equal)
#
# The neutral set must stay byte-identical between the RM551E and RM520N repos;
# only scripts/usr/lib/qmanager/qm_platform_cqwd.sh may differ (spec
# docs/plans/2026-11-07-cq-watchdog-unified-architecture.md section 7).
# Paths in the manifest are relative to the repo root. POSIX sh.

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
MANIFEST="$HERE/manifest.sha256"

FILES="scripts/usr/bin/qmanager_ping
scripts/usr/bin/qmanager_watchcat
scripts/usr/lib/qmanager/conn_state.sh
scripts/usr/lib/qmanager/wd_config.sh
scripts/usr/lib/qmanager/wd_state.sh
scripts/usr/lib/qmanager/wd_detect.sh
scripts/usr/lib/qmanager/wd_quality.sh
scripts/usr/lib/qmanager/wd_carrier.sh
scripts/usr/lib/qmanager/wd_tiers.sh
scripts/usr/lib/qmanager/wd_sim.sh
scripts/usr/lib/qmanager/wd_ledger.sh"

compute() {
    cd "$REPO" || exit 2
    for f in $FILES; do
        [ -f "$f" ] || { echo "check.sh: missing $f" >&2; exit 2; }
        _h=$(sha256sum < "$f") || exit 2
        printf '%s  %s\n' "${_h%% *}" "$f"
    done
}

case "$1" in
    --update)
        compute > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST" || exit 2
        echo "updated $MANIFEST"
        exit 0
        ;;
    '') ;;
    *) sed -n '2,10p' "$0"; exit 2 ;;
esac

[ -f "$MANIFEST" ] || { echo "check.sh: no manifest (run check.sh --update)" >&2; exit 2; }
compute > "$HERE/.actual.$$" || { rm -f "$HERE/.actual.$$"; exit 2; }
if diff "$MANIFEST" "$HERE/.actual.$$"; then
    rm -f "$HERE/.actual.$$"
    echo "cq-wd-parity: OK (11 neutral files match the manifest)"
    exit 0
fi
rm -f "$HERE/.actual.$$"
echo "cq-wd-parity: MISMATCH (intentional? rerun check.sh --update and sync the other repo)" >&2
exit 1
