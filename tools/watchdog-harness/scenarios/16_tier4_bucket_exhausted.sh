# Only Tier 4 enabled and the hourly reboot bucket is already full (3 watchdog
# rows in the last hour; a user row and an old row must not count): Tier 4
# rests, which leaves no eligible tier: gate none, no event, no pause, no reboot.
SC_PASSES=12
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    crash_log_add 4000 tier4_escalation
    crash_log_add 300 tier4_escalation
    crash_log_add 200 tier4_escalation
    crash_log_add 100 tier4_escalation
    crash_log_add 50 user_reboot
}
sc_pass_2() { mset reachable false; }
