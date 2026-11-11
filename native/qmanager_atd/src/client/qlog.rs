//! `qlog stat | logq k=v … | evq k=v … | clear`: the journal client. Prints logd's
//! JSON on stdout (exit 0, or 1 when logd answered a failure). Exit 3 with
//! nothing on stdout when logd is unreachable, so callers fall back to the
//! legacy path. Never runs anything in-process.

use crate::logd::server::{decode_answer, encode_request, Answer, REPLY_CAP};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

pub const EXIT_UNREACHABLE: i32 = 3;

/// One request: `Err(())` when logd cannot be reached or the reply is garbled.
pub fn call(sock: &str, verb: &str, args: &[String]) -> Result<Answer, ()> {
    let mut s = UnixStream::connect(sock).map_err(|_| ())?;
    s.set_read_timeout(Some(Duration::from_secs(5))).map_err(|_| ())?;
    s.set_write_timeout(Some(Duration::from_secs(2))).map_err(|_| ())?;
    s.write_all(&encode_request(verb, args)).map_err(|_| ())?;
    s.shutdown(std::net::Shutdown::Write).map_err(|_| ())?;
    let mut buf = Vec::new();
    s.take(REPLY_CAP as u64 + 64).read_to_end(&mut buf).map_err(|_| ())?;
    decode_answer(&buf).ok_or(())
}

pub fn run_qlog(args: &[String]) -> i32 {
    let usage = || {
        let _ = writeln!(std::io::stderr(), "usage: qlog stat | qlog logq [k=v ...] | qlog evq [k=v ...] | qlog clear | qlog --version");
        2
    };
    let (verb, rest) = match args.split_first() {
        Some((v, r)) if v == "--version" && r.is_empty() => {
            let _ = writeln!(std::io::stdout(), "{}", crate::logd::version_line());
            return 0;
        }
        Some((v, r)) if v == "stat" && r.is_empty() => ("STAT", r),
        Some((v, r)) if v == "clear" && r.is_empty() => ("LCLR", r),
        Some((v, r)) if v == "logq" => ("LOGQ", r),
        Some((v, r)) if v == "evq" => ("EVQ", r),
        _ => return usage(),
    };
    if rest.iter().any(|a| !a.contains('=') || a.contains('\0')) {
        return usage();
    }
    let sock = std::env::var("QLOGD_SOCK").unwrap_or_else(|_| "/var/run/qmanager_logd.sock".into());
    match call(&sock, verb, rest) {
        Ok(Answer::Res(ok, json)) => {
            let mut out = std::io::stdout().lock();
            let _ = out.write_all(json.as_bytes());
            let _ = out.write_all(b"\n");
            let _ = out.flush();
            if ok {
                0
            } else {
                1
            }
        }
        Ok(Answer::Err(code)) => {
            let _ = writeln!(std::io::stderr(), "qlog: {code}");
            1
        }
        Err(()) => EXIT_UNREACHABLE,
    }
}
