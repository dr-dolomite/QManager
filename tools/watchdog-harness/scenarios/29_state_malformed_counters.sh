# Item 5: write_state coerces numeric/boolean globals before --argjson, so a
# corrupted counter yields valid JSON instead of an empty/stale state file, and
# always carries mono + stale_after (3 * check_interval + 60 = 120 at 20 s).
# write_state_busy writes the same file with stale_after = 600 (checked in the
# extra block, which restores the normal heartbeat afterwards).
SC_PASSES=3
sc_setup() {
    uci_set quecmanager.watchcat.check_interval 20
}
sc_post_source() {
    total_recoveries=abc
    last_recovery_tier=""
    last_recovery_time="12x"
    cooldown_remaining="-5"
    step_wait_until="9x"
    tiers_tried="1 x 9 2"
    original_sim_slot="x"
    current_sim_slot="007"
    quality_breach_since="1.5"
    ssr_hold="maybe"
    last_ssr_detected="soon"
}
sc_snap_extra() {
    if jq -e . "$H_ROOT/tmp/qmanager_watchcat.json" > /dev/null 2>&1; then
        echo "state json valid: yes"
    else
        echo "state json valid: NO"
    fi
    echo "stale_after: $(jq -r .stale_after "$H_ROOT/tmp/qmanager_watchcat.json")"
    echo "mono: $(jq -r .mono "$H_ROOT/tmp/qmanager_watchcat.json")"
    write_state_busy
    echo "busy stale_after: $(jq -r .stale_after "$H_ROOT/tmp/qmanager_watchcat.json")"
    write_state
    echo "restored stale_after: $(jq -r .stale_after "$H_ROOT/tmp/qmanager_watchcat.json")"
}
