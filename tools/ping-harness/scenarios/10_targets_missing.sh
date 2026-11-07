# No targets list at all (before the migration) reads as the four defaults,
# silently; a short list keeps what it has and defaults the rest.
sc_run() {
    load_config
    echo "no list: $PING_T1 $PING_T2 $PING_T3 $PING_T4"
    h_cfg_list ping_profile.targets 9.9.9.9 dns.quad9.net
    load_config
    echo "two items: $PING_T1 $PING_T2 $PING_T3 $PING_T4"
    : > "$H_STATE/uci.db"
    load_config
    echo "cleared: $PING_T1 $PING_T2 $PING_T3 $PING_T4"
}
