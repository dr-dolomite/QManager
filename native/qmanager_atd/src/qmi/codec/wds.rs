//! WDS (service 1) decoders. Fixtures from the RM551E, 2026-10-22.
//!
//! - 0x002A Get Profile List  TLV 0x01 `{n u8; type u8, index u8, name_len
//!   u8, name}`. Names only: the APN is not in this message.

use super::{text, Rd};
use crate::qmi::msg::Msg;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Profile {
    /// 0 = 3GPP, 1 = 3GPP2, 2 = EPC.
    pub profile_type: u8,
    pub index: u8,
    pub name: Option<String>,
}

pub fn profile_list(m: &Msg) -> Vec<Profile> {
    let mut out = Vec::new();
    let mut r = match m.tlv(0x01) {
        Some(v) => Rd::new(v),
        None => return out,
    };
    for _ in 0..r.u8().unwrap_or(0) {
        let p = (|| {
            let profile_type = r.u8()?;
            let index = r.u8()?;
            let l = r.u8()? as usize;
            Some(Profile { profile_type, index, name: text(r.take(l)?) })
        })();
        match p {
            Some(p) => out.push(p),
            None => break,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::{fx, mangled};

    #[test]
    fn profile_list_fixture() {
        let p = profile_list(&fx!("r1_1_0x002A"));
        assert_eq!(p.len(), 3);
        assert_eq!((p[0].profile_type, p[0].index, p[0].name.as_deref()), (0, 1, Some("profile1")));
        assert_eq!((p[1].index, p[1].name.as_deref()), (2, Some("profile2")));
        assert_eq!((p[2].index, p[2].name.clone()), (3, None));
    }

    #[test]
    fn truncated_tlvs_never_panic() {
        for base in crate::qmi::codec::testfix::all() {
            for m in mangled(&base) {
                let _ = profile_list(&m);
            }
        }
    }
}
