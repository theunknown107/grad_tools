//! The Rust port of `apps/web/src/domain/timetable/`, slice 1: `subjectKey`, `readSlot`,
//! `normalizeSubjectToken` and `isWeekday`. Everything else in the unit stays in TypeScript
//! (kept in `rust-anything.json`) until a later slice ports it.
//!
//! JS semantics reproduced on purpose, each one checked by the recorded cases:
//! - `\s` in a JS regex (and `String.prototype.trim`) is the ECMAScript WhiteSpace and
//!   LineTerminator set, which includes U+FEFF and excludes U+0085. Rust's `char::is_whitespace`
//!   differs on both, so the set is spelled out in `is_js_space`.
//! - `\d` without the `u` flag is ASCII only, and `/i` without `u` never folds a non-ASCII
//!   character onto an ASCII one, so the patterns use explicit ASCII classes, not `(?i)` or `\d`.

#![forbid(unsafe_code)]

use std::sync::OnceLock;

use regex::Regex;

/// The ECMAScript `\s` set: WhiteSpace plus LineTerminator.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `text.replace(/\s+/g, replacement)`: every run of JS whitespace becomes `replacement`.
fn collapse_js_space(text: &str, replacement: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for c in text.chars() {
        if is_js_space(c) {
            if !in_run {
                out.push_str(replacement);
                in_run = true;
            }
        } else {
            out.push(c);
            in_run = false;
        }
    }
    out
}

/// Port of `subjectKey` (`apps/web/src/domain/timetable/primitives.ts:27`).
pub fn subject_key(code: String) -> Result<String, String> {
    Ok(collapse_js_space(&code, "").to_uppercase())
}

/// The `SLOT` pattern of `timetable-import.ts`, applied after whitespace runs became one space,
/// so `\s*` is ` *` here. The meridiem and `to` are ASCII case-insensitive, as JS `/i` is.
fn slot_pattern() -> &'static Regex {
    static SLOT: OnceLock<Regex> = OnceLock::new();
    SLOT.get_or_init(|| {
        const MERIDIEM: &str = r"[aApP]\.?[mM]\.?";
        let pattern = format!(
            r"([0-9]{{1,2}})[:.]([0-9]{{2}}) *({MERIDIEM})? *(?:[-–—]|[tT][oO]) *([0-9]{{1,2}})[:.]([0-9]{{2}}) *({MERIDIEM})?"
        );
        // INFALLIBLE: the pattern is a constant, and the unit test `slot_pattern_compiles` builds it.
        Regex::new(&pattern).expect("constant SLOT pattern")
    })
}

/// Port of the private `toClock`: a college timetable's hours as a 24-hour `HH:MM`.
fn to_clock(hour: u32, minute: u32, meridiem: Option<&str>) -> Option<String> {
    if minute > 59 || hour > 23 {
        return None;
    }
    let mut h = hour;
    let marker = meridiem.map(|m| m.to_ascii_lowercase().replace('.', ""));
    match marker.as_deref() {
        Some("pm") if h < 12 => h += 12,
        Some("am") if h == 12 => h = 0,
        None if h < 8 => h += 12,
        _ => {}
    }
    if h > 23 {
        return None;
    }
    Some(format!("{h:02}:{minute:02}"))
}

/// Port of `readSlot` (`apps/web/src/domain/timetable/timetable-import.ts:260`).
pub fn read_slot(text: String) -> Result<Option<serde_json::Value>, String> {
    let normalized = collapse_js_space(&text, " ");
    let Some(m) = slot_pattern().captures(&normalized) else {
        return Ok(None);
    };
    // The groups are one or two ASCII digits, so they always parse.
    let number = |i: usize| {
        m.get(i)
            .map_or(0, |g| g.as_str().parse::<u32>().unwrap_or(0))
    };
    let meridiem = |i: usize| m.get(i).map(|g| g.as_str());

    let Some(end) = to_clock(number(4), number(5), meridiem(6)) else {
        return Ok(None);
    };
    let (start_hour, start_minute) = (number(1), number(2));

    let start = match meridiem(3) {
        Some(marked) => match to_clock(start_hour, start_minute, Some(marked)) {
            Some(start) if start < end => start,
            _ => return Ok(None),
        },
        None => {
            // Nearest to the end: the same morning or the same afternoon, not yesterday.
            // `HH:MM` strings are ASCII, so `localeCompare` descending is byte order descending.
            let mut candidates: Vec<String> = [
                to_clock(start_hour, start_minute, Some("am")),
                to_clock(start_hour, start_minute, Some("pm")),
            ]
            .into_iter()
            .flatten()
            .filter(|value| *value < end)
            .collect();
            candidates.sort_by(|a, b| b.cmp(a));
            match candidates.into_iter().next() {
                Some(start) => start,
                None => return Ok(None),
            }
        }
    };
    Ok(Some(serde_json::json!({ "start": start, "end": end })))
}

/// Port of `normalizeSubjectToken` (`apps/web/src/domain/timetable/timetable-import.ts:759`).
pub fn normalize_subject_token(raw: String) -> Result<String, String> {
    let is_noise = |c: char| matches!(c, '\'' | '"' | ']');
    // .replace(/^[\s['"\]]+/, ''): leading border noise.
    let s = raw.trim_start_matches(|c: char| is_js_space(c) || c == '[' || is_noise(c));
    // .replace(/\s*\[[^\]]*\]?.*$/s, ''): from the whitespace run before the first '[' to the end.
    let s = match s.find('[') {
        Some(bracket) => s[..bracket].trim_end_matches(is_js_space),
        None => s,
    };
    // .replace(/['"\]]+/g, ' '): each run of stray quotes or brackets becomes one space.
    let mut cleaned = String::with_capacity(s.len());
    let mut in_run = false;
    for c in s.chars() {
        if is_noise(c) {
            if !in_run {
                cleaned.push(' ');
                in_run = true;
            }
        } else {
            cleaned.push(c);
            in_run = false;
        }
    }
    // .replace(/\s+/g, ' ').trim(): JS trim strips the same set as `\s`.
    Ok(collapse_js_space(&cleaned, " ")
        .trim_matches(is_js_space)
        .to_owned())
}

/// Port of `isWeekday` (`apps/web/src/domain/timetable/timetable-import.ts:2326`).
pub fn is_weekday(value: String) -> Result<bool, String> {
    Ok(matches!(
        value.as_str(),
        "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(text: &str) -> Option<(String, String)> {
        read_slot(text.to_owned()).ok().flatten().map(|v| {
            (
                v["start"].as_str().unwrap_or_default().to_owned(),
                v["end"].as_str().unwrap_or_default().to_owned(),
            )
        })
    }

    #[test]
    fn slot_pattern_compiles() {
        assert!(slot_pattern().is_match("9:00-9:55"));
    }

    #[test]
    fn the_end_tells_the_start_which_half_of_the_day_it_is_in() {
        assert_eq!(
            slot("11:50-12.10pm"),
            Some(("11:50".into(), "12:10".into()))
        );
        assert_eq!(slot("1:05-02:00pm"), Some(("13:05".into(), "14:00".into())));
        assert_eq!(
            slot("10:00 am to 10:55 am"),
            Some(("10:00".into(), "10:55".into()))
        );
        assert_eq!(
            slot("4:05 p.m to 5:00p.m"),
            Some(("16:05".into(), "17:00".into()))
        );
        assert_eq!(slot("11:00-10:00am"), None);
        assert_eq!(slot("10:00"), None);
    }

    #[test]
    fn js_whitespace_includes_the_bom_and_not_nel() {
        assert!(is_js_space('\u{FEFF}'));
        assert!(!is_js_space('\u{85}'));
        assert_eq!(subject_key(" bcs\u{FEFF} 502 ".into()), Ok("BCS502".into()));
    }

    #[test]
    fn a_bracketed_note_and_stray_quotes_are_dropped() {
        assert_eq!(
            normalize_subject_token("\"CN [Lab]".into()),
            Ok("CN".into())
        );
        assert_eq!(normalize_subject_token("ATC \"".into()), Ok("ATC".into()));
        /* The leading '[' is border noise; the ']' left behind becomes a space. */
        assert_eq!(
            normalize_subject_token("[note] CN".into()),
            Ok("note CN".into())
        );
    }
}
