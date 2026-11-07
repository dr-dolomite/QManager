# R1: one hold per SSR identity. An outage meets a fresh MPSS crash: the ladder
# holds for the grace (10 s here), Tier 1 then restores the link. The link drops
# again while the same crash line is still inside the SSR window
# (10 + 15 + 8 + 20 = 53 s; it is 47 s old at the second trigger): the identity
# already held, so the second escalation goes straight to Tier 1, no second hold.
SC_PASSES=10
sc_setup() {
    uci_set quecmanager.watchcat.ssr_grace_sec 10
    uci_set quecmanager.watchcat.cooldown 10
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_3() { dmesg_crash 5; }
sc_pass_6() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "ssr_hold=$ssr_hold held_id=$_wd_ssr_held_id"
}
