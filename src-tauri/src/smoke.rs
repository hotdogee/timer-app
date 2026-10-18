//! The scripted desktop smoke test's hook (debug builds only; release builds do not contain it).
//!
//! The webview calls `smoke_mark` at the moments the smoke script measures ("ringing",
//! "notification shown", ...) when `import.meta.env.DEV`, and the script reads the timestamped
//! lines from the `tauri dev` output.

use std::time::{SystemTime, UNIX_EPOCH};

/// Every smoke line starts with this, so the script can find them in the output.
pub const PREFIX: &str = "[smoke]";

/// The longest message printed, in characters; longer ones are cut.
pub const MAX_MESSAGE_CHARS: usize = 500;

/// The civil date (year, month 1–12, day 1–31) of `days` days after 1970-01-01, in the proleptic
/// Gregorian calendar (Howard Hinnant's `civil_from_days`).
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153; // March = 0
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    // `day` is 1..=31 and `month` 1..=12, so the casts are exact.
    (year, month as u32, day as u32)
}

/// Formats `time` as an ISO 8601 UTC timestamp with milliseconds (`2026-10-18T09:32:34.123Z`), as
/// JavaScript's `Date.prototype.toISOString` does. Times before 1970 print as 1970-01-01.
pub fn iso_utc(time: SystemTime) -> String {
    let since_epoch = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = since_epoch.as_secs();
    let (year, month, day) = civil_from_days(i64::try_from(seconds / 86_400).unwrap_or(0));
    let second_of_day = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        second_of_day / 3_600,
        second_of_day % 3_600 / 60,
        second_of_day % 60,
        since_epoch.subsec_millis()
    )
}

/// The line printed for `message` at `time`: `[smoke] <ISO time> <message>`, the message on one
/// line (control characters become spaces) and at most [`MAX_MESSAGE_CHARS`] characters.
pub fn smoke_line(time: SystemTime, message: &str) -> String {
    let message: String = message
        .chars()
        .take(MAX_MESSAGE_CHARS)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    format!("{PREFIX} {} {message}", iso_utc(time))
}

/// Command `smoke_mark`, payload `{ message: string }`: prints [`smoke_line`] to stdout. Debug
/// builds only.
#[tauri::command]
pub fn smoke_mark(message: String) {
    println!("{}", smoke_line(SystemTime::now(), &message));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn at(millis: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_millis(millis)
    }

    #[test]
    fn formats_like_javascript_to_iso_string() {
        // Expected values from `new Date(ms).toISOString()`.
        assert_eq!(iso_utc(at(0)), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(at(951_782_400_000)), "2000-02-29T00:00:00.000Z");
        assert_eq!(iso_utc(at(951_868_799_999)), "2000-02-29T23:59:59.999Z");
        assert_eq!(iso_utc(at(1_709_164_800_500)), "2024-02-29T00:00:00.500Z");
        assert_eq!(iso_utc(at(1_792_315_954_123)), "2026-10-18T09:32:34.123Z");
        assert_eq!(iso_utc(at(4_102_444_800_000)), "2100-01-01T00:00:00.000Z");
    }

    #[test]
    fn times_before_1970_print_as_the_epoch() {
        let before = UNIX_EPOCH - Duration::from_secs(1);
        assert_eq!(iso_utc(before), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn converts_days_to_civil_dates_around_leap_years() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(civil_from_days(59), (1970, 3, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
        assert_eq!(civil_from_days(47_540), (2100, 2, 28));
        assert_eq!(civil_from_days(47_541), (2100, 3, 1));
    }

    #[test]
    fn prints_one_prefixed_line() {
        assert_eq!(
            smoke_line(at(1_792_315_954_123), "ringing card=a1"),
            "[smoke] 2026-10-18T09:32:34.123Z ringing card=a1"
        );
    }

    #[test]
    fn keeps_the_message_on_one_line_and_short() {
        assert_eq!(
            smoke_line(at(0), "a\nb\r\tc"),
            "[smoke] 1970-01-01T00:00:00.000Z a b  c"
        );
        let long = "é".repeat(MAX_MESSAGE_CHARS + 10);
        let line = smoke_line(at(0), &long);
        assert_eq!(
            line.chars().count(),
            "[smoke] 1970-01-01T00:00:00.000Z ".len() + MAX_MESSAGE_CHARS
        );
    }
}
