# R3 follow-up: max_reboots_per_hour clamp table (pass 1 extra): 0 -> 1,
# 99 -> 10, garbage -> 3, empty -> 3, leading zeros are stripped before the
# length check ("0000001" -> 1, "007" -> 7, "0010" -> 10), 1000 -> 10.
SC_PASSES=1
sc_snap_extra() {
    for _t_v in 0 1 7 10 11 99 1000 abc "" 0000001 007 0010; do
        uci_set quecmanager.watchcat.max_reboots_per_hour "$_t_v"
        read_config
        echo "max_reboots_per_hour='$_t_v' -> $CFG_MAX_REBOOTS_PER_HOUR"
    done
}
