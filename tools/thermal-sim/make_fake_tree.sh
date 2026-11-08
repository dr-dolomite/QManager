#!/bin/sh
# make_fake_tree.sh: dev-only. Copies the thermal sysfs layout into a plain
# directory so the poller's parse_thermal can be pointed at it and cur_state /
# temp edited by hand. Never installed (build.sh excludes tools/). POSIX sh,
# BusyBox ash, LF only.
#
# Usage (on the modem):
#   sh make_fake_tree.sh [src] [dst]       defaults: /sys/class/thermal /tmp/qm_thermal_fake
#
# What it copies:
#   cooling_deviceN/{type,max_state,cur_state}
#   thermal_zoneN/{type,temp,trip_point_K_temp,trip_point_K_type,cdevM_trip_point}
#   thermal_zoneN/cdevM -> ../cooling_deviceX   (a relative symlink, like sysfs)
# A sensor whose temp cannot be read is copied as an empty file (the parser
# treats empty as "no reading").
#
# Run the poller against it (init.d does not pass QM_THERMAL_ROOT, so run the
# poller by hand for the test, then restart the service):
#   /etc/init.d/qmanager stop
#   QM_THERMAL_ROOT=/tmp/qm_thermal_fake /usr/bin/qmanager_poller >/dev/null 2>&1 &
#   echo 40 > /tmp/qm_thermal_fake/cooling_device10/cur_state     # modem_nr_dsc
#   echo 105000 > /tmp/qm_thermal_fake/thermal_zone23/temp        # mdmss-0, 6 C below trip
#   jq .thermal /tmp/qmanager_status.json                          # within ~10 s
#   echo 0 > /tmp/qm_thermal_fake/cooling_device10/cur_state
#   kill <poller pid>; /etc/init.d/qmanager start
# Device and zone numbers are firmware specific: check the type files first
# (grep . /tmp/qm_thermal_fake/*/type). Discovery runs once per poller start,
# so a change to the links or trips needs a poller restart; cur_state and temp
# are read every sample.

SRC="${1:-/sys/class/thermal}"
DST="${2:-/tmp/qm_thermal_fake}"

[ -d "$SRC" ] || { echo "make_fake_tree: no such dir: $SRC" >&2; exit 2; }
case "$DST" in
    /tmp/*) ;;
    *) echo "make_fake_tree: refusing a target outside /tmp: $DST" >&2; exit 2 ;;
esac

rm -rf "$DST"
mkdir -p "$DST" || exit 1

ndev=0
for d in "$SRC"/cooling_device*; do
    [ -d "$d" ] || continue
    n="${d##*/}"
    mkdir "$DST/$n" || exit 1
    for f in type max_state cur_state; do
        cat "$d/$f" > "$DST/$n/$f" 2>/dev/null
    done
    ndev=$((ndev + 1))
done

nzone=0
nlink=0
for z in "$SRC"/thermal_zone*; do
    [ -d "$z" ] || continue
    n="${z##*/}"
    mkdir "$DST/$n" || exit 1
    for f in "$z"/type "$z"/temp "$z"/trip_point_*_temp "$z"/trip_point_*_type "$z"/cdev*_trip_point; do
        [ -f "$f" ] || continue
        cat "$f" > "$DST/$n/${f##*/}" 2>/dev/null
    done
    for l in "$z"/cdev*; do
        c="${l##*/}"
        case "$c" in cdev*_*) continue ;; esac
        [ -L "$l" ] || continue
        t=$(readlink "$l")
        t="${t##*/}"
        [ -d "$DST/$t" ] || continue
        ln -s "../$t" "$DST/$n/$c" && nlink=$((nlink + 1))
    done
    nzone=$((nzone + 1))
done

echo "fake thermal tree: $DST ($ndev cooling devices, $nzone zones, $nlink bindings)"
echo "use: QM_THERMAL_ROOT=$DST"
