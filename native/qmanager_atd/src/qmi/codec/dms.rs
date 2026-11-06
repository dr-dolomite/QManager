//! DMS (service 2) decoders. Fixtures from the RM551E, 2026-10-22.
//!
//! - 0x0022 Get Model       TLV 0x01 string
//! - 0x0023 Get Revision    TLV 0x01 string
//! - 0x0025 Get IDs         TLV 0x10 ESN, 0x11 IMEI, 0x12 MEID, 0x13 IMEI SV
//!   (IMEI and the "28" software version seen on device; ESN/MEID are the
//!   standard layout, absent on an LTE-only modem)
//! - 0x002D Get Operating Mode  TLV 0x01 (TLV 0x10 / 0x11 not decoded)
//! - 0x002F Get Time        TLV 0x01 (TLV 0x10 / 0x11 not decoded)
//! - 0x0045 Get Band Capability  TLV 0x12 `{count u16; count x u16}` LTE band
//!   numbers, TLV 0x13 the same for NR (RM551E R02A01, NSA capture
//!   2026-11-06: the LTE list equals `AT+QNWPREFCFG="lte_band"`). TLV 0x01 /
//!   0x10 / 0x11 are legacy bitmasks and not decoded.

use super::{text, Rd};
use crate::qmi::msg::Msg;

pub fn string_tlv(m: &Msg) -> Option<String> {
    m.tlv(0x01).and_then(text)
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Ids {
    pub esn: Option<String>,
    pub imei: Option<String>,
    pub meid: Option<String>,
    pub imei_sv: Option<String>,
}

pub fn ids(m: &Msg) -> Ids {
    let s = |t: u8| m.tlv(t).and_then(text);
    Ids { esn: s(0x10), imei: s(0x11), meid: s(0x12), imei_sv: s(0x13) }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpMode {
    Online,
    LowPower,
    FactoryTest,
    Offline,
    Reset,
    ShuttingDown,
    PersistentLowPower,
    ModeOnlyLowPower,
    Other(u8),
}

impl OpMode {
    pub fn from_u8(v: u8) -> OpMode {
        match v {
            0 => OpMode::Online,
            1 => OpMode::LowPower,
            2 => OpMode::FactoryTest,
            3 => OpMode::Offline,
            4 => OpMode::Reset,
            5 => OpMode::ShuttingDown,
            6 => OpMode::PersistentLowPower,
            7 => OpMode::ModeOnlyLowPower,
            o => OpMode::Other(o),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            OpMode::Online => "online",
            OpMode::LowPower => "low_power",
            OpMode::FactoryTest => "factory_test",
            OpMode::Offline => "offline",
            OpMode::Reset => "reset",
            OpMode::ShuttingDown => "shutting_down",
            OpMode::PersistentLowPower => "persistent_low_power",
            OpMode::ModeOnlyLowPower => "mode_only_low_power",
            OpMode::Other(_) => "other",
        }
    }

    pub fn code(self) -> u8 {
        match self {
            OpMode::Online => 0,
            OpMode::LowPower => 1,
            OpMode::FactoryTest => 2,
            OpMode::Offline => 3,
            OpMode::Reset => 4,
            OpMode::ShuttingDown => 5,
            OpMode::PersistentLowPower => 6,
            OpMode::ModeOnlyLowPower => 7,
            OpMode::Other(o) => o,
        }
    }
}

pub fn op_mode(m: &Msg) -> Option<OpMode> {
    m.tlv(0x01).and_then(|v| Rd::new(v).u8()).map(OpMode::from_u8)
}

/// TLV 0x01 `{count u48, source u16}`. The count is in 1.25 ms units since
/// the GPS epoch (1980-01-06); verified: it converts to the capture date,
/// and TLV 0x10 (the same instant in ms) agrees to within 1 ms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeviceTime {
    pub ms_since_gps_epoch: u64,
    pub source: u16,
}

/// Unix seconds of the GPS epoch.
pub const GPS_EPOCH_UNIX: i64 = 315_964_800;

impl DeviceTime {
    /// Unix seconds, taking the modem's count at face value. The 18 s of
    /// GPS-UTC leap seconds are NOT applied (unconfirmed whether the modem
    /// counts them), so this may lead true UTC by up to 18 s.
    pub fn unix_s(&self) -> i64 {
        (self.ms_since_gps_epoch / 1000) as i64 + GPS_EPOCH_UNIX
    }
}

pub fn time(m: &Msg) -> Option<DeviceTime> {
    let mut r = Rd::new(m.tlv(0x01)?);
    let b = r.take(6)?;
    let mut a = [0u8; 8];
    a[..6].copy_from_slice(b);
    let count = u64::from_le_bytes(a);
    Some(DeviceTime { ms_since_gps_epoch: count * 5 / 4, source: r.u16()? })
}

/// Most entries kept per list (a modem lists 32 LTE / 36 NR bands).
const MAX_BANDS: usize = 128;

/// Band numbers (not NAS enums) in the modem's order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BandCaps {
    pub lte: Vec<u16>,
    pub nr: Vec<u16>,
}

/// The declared count is bounded by what the TLV actually holds: a short
/// list yields the entries that are there.
fn band_list(v: &[u8]) -> Vec<u16> {
    let mut r = Rd::new(v);
    let mut out = Vec::new();
    for _ in 0..r.u16().unwrap_or(0).min(MAX_BANDS as u16) {
        match r.u16() {
            Some(b) => out.push(b),
            None => break,
        }
    }
    out
}

pub fn band_caps(m: &Msg) -> BandCaps {
    BandCaps { lte: m.tlv(0x12).map(band_list).unwrap_or_default(), nr: m.tlv(0x13).map(band_list).unwrap_or_default() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::{fx, mangled};

    #[test]
    fn strings() {
        assert_eq!(string_tlv(&fx!("r1_2_0x0022")).as_deref(), Some("RM551E-GL"));
        assert_eq!(string_tlv(&fx!("r1_2_0x0023")).as_deref(), Some("RM551EGL00AAR02A01M8G"));
    }

    #[test]
    fn ids_fixture() {
        // The IMEI is synthetic in the committed fixture.
        let i = ids(&fx!("r1_2_0x0025"));
        assert_eq!(i.imei.as_deref(), Some("490154203237518"));
        assert_eq!(i.imei_sv.as_deref(), Some("28"));
        assert_eq!((i.esn, i.meid), (None, None));
    }

    #[test]
    fn op_mode_fixture() {
        let m = op_mode(&fx!("r1_2_0x002D")).unwrap();
        assert_eq!((m, m.as_str(), m.code()), (OpMode::Online, "online", 0));
        assert_eq!(OpMode::from_u8(1).as_str(), "low_power");
        assert_eq!(OpMode::from_u8(99).as_str(), "other");
    }

    #[test]
    fn time_fixture_is_the_capture_date() {
        let t = time(&fx!("r1_2_0x002F")).unwrap();
        // TLV 0x10 carries the same instant in ms (1476664831456, 1 ms off).
        assert_eq!(t.ms_since_gps_epoch, 1_476_664_831_455);
        // Captured 2026-10-22 00:40 UTC.
        assert!((1_792_620_000..1_792_700_000).contains(&t.unix_s()), "{}", t.unix_s());
        assert_eq!(t.source, 0);
    }

    #[test]
    fn band_caps_fixture() {
        let b = band_caps(&fx!("nsa_2_0x0045"));
        assert_eq!(b.lte.len(), 32);
        assert_eq!(&b.lte[..8], &[1, 2, 3, 4, 5, 7, 8, 12]);
        assert_eq!(&b.lte[29..], &[66, 70, 71]);
        assert_eq!(b.nr.len(), 36);
        assert_eq!(&b.nr[..4], &[1, 2, 3, 5]);
        assert_eq!(&b.nr[32..], &[257, 258, 260, 261]);
    }

    #[test]
    fn a_band_count_larger_than_the_tlv_never_reads_past_it() {
        let mut m = fx!("nsa_2_0x0045");
        for t in m.tlvs.iter_mut() {
            if t.t == 0x12 {
                t.v.truncate(2 + 2 * 3); // declares 32, holds 3
            }
            if t.t == 0x13 {
                t.v = vec![0xff, 0xff, 1, 0, 2, 0];
            }
        }
        let b = band_caps(&m);
        assert_eq!(b.lte, vec![1, 2, 3]);
        assert_eq!(b.nr, vec![1, 2]);
        m.tlvs.retain(|t| t.t != 0x12 && t.t != 0x13);
        assert_eq!(band_caps(&m), BandCaps::default());
    }

    #[test]
    fn truncated_tlvs_never_panic() {
        for base in crate::qmi::codec::testfix::all() {
            for m in mangled(&base) {
                let _ = band_caps(&m);
                let _ = string_tlv(&m);
                let _ = ids(&m);
                let _ = op_mode(&m);
                let _ = time(&m);
            }
        }
    }
}
