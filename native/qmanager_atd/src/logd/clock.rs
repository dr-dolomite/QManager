//! Mono → wall anchor: a port of History's `_hist_clock` (docs/features/
//! history.md §5). `t = mono + offset` only while trusted; trusted means wall
//! ≥ 1700000000, wall ≥ newest record − 120 s, and uptime ≥ 300 s or a step
//! already seen this boot. A drift beyond ±120 s re-anchors; a step behind
//! the newest record drops trust until the wall clock catches up.

pub const SANE_EPOCH: i64 = 1_700_000_000;
pub const STEP_TOL: i64 = 120;
pub const SETTLE: i64 = 300;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Change {
    None,
    /// Trust arrived (or came back): back-date the untrusted rows.
    Trusted,
    /// A step beyond the tolerance moved the anchor.
    Reanchored,
    /// The wall clock stepped behind the newest record: rows wait for trust.
    Lost,
}

#[derive(Debug, Clone)]
pub struct Clock {
    pub trusted: bool,
    pub off: i64,
    /// Offset seen at the last untrusted tick (step detection before trust).
    uoff: Option<i64>,
    pub stepped: bool,
    /// The newest record's wall time (state `last_wall` at start, then every
    /// trusted row).
    pub floor: i64,
}

impl Clock {
    pub fn new(floor: i64) -> Clock {
        Clock { trusted: false, off: 0, uoff: None, stepped: false, floor }
    }

    /// Wall time of a row taken at `mono` seconds, if trusted.
    pub fn wall_of(&self, mono: i64) -> Option<i64> {
        self.trusted.then_some(mono + self.off)
    }

    /// Records that a row was stamped with `t` (raises the floor).
    pub fn note(&mut self, t: i64) {
        if t > self.floor {
            self.floor = t;
        }
    }

    /// One observation of (wall, mono seconds).
    pub fn tick(&mut self, wall: i64, mono: i64) -> Change {
        if self.trusted {
            if wall < SANE_EPOCH {
                return Change::None;
            }
            let d = (wall - mono - self.off).abs();
            if d <= STEP_TOL {
                return Change::None;
            }
            self.stepped = true;
            if wall < self.floor - STEP_TOL {
                self.trusted = false;
                self.uoff = Some(wall - mono);
                return Change::Lost;
            }
            self.off = wall - mono;
            return Change::Reanchored;
        }
        let uo = wall - mono;
        if let Some(prev) = self.uoff {
            if (uo - prev).abs() > STEP_TOL {
                self.stepped = true;
            }
        }
        self.uoff = Some(uo);
        if wall < SANE_EPOCH || wall < self.floor - STEP_TOL {
            return Change::None;
        }
        if mono < SETTLE && !self.stepped {
            return Change::None;
        }
        self.trusted = true;
        self.off = uo;
        Change::Trusted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Ported from tools/history-test/history-test.sh (cases 1, 2, 5, 8, 14a,
    // 14b): wall = mono + WOFF, cycles of 2 s.
    const W0: i64 = 1_794_187_800;

    fn cycles(c: &mut Clock, mono: &mut i64, woff: i64, n: i64) -> Vec<Change> {
        (0..n)
            .map(|_| {
                *mono += 2;
                c.tick(*mono + woff, *mono)
            })
            .collect()
    }

    #[test]
    fn a_1970_boot_waits_then_a_step_trusts_before_the_settle() {
        let mut c = Clock::new(0);
        let mut mono = 0;
        // 1. Untrusted boot clock (1970).
        cycles(&mut c, &mut mono, 0, 50);
        assert!(!c.trusted, "untrusted at 1970");
        assert_eq!(c.wall_of(mono), None);
        // 2. NITZ step to real time at mono 100 (< settle, but a step was seen).
        let woff = W0 - 40;
        let ch = cycles(&mut c, &mut mono, woff, 5);
        assert_eq!(ch[0], Change::Trusted);
        assert!(c.trusted);
        assert_eq!(c.off, woff, "offset = wall - mono");
        // Back-dating: a row at mono 60 lands at its real time.
        assert_eq!(c.wall_of(60), Some(W0 + 20));
    }

    #[test]
    fn wobble_is_ignored_and_a_large_step_reanchors() {
        let mut c = Clock::new(0);
        let mut mono = 400;
        let mut woff = W0;
        cycles(&mut c, &mut mono, woff, 1);
        assert!(c.trusted, "sane wall after the settle trusts at once");
        let off0 = c.off;
        // 5. Small NITZ wobble (-80 s then back) never re-anchors.
        woff -= 80;
        assert!(cycles(&mut c, &mut mono, woff, 5).iter().all(|&x| x == Change::None));
        woff += 80;
        cycles(&mut c, &mut mono, woff, 5);
        assert_eq!(c.off, off0, "wobble ignored");
        // Exactly the tolerance is still a wobble.
        assert_eq!(c.tick(mono + woff + STEP_TOL, mono), Change::None);
        // 8. Large forward step re-anchors.
        woff += 7200;
        assert_eq!(cycles(&mut c, &mut mono, woff, 1)[0], Change::Reanchored);
        assert_eq!(c.off, woff, "forward step re-anchored");
        // An insane wall while trusted is ignored, not a step.
        assert_eq!(c.tick(5, mono), Change::None);
        assert!(c.trusted);
    }

    #[test]
    fn a_clock_behind_the_newest_record_is_refused() {
        // 14a. last_wall LW, the next boot's clock 900 s behind it.
        let lw = W0 + 5000;
        let mut c = Clock::new(lw);
        let mut mono = 0;
        cycles(&mut c, &mut mono, lw - 900, 160);
        assert!(!c.trusted, "clock behind last_wall refused");
        // 14b. Wall just past the last record: trusted once uptime passes the settle.
        let mut c = Clock::new(lw);
        let mut mono = 0;
        cycles(&mut c, &mut mono, lw + 30, 140);
        assert!(!c.trusted, "untrusted before the settle");
        cycles(&mut c, &mut mono, lw + 30, 20);
        assert!(c.trusted, "trusted at the settle");
        // Within the tolerance behind the floor still counts.
        let mut c = Clock::new(lw);
        assert_eq!(c.tick(lw - 100, 400), Change::Trusted);
    }

    #[test]
    fn a_step_behind_the_newest_record_drops_trust_until_wall_catches_up() {
        let mut c = Clock::new(0);
        assert_eq!(c.tick(W0 + 400, 400), Change::Trusted);
        c.note(W0 + 400);
        // SSR: the clock steps back 600 s.
        assert_eq!(c.tick(W0 - 200 + 2, 402), Change::Lost);
        assert!(!c.trusted);
        // Still behind the floor: nothing.
        assert_eq!(c.tick(W0 - 200 + 10, 410), Change::None);
        // NITZ puts it right: stepped already, trust returns at once.
        assert_eq!(c.tick(W0 + 412, 412), Change::Trusted);
        assert_eq!(c.off, W0);
    }

    #[test]
    fn an_untrusted_step_counts_as_seen_and_the_sane_floor_holds() {
        let mut c = Clock::new(0);
        // sysfixtime: a stale but sane /etc mtime, then NITZ steps forward.
        assert_eq!(c.tick(SANE_EPOCH + 10, 20), Change::None, "sane but before the settle");
        assert_eq!(c.tick(W0 + 22, 22), Change::Trusted, "the step counts");
        let mut c = Clock::new(0);
        assert_eq!(c.tick(SANE_EPOCH - 1, 500), Change::None, "below the sane epoch");
    }
}
