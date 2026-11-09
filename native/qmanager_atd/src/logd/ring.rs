//! The RAM ring: every kept row of this run, oldest first, bounded by row
//! count and by an estimate of the bytes it holds. Rows are a contiguous
//! suffix of the sequence space, so `s` is strictly increasing.

use super::record::Row;
use std::collections::VecDeque;

pub const MAX_ROWS: usize = 4096;
/// Rendered bytes (the RSS gate is 1.5 MB for the whole daemon).
pub const MAX_BYTES: usize = 768 * 1024;

pub struct Ring {
    rows: VecDeque<Row>,
    bytes: usize,
    pub max_rows: usize,
    pub max_bytes: usize,
}

impl Ring {
    pub fn new() -> Ring {
        Ring::with_bounds(MAX_ROWS, MAX_BYTES)
    }

    pub fn with_bounds(max_rows: usize, max_bytes: usize) -> Ring {
        Ring { rows: VecDeque::new(), bytes: 0, max_rows, max_bytes }
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    /// True if pushing a row of `cost` would evict the oldest row.
    pub fn would_evict(&self, cost: usize) -> bool {
        !self.rows.is_empty() && (self.rows.len() + 1 > self.max_rows || self.bytes + cost > self.max_bytes)
    }

    pub fn front(&self) -> Option<&Row> {
        self.rows.front()
    }

    /// Adds a row, evicting the oldest until the bounds hold.
    pub fn push(&mut self, row: Row) {
        self.bytes += row.cost();
        self.rows.push_back(row);
        while self.rows.len() > 1 && (self.rows.len() > self.max_rows || self.bytes > self.max_bytes) {
            if let Some(old) = self.rows.pop_front() {
                self.bytes -= old.cost();
            }
        }
    }

    /// Lowest sequence number held (None when empty).
    pub fn min_s(&self) -> Option<u64> {
        self.rows.front().map(|r| r.s)
    }

    /// Index of the first row with `s > after`.
    pub fn index_after(&self, after: u64) -> usize {
        self.rows.partition_point(|r| r.s <= after)
    }

    pub fn iter(&self) -> std::collections::vec_deque::Iter<'_, Row> {
        self.rows.iter()
    }

    pub fn range_from(&self, i: usize) -> std::collections::vec_deque::Iter<'_, Row> {
        self.rows.range(i..)
    }

    pub fn iter_mut_from(&mut self, i: usize) -> std::collections::vec_deque::IterMut<'_, Row> {
        self.rows.range_mut(i..)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::log::Level;
    use crate::logd::record::{Body, Names};

    fn row(s: u64, msg_len: usize) -> Row {
        let body = Body::Log { lv: Level::Info, c: "c".into(), p: 1, msg: "x".repeat(msg_len) };
        Row::build(s, 1, 0, None, &body, &mut Names::default())
    }

    #[test]
    fn evicts_by_rows() {
        let mut r = Ring::new();
        for s in 1..=(MAX_ROWS as u64 + 10) {
            r.push(row(s, 10));
        }
        assert_eq!(r.len(), MAX_ROWS);
        assert_eq!(r.min_s(), Some(11));
        assert_eq!(r.index_after(20), 10);
        assert_eq!(r.index_after(0), 0);
        assert_eq!(r.index_after(u64::MAX), MAX_ROWS);
    }

    #[test]
    fn evicts_by_bytes() {
        let mut r = Ring::new();
        // ~4 KB rows: the byte bound bites long before the row bound.
        for s in 1..=2000 {
            r.push(row(s, 4000));
        }
        assert!(r.bytes() <= MAX_BYTES, "{}", r.bytes());
        assert!(r.len() < 200 && r.len() > 180, "{}", r.len());
        assert_eq!(r.iter().last().unwrap().s, 2000);
        assert!(r.would_evict(5000));
        // One huge row is still kept alone.
        r.push(row(3000, MAX_BYTES + 10));
        assert_eq!(r.len(), 1);
    }
}
