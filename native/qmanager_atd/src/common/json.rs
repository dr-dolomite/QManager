//! JSON string escaping shared by the qcmd -j output and the qsms envelopes.

/// JSON string escaping as jq emits it: \" \\ \b \f \n \r \t, other control
/// chars and DEL as \u00XX, everything else (UTF-8) verbatim.
pub fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_quotes_and_controls() {
        assert_eq!(json_escape("a\"b\\c\u{1b}\u{7f}é"), "a\\\"b\\\\c\\u001b\\u007fé");
    }
}
