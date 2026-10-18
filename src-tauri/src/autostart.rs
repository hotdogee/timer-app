//! Launch at login's Windows entry, quoted (Settings › Desktop).
//!
//! The autostart plugin (auto-launch 0.6) writes the `HKCU\…\CurrentVersion\Run` value as
//! `<exe> --minimized` without quotes, and has no option to change that. An installed app lives
//! under a path with spaces (`%LOCALAPPDATA%\Timer App\timer-app.exe`, or a user folder such as
//! `C:\Users\Ann Lee`), where an unquoted command line is ambiguous: Windows tries
//! `…\Local\Timer.exe` before the real program. So after the plugin turns launch at login on, the
//! webview calls [`quote_launch_entry`], and every start repairs an entry an earlier build wrote
//! ([`repair`]), rewriting the plugin's value as `"<exe>" --minimized`. macOS and Linux need
//! nothing: their launch entries keep the program and its arguments apart.

use tauri::{AppHandle, Runtime};

/// The Run value for `exe` that the plugin wrote unquoted (`exe` alone, or `exe`, a space and its
/// arguments), quoted: `"<exe>" <arguments>`. `None` when `current` is anything else (already
/// quoted, or a value this app did not write), which is left alone.
pub fn quoted_run_value(current: &str, exe: &str) -> Option<String> {
    if exe.is_empty() || exe.contains('"') {
        return None;
    }
    let rest = current.strip_prefix(exe)?;
    if !(rest.is_empty() || rest.starts_with(' ')) {
        return None;
    }
    Some(format!("\"{exe}\"{rest}"))
}

/// Command `quote_launch_entry`, no payload: quotes the program path in the Windows Run entry the
/// autostart plugin just wrote (see the module comment). Resolves to whether it rewrote the entry;
/// always false on macOS and Linux. Rejects with a message (a string) when the registry refuses.
#[tauri::command]
pub fn quote_launch_entry<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    os::quote(&app.package_info().name)
}

/// Quotes an entry an earlier build left unquoted; call it once at startup. Logs a failure and
/// carries on: the entry still works where the path has no spaces.
pub fn repair<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = os::quote(&app.package_info().name) {
        eprintln!("timer-app: could not quote the launch-at-login entry: {error}");
    }
}

#[cfg(windows)]
mod os {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
    use windows::Win32::System::Registry::{
        RegGetValueW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_SZ,
        RRF_RT_REG_SZ,
    };

    use super::quoted_run_value;

    /// The key the plugin writes, under `HKEY_CURRENT_USER` (or `HKEY_LOCAL_MACHINE` when the app
    /// runs elevated).
    const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";

    fn failed(what: &str, status: WIN32_ERROR) -> String {
        format!("could not {what} the Run entry (error {})", status.0)
    }

    /// The Run value `name` under `root`, or `None` when there is none.
    fn read(root: HKEY, name: &str) -> Result<Option<String>, String> {
        let key = HSTRING::from(RUN_KEY);
        let value = HSTRING::from(name);
        let mut size = 0u32;
        // SAFETY: the strings outlive the call; without a buffer it only reports the size.
        let status = unsafe {
            RegGetValueW(
                root,
                PCWSTR(key.as_ptr()),
                PCWSTR(value.as_ptr()),
                RRF_RT_REG_SZ,
                None,
                None,
                Some(&mut size),
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if status != ERROR_SUCCESS {
            return Err(failed("read", status));
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        // SAFETY: `buffer` holds at least `size` bytes, as the call is told.
        let status = unsafe {
            RegGetValueW(
                root,
                PCWSTR(key.as_ptr()),
                PCWSTR(value.as_ptr()),
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(failed("read", status));
        }
        let end = buffer
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(buffer.len());
        Ok(Some(String::from_utf16_lossy(&buffer[..end])))
    }

    /// Sets the Run value `name` under `root` to `data`.
    fn write(root: HKEY, name: &str, data: &str) -> Result<(), String> {
        let key = HSTRING::from(RUN_KEY);
        let value = HSTRING::from(name);
        let wide: Vec<u16> = data.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes =
            u32::try_from(wide.len() * 2).map_err(|_| "the entry is too long".to_owned())?;
        // SAFETY: `wide` is a NUL-terminated UTF-16 string of `bytes` bytes that outlives the call.
        let status = unsafe {
            RegSetKeyValueW(
                root,
                PCWSTR(key.as_ptr()),
                PCWSTR(value.as_ptr()),
                REG_SZ.0,
                Some(wide.as_ptr().cast()),
                bytes,
            )
        };
        if status == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(failed("write", status))
        }
    }

    /// Quotes the Run entry `name` wherever it is the plugin's unquoted one for this program.
    pub fn quote(name: &str) -> Result<bool, String> {
        let exe = std::env::current_exe()
            .map_err(|error| format!("could not find the program: {error}"))?
            // As the plugin writes it.
            .display()
            .to_string();
        let mut quoted = false;
        for (root, required) in [(HKEY_CURRENT_USER, true), (HKEY_LOCAL_MACHINE, false)] {
            // The machine-wide entry exists only when the app ran elevated; reading or writing it
            // otherwise may be refused, and that is no failure.
            let current = match read(root, name) {
                Ok(current) => current,
                Err(error) if required => return Err(error),
                Err(_) => continue,
            };
            let Some(fixed) = current.and_then(|current| quoted_run_value(&current, &exe)) else {
                continue;
            };
            match write(root, name, &fixed) {
                Ok(()) => quoted = true,
                Err(error) if required => return Err(error),
                Err(_) => {}
            }
        }
        Ok(quoted)
    }
}

#[cfg(not(windows))]
mod os {
    /// Nothing to quote outside Windows.
    pub fn quote(_name: &str) -> Result<bool, String> {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = r"C:\Users\Ann Lee\AppData\Local\Timer App\timer-app.exe";

    #[test]
    fn quotes_the_plugins_unquoted_entry() {
        assert_eq!(
            quoted_run_value(&format!("{EXE} --minimized"), EXE),
            Some(format!("\"{EXE}\" --minimized"))
        );
        assert_eq!(quoted_run_value(EXE, EXE), Some(format!("\"{EXE}\"")));
        assert_eq!(
            quoted_run_value(&format!("{EXE} --minimized --flag"), EXE),
            Some(format!("\"{EXE}\" --minimized --flag"))
        );
    }

    #[test]
    fn leaves_a_quoted_entry_alone() {
        assert_eq!(
            quoted_run_value(&format!("\"{EXE}\" --minimized"), EXE),
            None
        );
    }

    #[test]
    fn leaves_entries_for_another_program_alone() {
        assert_eq!(quoted_run_value(r"C:\Other\app.exe --minimized", EXE), None);
        // A longer path that merely starts with this one.
        assert_eq!(quoted_run_value(&format!("{EXE}2 --minimized"), EXE), None);
        assert_eq!(quoted_run_value("", EXE), None);
    }

    #[test]
    fn never_writes_a_path_it_cannot_quote() {
        assert_eq!(quoted_run_value("x --minimized", ""), None);
        assert_eq!(quoted_run_value("a\"b --minimized", "a\"b"), None);
    }
}
