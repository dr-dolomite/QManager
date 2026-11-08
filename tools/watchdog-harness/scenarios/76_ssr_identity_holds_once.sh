# R1: one hold per SSR identity. An outage meets a fresh MPSS crash: the ladder
# holds for the grace (10 s here) and the link comes back on its own during the
# hold. It drops again while the same crash line is still inside the SSR window
# (10 + 15 + 8 + 20 = 53 s): the identity already held, so the second
# escalation goes straight to Tier 1, no second hold. (R5: the 30 s minimum
# step wait no longer leaves room for a Tier 1 cooldown before the second drop,
# so the first outage now ends by itself.)
SC_PASSES=10
sc_setup() {
    uci_set quecmanager.watchcat.ssr_grace_sec 10
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_3() { dmesg_crash 5; }
sc_pass_4() { mset reachable true; }
sc_pass_5() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "ssr_hold=$ssr_hold held_id=$_wd_ssr_held_id"
}
