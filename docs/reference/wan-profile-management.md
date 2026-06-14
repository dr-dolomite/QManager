> ⚠️ SUPERSEDED: This document described the original multi-slot, per-CID WAN profile model that was removed in v0.1.27. It is kept for historical reference only.
>
> The current APN feature is documented in **[`docs/features/apn-management.md`](../features/apn-management.md)**.

---

# WAN Profile Management (Historical — Superseded)

The content below reflects the pre-v0.1.27 design. Several aspects remain accurate as background context for the shared library (`apn_mgr.sh`) and the COPS detach/attach requirement; the rest is obsolete.

**What changed:** The 5-slot radio-select model was replaced by a single APN setting backed by slot 1 of the same `apn_profiles.json` v2 file. The `activate` and `clear` POST actions were removed. The GET response no longer returns `profiles[]` or `max_profiles`. The frontend was rewritten from `wan-profile-list.tsx` + `wan-profile-edit.tsx` into `apn-settings-card.tsx`, and the hook/types were renamed from `use-wan-profiles.ts` / `wan-profiles.ts` to `use-apn-settings.ts` / `apn-settings.ts`.

**Still accurate from this doc:**
- The "Why save requires a full attach cycle" section (COPS detach/attach rationale and the EPS bearer contract) — unchanged behavior, unchanged rationale.
- The IMS/SOS carrier-provisioned context explanation.
- The APN gating by active SIM Profile section (behavior preserved; component names changed).

---

## Why save requires a full attach cycle

**Short version:** in EPS (LTE / 5G-NSA), the APN for the default EPS bearer
is locked in at *attach time* as a contract field with the MME (the LTE core's
control-plane gateway) and the PGW (the packet gateway that issues the IP).
`AT+CGDCONT` only updates the modem's local context table; it does not
renegotiate that contract. The network keeps the old APN until the UE
(modem) sends a fresh Attach Request — which only happens after a detach.

An earlier version of `apn.sh` tried to apply APN changes with a per-context
deactivate/reactivate cycle (`AT+CGACT=0,<cid>` → `AT+CGACT=1,<cid>`). That
was wrong: `AT+CGACT` can renegotiate *secondary* or *dedicated* bearers, but
it cannot rewrite the default bearer's APN, because cycling the user-plane
does not produce a new Attach Request. Empirically verified on Smart PH on
2026-05-20: with CGACT cycling, `AT+CGCONTRDP=1` kept returning the old
APN/IP until a full `COPS=2`/`COPS=0` cycle forced a fresh attach.

The save flow therefore detaches the radio with `AT+COPS=2`, writes
`AT+CGDCONT`, then re-attaches with `AT+COPS=0`. Verified on hardware: after
the new flow, `AT+CGCONTRDP=1` returns a brand-new IP from a different PGW
subnet, proving the bearer was torn down and rebuilt at the network level.

> ⚠️ WARNING: Save briefly drops the **cellular WAN** while the modem detaches
> and re-attaches (typically ~5–10 seconds). The CGI itself runs on the
> modem's web server reached over LAN/Wi-Fi, so SSH and the QManager HTTP
> session to the modem are **not** dropped.

---

## Carrier-provisioned contexts (IMS / SOS)

CIDs 2 and 3 typically ship from the carrier as the IMS (VoLTE) context and the
SOS (emergency) context. `apn.sh` tags these with `apn_type` `"ims"` and
`"emergency"` respectively. The CID picker in the single-APN form retains this
tagging and requires AlertDialog confirmation before a tagged CID can be
selected.

---

## Related

- [`docs/features/apn-management.md`](../features/apn-management.md) — current feature doc.
