//! Broker socket wire format. One request per connection, length-free, newline
//! never used as a delimiter (AT output is full of them). The client sends a
//! header line then the command bytes; the daemon replies with a status line
//! then the raw AT bytes.
//!
//! Request:  `REQ <nbytes> <sent_ms>\n` then exactly nbytes of command (no
//!           trailing LF). `sent_ms` is CLOCK_MONOTONIC (system-wide) when the
//!           client sent it, so the daemon knows how long it sat in the queue.
//!           A body shorter or longer than nbytes is refused, never executed.
//! Reply OK: `OK <nbytes>\n` then nbytes of raw AT output.
//! Reply ER: `ERR <code>\n` (nothing after).
//!
//! The daemon never applies JSON formatting to AT replies; the client does,
//! so the AT path stays a pure transport and its formatting lives in one place
//! (output.rs).
//!
//! SMS request (qsms): `SMS <nbytes> <sent_ms>\n` then exactly nbytes of the
//! client's arguments joined by NUL. argv strings cannot contain NUL, so any
//! message text (newlines, quotes, emoji) round-trips unambiguously. Same
//! refusal rules as REQ. Reply: `RES <0|1> <nbytes>\n<json>`, the finished
//! JSON envelope and whether it is a success; or `ERR <code>\n` as above.

use crate::at::output::Code;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;

pub const SOCKET_PATH: &str = "/var/run/qmanager_atd.sock";

/// Capability file, written by the daemon after it binds the socket and
/// removed by `init.d/qmanager_atd` stop. Scripts read it with a builtin
/// `read` instead of running the binary: an older `qmanager_atd` given any
/// argument starts a second daemon, and an older `qcmd` sends unknown flags to
/// the modem as a command.
pub const PROTO_PATH: &str = "/var/run/qmanager_atd.proto";

/// What the running broker and its `qcmd` understand.
/// 1: `REQ` / `SMS` (v0.1.32, no capability file).
/// 2: `qcmd -t <ms>` / `QCMD_WAIT_MS` client wait cap, `--version`.
pub const PROTO_VERSION: u32 = 2;

pub fn version_line() -> String {
    format!("qmanager_atd {} proto={}", env!("CARGO_PKG_VERSION"), PROTO_VERSION)
}

/// Writes the capability file as `<path>.new` (O_EXCL + O_NOFOLLOW, so a
/// planted link is never followed) and renames it over `path`.
pub fn write_proto_file(path: &str) -> std::io::Result<()> {
    let tmp = format!("{path}.new");
    // A leftover (or planted) tmp is removed, not followed: unlink acts on a
    // symlink itself.
    let _ = std::fs::remove_file(&tmp);
    let body = format!("proto={}\nversion={}\n", PROTO_VERSION, env!("CARGO_PKG_VERSION"));
    let written = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o644)
        .custom_flags(crate::common::safefs::NOFOLLOW)
        .open(&tmp)
        .and_then(|mut f| f.write_all(body.as_bytes()));
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, path)
}

pub enum Reply {
    Ok(Vec<u8>),
    Err(Code),
    /// SMS: a complete JSON envelope, and whether it reports success.
    Res(bool, Vec<u8>),
}

/// Milliseconds on CLOCK_MONOTONIC, shared by every process on the host.
pub fn mono_ms() -> u64 {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u64 * 1000 + ts.tv_nsec as u64 / 1_000_000
}

pub fn encode_request(cmd: &str, sent_ms: u64) -> Vec<u8> {
    let mut v = format!("REQ {} {}\n", cmd.len(), sent_ms).into_bytes();
    v.extend_from_slice(cmd.as_bytes());
    v
}

pub struct Request<'a> {
    pub cmd: &'a str,
    pub sent_ms: u64,
}

/// Splits a fully-read request buffer. None unless the header is well formed
/// and the body is exactly the announced length: a truncated or padded request
/// must never reach the modem.
pub fn decode_request(buf: &[u8]) -> Option<Request<'_>> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    let header = std::str::from_utf8(&buf[..nl]).ok()?;
    let mut it = header.split(' ');
    if it.next()? != "REQ" {
        return None;
    }
    let len: usize = it.next()?.parse().ok()?;
    let sent_ms: u64 = it.next()?.parse().ok()?;
    if it.next().is_some() {
        return None;
    }
    let body = &buf[nl + 1..];
    if body.len() != len {
        return None;
    }
    Some(Request { cmd: std::str::from_utf8(body).ok()?, sent_ms })
}

pub fn encode_sms_request(args: &[String], sent_ms: u64) -> Vec<u8> {
    let body = args.join("\0");
    let mut v = format!("SMS {} {}\n", body.len(), sent_ms).into_bytes();
    v.extend_from_slice(body.as_bytes());
    v
}

pub struct SmsRequest {
    pub args: Vec<String>,
    pub sent_ms: u64,
}

/// SMS counterpart of `decode_request`, with the same exact-length rule.
pub fn decode_sms_request(buf: &[u8]) -> Option<SmsRequest> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    let header = std::str::from_utf8(&buf[..nl]).ok()?;
    let mut it = header.split(' ');
    if it.next()? != "SMS" {
        return None;
    }
    let len: usize = it.next()?.parse().ok()?;
    let sent_ms: u64 = it.next()?.parse().ok()?;
    if it.next().is_some() {
        return None;
    }
    let body = &buf[nl + 1..];
    if body.len() != len {
        return None;
    }
    let body = std::str::from_utf8(body).ok()?;
    Some(SmsRequest { args: body.split('\0').map(str::to_string).collect(), sent_ms })
}

pub fn encode_reply(reply: &Reply) -> Vec<u8> {
    match reply {
        Reply::Ok(raw) => {
            let mut v = format!("OK {}\n", raw.len()).into_bytes();
            v.extend_from_slice(raw);
            v
        }
        Reply::Err(code) => format!("ERR {}\n", code.as_str()).into_bytes(),
        Reply::Res(ok, body) => {
            let mut v = format!("RES {} {}\n", if *ok { 0 } else { 1 }, body.len()).into_bytes();
            v.extend_from_slice(body);
            v
        }
    }
}

/// Parses a fully-read reply buffer.
pub fn decode_reply(buf: &[u8]) -> Option<Reply> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    let header = std::str::from_utf8(&buf[..nl]).ok()?;
    let body = &buf[nl + 1..];
    let mut it = header.splitn(2, ' ');
    match it.next()? {
        "OK" => {
            let n: usize = it.next()?.parse().ok()?;
            if body.len() >= n {
                Some(Reply::Ok(body[..n].to_vec()))
            } else {
                None
            }
        }
        "ERR" => Code::parse(it.next()?).map(Reply::Err),
        "RES" => {
            let mut f = it.next()?.split(' ');
            let ok = match f.next()? {
                "0" => true,
                "1" => false,
                _ => return None,
            };
            let n: usize = f.next()?.parse().ok()?;
            (body.len() >= n).then(|| Reply::Res(ok, body[..n].to_vec()))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_with_newlines_in_command() {
        // AT commands don't contain \n, but be robust anyway.
        let r = encode_request("AT+QENG=\"servingcell\"\nX", 42);
        let d = decode_request(&r).unwrap();
        assert_eq!(d.cmd, "AT+QENG=\"servingcell\"\nX");
        assert_eq!(d.sent_ms, 42);
    }

    #[test]
    fn truncated_or_padded_request_is_refused() {
        let r = encode_request("AT+QCFG=\"band\",0,1", 7);
        assert!(decode_request(&r[..r.len() - 3]).is_none());
        let mut padded = r.clone();
        padded.extend_from_slice(b"X");
        assert!(decode_request(&padded).is_none());
        assert!(decode_request(b"REQ\nAT").is_none());
        assert!(decode_request(b"REQ 2\nAT").is_none());
    }

    #[test]
    fn ok_reply_preserves_raw_bytes_including_newlines() {
        let raw = b"AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n".to_vec();
        let enc = encode_reply(&Reply::Ok(raw.clone()));
        match decode_reply(&enc).unwrap() {
            Reply::Ok(got) => assert_eq!(got, raw),
            _ => panic!("expected OK"),
        }
    }

    #[test]
    fn err_reply_round_trips() {
        let enc = encode_reply(&Reply::Err(Code::ModemBusy));
        match decode_reply(&enc).unwrap() {
            Reply::Err(c) => assert_eq!(c, Code::ModemBusy),
            _ => panic!("expected ERR"),
        }
    }

    #[test]
    fn sms_request_round_trips_any_text() {
        let args: Vec<String> = ["send", "4917", "line1\nline2 \"q\" \u{1F600} SMS 3 4\n"].iter().map(|s| s.to_string()).collect();
        let r = encode_sms_request(&args, 9);
        let d = decode_sms_request(&r).unwrap();
        assert_eq!(d.args, args);
        assert_eq!(d.sent_ms, 9);
        // An SMS request is never mistaken for an AT one, nor the reverse.
        assert!(decode_request(&r).is_none());
        assert!(decode_sms_request(&encode_request("AT", 1)).is_none());
    }

    #[test]
    fn truncated_sms_request_is_refused() {
        let r = encode_sms_request(&["send".into(), "1".into(), "hello".into()], 1);
        assert!(decode_sms_request(&r[..r.len() - 1]).is_none());
        let mut padded = r.clone();
        padded.push(b'x');
        assert!(decode_sms_request(&padded).is_none());
    }

    #[test]
    fn res_reply_round_trips() {
        for ok in [true, false] {
            let body = b"{\"success\":true,\"msg\":[]}\n".to_vec();
            match decode_reply(&encode_reply(&Reply::Res(ok, body.clone()))).unwrap() {
                Reply::Res(o, b) => {
                    assert_eq!(o, ok);
                    assert_eq!(b, body);
                }
                _ => panic!("expected RES"),
            }
        }
        assert!(decode_reply(b"RES 2 0\n").is_none());
        assert!(decode_reply(b"RES 0 5\nab").is_none());
    }

    #[test]
    fn proto_file_is_replaced_and_never_follows_a_planted_link() {
        let dir = std::env::temp_dir().join(format!("qm_proto_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("p.proto");
        let p = path.to_str().unwrap();
        std::fs::write(&path, "stale\n").unwrap();
        // A link planted at the tmp name must not redirect the write.
        let victim = dir.join("victim");
        std::fs::write(&victim, "keep\n").unwrap();
        std::os::unix::fs::symlink(&victim, dir.join("p.proto.new")).unwrap();
        write_proto_file(p).unwrap();
        let got = std::fs::read_to_string(&path).unwrap();
        assert!(got.starts_with(&format!("proto={PROTO_VERSION}\nversion=")), "{got:?}");
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep\n");
        assert!(!dir.join("p.proto.new").exists());
        // Rewriting is idempotent.
        write_proto_file(p).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), got);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn version_line_names_the_protocol() {
        assert!(version_line().starts_with("qmanager_atd "));
        assert!(version_line().ends_with(&format!(" proto={PROTO_VERSION}")));
    }

    #[test]
    fn partial_ok_body_is_incomplete() {
        let raw = b"ABCDEF".to_vec();
        let mut enc = encode_reply(&Reply::Ok(raw));
        enc.truncate(enc.len() - 2);
        assert!(decode_reply(&enc).is_none());
    }
}
