# Item 13: SSR hold on a slow ("quiet") ping profile. Ping interval 10 s and
# act_after_sec 30: the ladder is only reached 30 s into the outage, and the MPSS
# crash line is 65 s old by then. The old 45 s look-back always expired first, so
# the hold never engaged; the window is now grace + act_after_eff + 8 +
# 2 * 10 = 45 + 30 + 8 + 20 = 103 s, so the hold engages (no AT command),
# and the link returning on its own at pass 7 clears it.
SC_PASSES=12
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.act_after_sec 30
    mset ping_interval 10
}
sc_pass_2() { mset reachable false; }
sc_pass_4() { dmesg_crash 65; }
sc_pass_7() { mset reachable true; }
