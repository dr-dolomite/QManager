#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
. /usr/lib/qmanager/apn_mgr.sh
# =============================================================================
# apn.sh — CGI Endpoint: APN Settings (GET + POST), AT-only
# =============================================================================
# RM551E-GL / RM520N-GL have no Casa RDB key-value store and no wmmd daemon, so
# every live profile field is sourced directly from AT commands through qcmd.
#
# MODEL (single APN): the device keeps the same 5-slot JSON sidecar
# (/usrdata/qmanager/apn_profiles.json, v2), but this surface treats SLOT 1 as
# the single user APN. Slots 2–5 go unused. active=1 means a custom APN is
# live; active=0 means carrier-default. All boot-reconcile, reapply, and Custom
# SIM Profile authority machinery already key off "the active slot," so they
# continue to work unchanged with no migration needed.
#
# Separately, the GET response still surfaces the modem's raw context table
# (CIDs 1-6) under `cids`, with IMS/SOS contexts TAGGED (not dropped) via
# apn_type_of(), so the UI can show what each hardware context currently holds.
#
# "Active CID" (the live WAN-bearing context) is derived inline from the
# AT+QMAP="WWAN" / AT+CGPADDR sections of one compound query — never via
# detect_active_cid(), which would re-query and negate the single round-trip.
#
# GET  -> { active, active_cid, internet_cid, apn{apn,pdp_type,cid}, cids[6] }
# POST -> {"action":"save"|"deactivate", ...} applies a change.
#
# AT commands used (GET):
#   AT+CGDCONT?;+CGACT?;+CGPADDR;+QMAP="WWAN"   -> one round-trip, four sections
#     +CGDCONT: defined PDP contexts (CID, PDP type, APN)
#     +CGACT:   per-context activation state
#     +CGPADDR: per-CID assigned IP (active-CID fallback)
#     +QMAP:    authoritative WAN CID + IP
#
# AT commands used (POST save):
#   AT+COPS=2                            -> deregister  (force full detach)
#   AT+CGDCONT=<cid>,"<PDP_AT>","<apn>"  -> define APN + PDP type
#   AT+COPS=0                            -> re-register (attaches with new APN)
#
# AT commands used (POST deactivate):
#   AT+COPS=2                            -> deregister
#   AT+CGDCONT=<cid>,"<PDP_AT>",""      -> blank APN (forces carrier default)
#   AT+COPS=0                            -> re-register
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/apn.sh
# Install location: <docroot>/cgi-bin/quecmanager/cellular/apn.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_apn"
cgi_headers
cgi_handle_options

# =============================================================================
# Helpers
# =============================================================================
# v2 config I/O (MAX_SLOTS, MAX_CID, PROFILE_FILE, LEGACY_NAME_FILE, EMPTY_V2,
# pdp_to_at/pdp_to_frontend, normalize_v2, read_config_v2, write_config_v2),
# the COPS apply cycle (apply_apn_to_modem, cops_recover) and the active-slot
# reapply helper all live in /usr/lib/qmanager/apn_mgr.sh (sourced above).

# die <error_code> <detail> — emit a JSON error and stop. CGI exits 0; the
# client distinguishes success via the "success" field, not the HTTP status.
die() {
    qlog_error "$1: ${2:-}"
    cgi_error "$1" "${2:-}"
    exit 0
}

# Carrier-provisioned APN classification (case-insensitive substring match).
# IMS (VoLTE) and SOS/emergency/XCAP/RCS contexts are operator-managed. Unlike
# the prior version, a non-empty result no longer DROPS the row — it only TAGS
# the modem-context entry under `cids` so the UI can label it.
apn_type_of() {
    _at_lc=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
    case "$_at_lc" in
        *ims*)                               echo "ims" ;;
        *sos*|*emergency*|*xcap*|*rcs*)      echo "emergency" ;;
        *)                                   echo "" ;;
    esac
}

# =============================================================================
# GET — slot-1 APN + raw modem context table
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching APN settings (v2 slot-1, AT)"

    # One compound call. Each qcmd invocation carries a fixed per-call cost
    # (process spawn + flock + modem channel handshake) that dominates the AT
    # payload itself; chaining all four queries pays that cost once.
    blob=$(run_at 'AT+CGDCONT?;+CGACT?;+CGPADDR;+QMAP="WWAN"')
    # The live read fails transiently right after a COPS attach (AT channel
    # busy -> run_at returns 1, empty stdout). A single immediate retry absorbs
    # that common case without adding latency to the happy path. A sustained
    # failure must surface honestly via die() -- returning active:1 with an
    # all-empty cids[] would make the frontend badge mis-read the stored APN as
    # a confirmed "Not live" mismatch.
    if [ -z "$blob" ]; then
        blob=$(run_at 'AT+CGDCONT?;+CGACT?;+CGPADDR;+QMAP="WWAN"')
    fi
    if [ -z "$blob" ]; then
        die "at_failed" "Could not read modem PDP contexts"
    fi
    cgdcont_raw=$(printf '%s\n' "$blob" | grep '+CGDCONT:')

    # --- Active CID (inline, NOT detect_active_cid which re-queries) --------
    # Copied verbatim from profiles/current_settings.sh: CGPADDR collects CIDs
    # with a valid 4-octet IPv4 (first octet > 0); QMAP is authoritative (first
    # non-zero IP wins); CGPADDR is the fallback; default "1".
    cgpaddr_cids=$(printf '%s\n' "$blob" | awk -F'[,"]' '
        /\+CGPADDR:/ {
            cid = $1; gsub(/[^0-9]/, "", cid)
            ip = $3
            if (ip != "" && ip != "0.0.0.0" && ip !~ /^0+(\.0+)*$/) {
                split(ip, octets, ".")
                if (length(octets) == 4 && octets[1]+0 > 0) {
                    print cid
                }
            }
        }
    ')
    qmap_cid=$(printf '%s\n' "$blob" | awk -F',' '
        /\+QMAP:/ {
            gsub(/"/, "", $5)
            ip = $5
            cid = $3
            gsub(/[^0-9]/, "", cid)
            if (ip != "" && ip != "0.0.0.0" && ip != "0:0:0:0:0:0:0:0") {
                print cid
                exit
            }
        }
    ')
    if [ -n "$qmap_cid" ]; then
        active_cid="$qmap_cid"
    elif [ -n "$cgpaddr_cids" ]; then
        active_cid=$(printf '%s\n' "$cgpaddr_cids" | head -1)
    else
        active_cid="1"
    fi

    # --- Modem context table (cids[]): every CID 1..MAX_CID, tagged ---------
    # No carrier-skip: IMS/SOS contexts are kept and TAGGED via apn_type_of so
    # the UI can label them. apn = live CGDCONT string ("" if undefined),
    # is_internet = (cid == active_cid). Streamed as TSV (apn last column; it
    # may legitimately be empty) then assembled with jq for correct typing.
    cids_tsv=""
    cid=1
    while [ "$cid" -le "$MAX_CID" ]; do
        cgd_line=$(printf '%s\n' "$cgdcont_raw" | grep "^+CGDCONT: $cid,")
        live_apn=""
        if [ -n "$cgd_line" ]; then
            live_apn=$(printf '%s' "$cgd_line" | awk -F'"' '{print $4}')
        fi
        apn_type=$(apn_type_of "$live_apn")
        [ "$cid" = "$active_cid" ] && is_internet=1 || is_internet=0
        # 4 columns: cid, apn_type, is_internet, apn. apn is LAST because it can
        # be empty — a trailing empty field survives the awk/split round-trip.
        cids_tsv="${cids_tsv}${cid}	${apn_type}	${is_internet}	${live_apn}
"
        cid=$((cid + 1))
    done

    cids_json=$(printf '%s' "$cids_tsv" | jq -Rsc '
        split("\n") | map(select(length > 0) | split("\t") | {
            cid:         (.[0] | tonumber),
            apn_type:    (if .[1] == null then "" else .[1] end),
            is_internet: (.[2] == "1"),
            apn:         (if .[3] == null then "" else .[3] end)
        })')
    [ -z "$cids_json" ] && die "parse_failed" "Could not assemble modem context list"

    # --- Slot-1 stored APN (the single user APN) ----------------------------
    # Read config; extract slot 1's fields. Always present (normalize_v2
    # guarantees all 5 slots exist). The `apn` object reflects whatever is
    # stored, even when active==0, so the form pre-fills with the last-saved
    # value without requiring a separate fetch.
    config_json=$(read_config_v2)
    active_ptr=$(printf '%s' "$config_json" | jq -r '.active')

    slot1_apn=$(printf '%s' "$config_json" | jq -r '
        .profiles[] | select(.id == 1) |
        if .apn == null then "" else .apn end')
    slot1_pdp=$(printf '%s' "$config_json" | jq -r '
        .profiles[] | select(.id == 1) |
        if .pdp_type == null then "ipv4v6" else .pdp_type end')
    slot1_cid=$(printf '%s' "$config_json" | jq -r '
        .profiles[] | select(.id == 1) |
        if .cid == null then 1 else .cid end')

    apn_obj=$(jq -n \
        --arg apn "$slot1_apn" \
        --arg pdp_type "$slot1_pdp" \
        --argjson cid "$slot1_cid" \
        '{ apn: $apn, pdp_type: $pdp_type, cid: $cid }')
    [ -z "$apn_obj" ] && die "parse_failed" "Could not assemble stored APN object"

    qlog_info "APN settings: active=$active_ptr active_cid=$active_cid apn=$slot1_apn"

    jq -n \
        --argjson apn_obj "$apn_obj" \
        --argjson cids "$cids_json" \
        --argjson active_ptr "$active_ptr" \
        --argjson active_cid "$active_cid" \
        '{
            success: true,
            active: $active_ptr,
            active_cid: $active_cid,
            internet_cid: $active_cid,
            apn: $apn_obj,
            cids: $cids
        }'
    exit 0
fi

# =============================================================================
# POST — {"action":"save"|"deactivate", ...}
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post
    ACTION=$(printf '%s' "$POST_DATA" | jq -r 'if .action == null then empty else .action end')

    # -----------------------------------------------------------------------
    # action: save — validate, write slot 1, always apply to modem, set active=1
    # -----------------------------------------------------------------------
    if [ "$ACTION" = "save" ]; then
        SLOT_CID=$(printf '%s' "$POST_DATA" | jq -r 'if .cid == null then "" else (.cid | tostring) end')
        APN=$(printf '%s' "$POST_DATA" | jq -r 'if .apn == null then "" else .apn end')
        PDP=$(printf '%s' "$POST_DATA" | jq -r 'if .pdp_type == null then "" else .pdp_type end')

        # --- Validate target cid (1..MAX_CID) ------------------------------
        case "$SLOT_CID" in
            ''|*[!0-9]*) die "invalid_cid" "cid must be an integer 1-${MAX_CID}" ;;
        esac
        if [ "$SLOT_CID" -lt 1 ] || [ "$SLOT_CID" -gt "$MAX_CID" ]; then
            die "invalid_cid" "cid must be 1-${MAX_CID}"
        fi

        # --- Validate apn + pdp_type ---------------------------------------
        [ -z "$APN" ] && die "missing_fields" "apn is required"
        case "$APN" in
            *'"'*) die "invalid_value" "APN may not contain a double-quote" ;;
        esac
        PDP_AT=$(pdp_to_at "$PDP")
        [ -z "$PDP_AT" ] && die "invalid_pdp_type" "pdp_type must be ipv4, ipv6, or ipv4v6"

        qlog_info "Save APN: apn=$APN pdp=$PDP_AT cid=$SLOT_CID"

        # --- Apply to the modem first (modem is the source of truth) --------
        # save always drives the COPS cycle — there is only one APN and it is
        # always meant to be live. Empty-APN slots are prevented by validation.
        apply_apn_to_modem "$SLOT_CID" "$PDP_AT" "$APN" || die "$APN_APPLY_ERR_CODE" "$APN_APPLY_ERR_DETAIL"

        # --- Persist slot 1 + set active=1 (best-effort after modem apply) --
        # If the modem write succeeded but the config write fails, still return
        # success: the modem is already live on the new APN. Emit a qlog_warn
        # so the issue is surfaced in the log; the hook's 1500ms reconcile
        # re-fetches live state. (Mirrors the existing activate action pattern.)
        config_json=$(read_config_v2)
        new_config=$(printf '%s' "$config_json" | jq -c \
            --arg apn "$APN" \
            --arg pdp "$PDP" \
            --argjson cid "$SLOT_CID" \
            '.profiles |= map(
                if .id == 1
                then { id: 1, name: "", apn: $apn, pdp_type: $pdp, cid: $cid }
                else . end
            ) | .active = 1' 2>/dev/null)
        if [ -n "$new_config" ] && write_config_v2 "$new_config"; then
            :
        else
            qlog_warn "Applied APN to modem but failed to persist slot 1 config"
        fi

        cgi_success
        exit 0
    fi

    # -----------------------------------------------------------------------
    # action: deactivate — revert the live modem to the carrier-default APN
    # (blank APN, carrier reassigns its default on re-attach) and set active=0.
    # No slot fields change; this is the deliberate inverse of save/activate.
    # -----------------------------------------------------------------------
    if [ "$ACTION" = "deactivate" ]; then
        config_json=$(read_config_v2)
        active_id=$(printf '%s' "$config_json" | jq -r '.active')

        # Already carrier-default: nothing to revert, do NOT touch the modem.
        if [ "$active_id" = "0" ]; then
            jq -n '{success: true, active: 0}'
            exit 0
        fi

        # --- Load the active slot's CID + PDP for the revert AT write -------
        SLOT_CID=$(printf '%s' "$config_json" | jq -r \
            --argjson id "$active_id" '.profiles[] | select(.id == $id) | .cid')
        SLOT_PDP=$(printf '%s' "$config_json" | jq -r \
            --argjson id "$active_id" '.profiles[] | select(.id == $id) | .pdp_type')

        PDP_AT=$(pdp_to_at "$SLOT_PDP")
        [ -z "$PDP_AT" ] && PDP_AT="IPV4V6"
        # Active config is normalized, but guard the CID before driving AT.
        case "$SLOT_CID" in
            ''|*[!0-9]*) SLOT_CID=1 ;;
        esac

        qlog_info "Deactivate: reverting slot $active_id (cid=$SLOT_CID) to carrier default; active=0"

        # --- Drive the modem first; empty APN -> carrier reassigns default --
        apply_apn_to_modem "$SLOT_CID" "$PDP_AT" "" || die "$APN_APPLY_ERR_CODE" "$APN_APPLY_ERR_DETAIL"

        # --- Persist active=0. A persist failure AFTER a successful modem
        # revert still reports success: the modem is already on carrier-default,
        # so failing the request would mislead the UI. Warn only.
        new_config=$(printf '%s' "$config_json" | jq -c '.active = 0' 2>/dev/null)
        if [ -n "$new_config" ] && write_config_v2 "$new_config"; then
            :
        else
            qlog_warn "Reverted slot $active_id on modem but failed to persist active=0"
        fi

        jq -n '{success: true, active: 0}'
        exit 0
    fi

    die "invalid_action" "action must be save or deactivate"
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
