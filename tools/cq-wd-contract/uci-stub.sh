# uci-stub.sh - body of the `uci` stub run.sh puts first on PATH (RM551E runner).
# run.sh prepends the shebang and `UCI_DIR=<sandbox>/uci`. Implements only what
# qm_platform_cqwd.sh calls: get, show, set, add_list, delete, commit, revert,
# with UCI's staging semantics (writes go to a working copy that get/show see;
# commit publishes it, revert drops it) and its "Entry not found" failure for a
# key under a section that does not exist.
#
# Store format, one record per line, tab separated:
#   T <section> <type>        a section
#   S <section.key> <value>   a scalar option
#   L <section.key> <item>    one item of a list option (in order)

QUIET=0
if [ "$1" = "-q" ]; then
    QUIET=1
    shift
fi
CMD="$1"
ARG="$2"
DB="$UCI_DIR/db"
ST="$UCI_DIR/stage"
[ -f "$DB" ] || : > "$DB"

cur() {
    if [ -f "$ST" ]; then
        printf '%s' "$ST"
    else
        printf '%s' "$DB"
    fi
}

stage_open() {
    [ -f "$ST" ] || cp "$DB" "$ST"
}

die() {
    [ "$QUIET" = "1" ] || echo "uci: $1" >&2
    exit 1
}

# drop_key <file> <section.key>: remove its S and L records
drop_key() {
    awk -F'\t' -v k="$2" '!(($1 == "S" || $1 == "L") && $2 == k)' "$1" > "$1.n" && mv "$1.n" "$1"
}

has_section() {
    awk -F'\t' -v s="$2" '$1 == "T" && $2 == s { f = 1 } END { exit f ? 0 : 1 }' "$1"
}

K="${ARG#quecmanager.}"

case "$CMD" in
    get)
        F=$(cur)
        case "$K" in
            *.*) ;;
            *) has_section "$F" "$K"; exit $? ;;
        esac
        awk -F'\t' -v k="$K" '
            ($1 == "S" && $2 == k) { print $3; f = 1; exit }
            ($1 == "L" && $2 == k) { sep = (n++ ? " " : ""); a = a sep $3; f = 1 }
            END { if (a != "") print a; exit f ? 0 : 1 }' "$F"
        exit $?
        ;;
    show)
        F=$(cur)
        awk -F'\t' -v k="$K" '
            (($1 == "S" || $1 == "L") && $2 == k) { sep = (n++ ? " " : ""); out = out sep "\047" $3 "\047"; f = 1 }
            END { if (f) print "quecmanager." k "=" out; exit f ? 0 : 1 }' "$F"
        exit $?
        ;;
    set)
        KV="$ARG"
        K="${KV%%=*}"
        K="${K#quecmanager.}"
        V="${KV#*=}"
        stage_open
        case "$K" in
            *.*)
                has_section "$ST" "${K%%.*}" || die "Entry not found"
                drop_key "$ST" "$K"
                printf 'S\t%s\t%s\n' "$K" "$V" >> "$ST"
                ;;
            *)
                awk -F'\t' -v s="$K" '!($1 == "T" && $2 == s)' "$ST" > "$ST.n" && mv "$ST.n" "$ST"
                printf 'T\t%s\t%s\n' "$K" "$V" >> "$ST"
                ;;
        esac
        exit 0
        ;;
    add_list)
        KV="$ARG"
        K="${KV%%=*}"
        K="${K#quecmanager.}"
        V="${KV#*=}"
        stage_open
        case "$K" in
            *.*) ;;
            *) die "Invalid argument" ;;
        esac
        has_section "$ST" "${K%%.*}" || die "Entry not found"
        printf 'L\t%s\t%s\n' "$K" "$V" >> "$ST"
        exit 0
        ;;
    delete)
        stage_open
        case "$K" in
            *.*) drop_key "$ST" "$K" ;;
            *)
                awk -F'\t' -v s="$K" '!($1 == "T" && $2 == s) && !(($1 == "S" || $1 == "L") && index($2, s ".") == 1)' \
                    "$ST" > "$ST.n" && mv "$ST.n" "$ST"
                ;;
        esac
        exit 0
        ;;
    commit)
        [ -f "$ST" ] && mv "$ST" "$DB"
        exit 0
        ;;
    revert)
        rm -f "$ST"
        exit 0
        ;;
    *)
        die "Unsupported command: $CMD"
        ;;
esac
