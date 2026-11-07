# Bad slots fall back to their own default with a warning; good ones are kept.
sc_setup() {
    h_cfg_list ping_profile.targets 9.9.9.9 -evil 'a;b' ''
}
sc_run() {
    load_config
    echo "slots: $PING_T1 $PING_T2 $PING_T3 $PING_T4"
    _h_long=$(awk 'BEGIN { s = ""; for (i = 0; i < 129; i++) s = s "a"; print s }')
    : > "$H_STATE/uci.db"
    h_cfg_list ping_profile.targets "$_h_long" my-host.example.org 'fe80::1%eth0'
    load_config
    echo "slots: $PING_T1 $PING_T2 $PING_T3 $PING_T4"
}
