# load_config resolves the contract table: every name, the pre-rename `profile`
# key as a fallback, `sensitivity` winning over it, an unknown name reading as
# relaxed, no config at all reading as relaxed, and interval_override ignored.
sc_setup() { :; }
_sc_show() {
    load_config
    echo "$1: sens=$PING_SENS interval=$PING_INTERVAL fail=$PING_FAIL_SECS recover=$PING_RECOVER_SECS ring=$HISTORY_SIZE"
}
sc_run() {
    _sc_show "none"
    for _s in sensitive regular relaxed quiet; do
        : > "$H_STATE/uci.db"
        h_cfg ping_profile.sensitivity "$_s"
        _sc_show "$_s"
    done
    : > "$H_STATE/uci.db"
    h_cfg ping_profile.profile quiet
    _sc_show "old profile key"
    h_cfg ping_profile.sensitivity regular
    _sc_show "sensitivity beats profile"
    : > "$H_STATE/uci.db"
    h_cfg ping_profile.sensitivity bogus
    _sc_show "unknown name"
    : > "$H_STATE/uci.db"
    h_cfg ping_profile.sensitivity sensitive
    h_cfg ping_profile.interval_override 30
    _sc_show "interval_override ignored"
}
