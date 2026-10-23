//! The read-only (service, message) allow-list, enforced inside the daemon:
//! the broker socket is the trust boundary, so a client can only ever reach
//! these Get messages. Nothing here writes modem configuration.
//!
//! From qmi_probe's WHITELIST minus WDS 0x0024 (Get Packet Statistics) and
//! WDS 0x002D (Get Current Settings): both fail without data-session
//! ownership, and Data Used is parked. NAS 0x006C (Config Signal Info v2) is
//! a config write: it is broker-internal (`BROKER_CONFIG`, user-approved
//! 2026-10-22), applied by the daemon with compiled-in TLVs only, and never
//! reachable through the `QMI` verb / qcmd or the in-process fallback client.

use super::error::QmiError;
use super::{SVC_DMS, SVC_DSD, SVC_NAS, SVC_UIM, SVC_WDS};

pub const CLIENT_ALLOWED: &[(u32, u16)] = &[
    (SVC_NAS, 0x0020), // Get Signal Strength
    (SVC_NAS, 0x0024), // Get Serving System
    (SVC_NAS, 0x0031), // Get RF Band Info
    (SVC_NAS, 0x0034), // Get System Selection Preference
    (SVC_NAS, 0x0043), // Get Cell Location Info
    (SVC_NAS, 0x004D), // Get Sys Info
    (SVC_NAS, 0x004F), // Get Signal Info
    (SVC_NAS, 0x005A), // Get Tx Rx Info
    (SVC_NAS, 0x00AC), // Get LTE CPHY CA Info
    (SVC_DMS, 0x0022), // Get Model
    (SVC_DMS, 0x0023), // Get Revision
    (SVC_DMS, 0x0025), // Get IDs
    (SVC_DMS, 0x002D), // Get Operating Mode
    (SVC_DMS, 0x002F), // Get Time
    (SVC_UIM, 0x002F), // Get Card Status
    (SVC_UIM, 0x0047), // Get Slots Status
    (SVC_WDS, 0x002A), // Get Profile List
    (SVC_DSD, 0x0024), // Get System Status
];

/// NAS Indication Register: per-client state on our own socket (released
/// when it closes), changes no modem configuration. Reachable only through
/// the registry's internal API, never from a client request.
#[allow(dead_code)] // consumed by the phase 2 indication path
pub const NAS_INDICATION_REGISTER: u16 = 0x0003;
#[allow(dead_code)] // consumed by the phase 2 indication path
pub const INTERNAL_ONLY: &[(u32, u16)] = &[(SVC_NAS, NAS_INDICATION_REGISTER)];

/// NAS Config Signal Info v2: sets the report deltas that keep the modem's
/// shared signal cache (read by Get Signal Info 0x004F) live. Not persisted
/// by the modem (an SSR wipes it), so the registry replays it per socket.
pub const NAS_CONFIG_SIG_INFO2: u16 = 0x006C;
/// The only config write the broker itself may send; never in `CLIENT_ALLOWED`
/// or `INTERNAL_ONLY`, so no request path can reach it.
pub const BROKER_CONFIG: &[(u32, u16)] = &[(SVC_NAS, NAS_CONFIG_SIG_INFO2)];

pub fn client_allowed(svc: u32, msg: u16) -> bool {
    CLIENT_ALLOWED.contains(&(svc, msg))
}

#[allow(dead_code)] // consumed by the phase 2 indication path
pub fn internal_allowed(svc: u32, msg: u16) -> bool {
    client_allowed(svc, msg) || INTERNAL_ONLY.contains(&(svc, msg))
}

pub fn check_client(svc: u32, msg: u16) -> Result<(), QmiError> {
    if client_allowed(svc, msg) {
        Ok(())
    } else {
        Err(QmiError::Refused { svc, msg })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exactly_the_read_only_gets() {
        assert_eq!(CLIENT_ALLOWED.len(), 18);
        for &(s, m) in &[
            (SVC_NAS, 0x0020u16),
            (SVC_NAS, 0x00AC),
            (SVC_DMS, 0x0025),
            (SVC_UIM, 0x0047),
            (SVC_WDS, 0x002A),
            (SVC_DSD, 0x0024),
        ] {
            assert!(client_allowed(s, m), "{s}:{m:#06x}");
        }
        // Excluded on purpose, or writes.
        for &(s, m) in &[
            (SVC_WDS, 0x0024u16), // Get Packet Statistics (needs session ownership)
            (SVC_WDS, 0x002D),    // Get Current Settings (needs session ownership)
            (SVC_NAS, 0x006C),    // Config Signal Info v2 (config write)
            (SVC_NAS, 0x0033),    // Set System Selection Preference
            (SVC_DMS, 0x002E),    // Set Operating Mode
            (SVC_WDS, 0x0020),    // Start Network Interface
            (SVC_NAS, NAS_INDICATION_REGISTER),
            (99, 0x0020),
        ] {
            assert!(!client_allowed(s, m), "{s}:{m:#06x}");
            assert_eq!(check_client(s, m), Err(QmiError::Refused { svc: s, msg: m }));
        }
        assert!(internal_allowed(SVC_NAS, NAS_INDICATION_REGISTER));
        assert!(!internal_allowed(SVC_NAS, 0x006C));
        assert_eq!(BROKER_CONFIG, &[(SVC_NAS, 0x006C)]);
        assert!(!CLIENT_ALLOWED.contains(&BROKER_CONFIG[0]));
        assert!(!INTERNAL_ONLY.contains(&BROKER_CONFIG[0]));
        assert!(!internal_allowed(SVC_DMS, NAS_INDICATION_REGISTER));
    }
}
