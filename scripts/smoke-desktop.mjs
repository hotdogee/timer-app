#!/usr/bin/env node
/**
 * The desktop app's scripted smoke test (Windows): `pnpm smoke:desktop [--out <dir>]`.
 *
 * It starts `tauri dev` itself (the debug build, with Vite on port 5173), drives the real app and
 * checks what unit and end-to-end tests cannot: the shell. The webview is driven over the Chrome
 * DevTools Protocol (WebView2 is started with `--remote-debugging-port`), the windows and the
 * keyboard through Win32 (a PowerShell helper), and timings are read from the `[smoke]` lines the
 * debug build prints (`smoke_mark`, `src/state/desktop.svelte.ts`).
 *
 * Run 1 (`tauri dev`):
 * 1. The main window opens; the OS accent color is read and themes the app.
 * 2. A 60 s timer, started from the keyboard, rings within 1 s of its end while the window is
 *    hidden to the tray (closed while it runs); the notification call succeeds; the alarm sound
 *    starts; the tray icon brings the window back.
 * 3. The mini window opens on the card (`T`), floats on top, starts and pauses the card, and the
 *    main grid follows; Esc closes it.
 * 4. A global hotkey recorded in Settings › Desktop starts and pauses the last-used card while
 *    another app has the focus, which keeps it.
 * 5. Desktop sign-in (unless `--skip-sign-in`): the device code shown in Settings › Account is
 *    approved over HTTP by a signed-in user, the app keeps the bearer token in the OS credential
 *    store (the Windows Credential Manager) and nowhere else, the sync socket connects with it and
 *    a card made on the desktop reaches the server. Then the token is put back where M5 kept it
 *    (the device store, none in the OS store) and the page reloaded: the token moves into the OS
 *    store and leaves the device store, signed in throughout, and the next reload moves nothing.
 * 6. The main window is moved to a known place and closed with nothing running: the app quits
 *    and saves its window state.
 *
 * Run 2 (`tauri dev -- -- --minimized`, as the OS starts it at login):
 * 7. The app starts hidden to the tray; the token stored in run 1 signs it in and syncs (unless
 *    `--skip-sign-in`), and Sign out removes it from the OS store; an alarm in the never-shown
 *    window still sounds.
 * 8. A second instance exits at once and brings the first one's window back, at the place saved
 *    in run 1.
 *
 * The sync server for step 5 is `e2e/sync-server.ts` (wrangler dev on 8787, fresh local state).
 * The app's web storage lives in a fresh WebView2 data folder under the output folder, so the
 * developer's own cards and settings are untouched; its sign-in token goes to a credential of its
 * own (`TIMER_APP_TOKEN_ACCOUNT`, read by debug builds only), removed at the start and the end, so
 * a developer's own debug sign-in is untouched too; the window state file
 * (`%APPDATA%\com.timerapp.dev\.window-state.json`) is backed up and put back afterwards.
 *
 * Output (`--out`, default `test-results/smoke-desktop`): `report.md`, `report.json`, the
 * screenshots, and the logs of `tauri dev` and the sync server. Every process it starts is killed
 * with its whole tree at the end, also on failure or Ctrl+C. Ports 5173 and 8787 (and the CDP
 * port, 9333 by default) must be free, and no Timer App may be running.
 *
 * Options: `--out <dir>`, `--cdp-port <port>`, `--skip-sign-in`.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createConnection } from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const ROOT = path.resolve(import.meta.dirname, '..')
const TAURI_CLI = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const DEBUG_EXE = path.join(ROOT, 'src-tauri', 'target', 'debug', 'timer-app.exe')
const APP_ORIGIN = 'http://localhost:5173'
const MAIN_URL = `${APP_ORIGIN}/`
const SYNC_ORIGIN = 'http://127.0.0.1:8787'
const WINDOW_STATE = path.join(process.env.APPDATA ?? '', 'com.timerapp.dev', '.window-state.json')
/** WebView2's default switches in Tauri, kept when the smoke adds its own. */
const WEBVIEW_DEFAULT_ARGS = '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection'
/** Where run 1 leaves the main window (physical pixels), for run 2's restore check. */
const SAVED_RECT = { x: 160, y: 120, w: 1040, h: 720 }
/** The global hotkey recorded in Settings › Desktop, and its virtual keys for the OS. */
const HOTKEY = { text: 'Mod+Alt+Shift+F9', label: 'Ctrl+Alt+Shift+F9', vks: '11,12,10,78' }
/**
 * The OS credential store account the debug build keeps the sign-in token under in this run
 * (`TIMER_APP_TOKEN_ACCOUNT`), and its Windows Credential Manager entry: `<account>.<service>`.
 */
const TOKEN_ACCOUNT = 'sync-token-smoke'
const TOKEN_TARGET = `${TOKEN_ACCOUNT}.Timer App`

const { values: options } = parseArgs({
  options: {
    out: { type: 'string', default: path.join('test-results', 'smoke-desktop') },
    'cdp-port': { type: 'string', default: '9333' },
    'skip-sign-in': { type: 'boolean', default: false },
  },
})
const OUT = path.resolve(ROOT, options.out)
const CDP_PORT = Number(options['cdp-port'])
const WEBVIEW_DATA = path.join(OUT, 'webview-data')
/** Where test output belongs; the smoke empties an output folder there without asking. */
const TEST_RESULTS = path.join(ROOT, 'test-results')

/**
 * Why the output folder must not be emptied, or null when it may: the smoke deletes it before a
 * run, so it must not be the repository (or hold it), and outside `test-results/` it must be new,
 * empty, or an earlier run's output (it has `report.json`).
 */
function unsafeOutDir() {
  const inside = (folder, parent) => {
    const relative = path.relative(parent, folder)
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  }
  if (OUT === ROOT || inside(ROOT, OUT)) return `${OUT} is (or holds) the repository`
  if (inside(OUT, TEST_RESULTS) || !existsSync(OUT)) return null
  if (existsSync(path.join(OUT, 'report.json')) || readdirSync(OUT).length === 0) return null
  return `${OUT} is neither under test-results/, empty, nor an earlier smoke run's output`
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────

/** @type {{ name: string, ok: boolean, details: string, ms: number }[]} */
const checks = []
/** @type {string[]} */
const screenshots = []
/** @type {{ at: string, message: string, run: number }[]} */
const marks = []
/** @type {string[]} */
const pageProblems = []
const startedAt = new Date()

function log(message) {
  console.log(`[smoke-desktop] ${message}`)
}

/**
 * Runs one check: `fn` returns details (or throws). The result is recorded and printed; a failed
 * check does not stop the run unless `fatal`.
 */
async function check(name, fn, { fatal = false } = {}) {
  const begin = Date.now()
  try {
    const details = (await fn()) ?? ''
    checks.push({ name, ok: true, details: String(details), ms: Date.now() - begin })
    log(`PASS ${name}${details ? ` — ${details}` : ''}`)
    return true
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    checks.push({ name, ok: false, details, ms: Date.now() - begin })
    log(`FAIL ${name} — ${details}`)
    if (fatal) throw new Error(`stopping: ${name} failed`, { cause: error })
    return false
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** Polls `fn` until it returns a truthy value; throws `message` after `timeout` ms. */
async function poll(fn, message, { timeout = 10_000, interval = 200 } = {}) {
  const end = Date.now() + timeout
  let last
  for (;;) {
    try {
      last = await fn()
      if (last) return last
    } catch (error) {
      last = error
    }
    if (Date.now() > end) {
      const why = last instanceof Error ? ` (${last.message})` : ''
      throw new Error(`${message}: timed out after ${String(timeout)} ms${why}`)
    }
    await sleep(interval)
  }
}

function writeReport() {
  const failed = checks.filter((c) => !c.ok)
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ok: failed.length === 0 && checks.length > 0,
    checks,
    screenshots: screenshots.map((file) => path.relative(OUT, file)),
    marks,
    pageProblems,
  }
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  const lines = [
    '# Desktop smoke test',
    '',
    `${report.ok ? 'Passed' : 'FAILED'}: ${String(checks.length - failed.length)} of ` +
      `${String(checks.length)} checks, ${report.startedAt} to ${report.finishedAt}.`,
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...checks.map(
      (c) => `| ${c.name} | ${c.ok ? 'pass' : '**FAIL**'} | ${c.details.replaceAll('|', '\\|')} |`,
    ),
    '',
    '## Screenshots',
    '',
    ...report.screenshots.map((file) => `- [${file}](${file.replaceAll('\\', '/')})`),
    '',
    '## `[smoke]` lines',
    '',
    '```',
    ...marks.map((mark) => `run ${String(mark.run)}  ${mark.at}  ${mark.message}`),
    '```',
    '',
    '## Page warnings and errors',
    '',
    ...(pageProblems.length === 0 ? ['None.'] : pageProblems.map((p) => `- ${p}`)),
    '',
  ]
  writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'))
  return report
}

// ── Processes ───────────────────────────────────────────────────────────────────────────────

/** Every process tree started, killed at the end. @type {Set<number>} */
const trees = new Set()

function killTree(pid) {
  if (pid === undefined) return
  spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore', windowsHide: true })
  trees.delete(pid)
}

function killAll() {
  for (const pid of [...trees]) killTree(pid)
}

/** Whether something listens on `port` on localhost (IPv4 or IPv6). */
async function listening(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const socket = createConnection({ port, host })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        resolve(false)
      })
    })
  return (await probe('127.0.0.1')) || (await probe('::1'))
}

function appProcesses() {
  const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq timer-app.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('"timer-app.exe"'))
    .map((line) => Number(line.split('","')[1]))
}

/** Strips ANSI colors from a log line. */
function plain(line) {
  // eslint-disable-next-line no-control-regex -- terminal escape sequences
  return line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

/** Waiters for `[smoke]` lines. @type {{ test: (m: string) => boolean, resolve: (v: any) => void }[]} */
let markWaiters = []
let run = 0

function onMark(at, message) {
  marks.push({ at, message, run })
  const waiting = markWaiters
  markWaiters = []
  for (const waiter of waiting) {
    if (waiter.test(message)) waiter.resolve({ at, message })
    else markWaiters.push(waiter)
  }
}

/** Resolves with the next `[smoke]` line (from now on) whose message matches `pattern`. */
function nextMark(pattern, timeout, what) {
  return new Promise((resolve, reject) => {
    const waiter = { test: (message) => pattern.test(message), resolve }
    markWaiters.push(waiter)
    setTimeout(() => {
      if (!markWaiters.includes(waiter)) return
      markWaiters = markWaiters.filter((w) => w !== waiter)
      reject(new Error(`no [smoke] ${what} within ${String(timeout)} ms`))
    }, timeout)
  })
}

/** Starts `tauri dev` (plus `appArgs` for the app) with the smoke's WebView2 settings. */
function startTauri(appArgs, logName) {
  const args = [
    TAURI_CLI,
    'dev',
    '--no-watch',
    ...(appArgs.length > 0 ? ['--', '--', ...appArgs] : []),
  ]
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: webviewEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  trees.add(child.pid)
  const file = path.join(OUT, logName)
  writeFileSync(file, '')
  let buffered = ''
  const take = (chunk) => {
    const text = chunk.toString('utf8')
    writeFileSync(file, text, { flag: 'a' })
    buffered += text
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      const match = /^\[smoke\] (\S+) (.*)$/.exec(plain(line).trim())
      if (match) onMark(match[1], match[2])
    }
  }
  child.stdout.on('data', take)
  child.stderr.on('data', (chunk) => {
    writeFileSync(file, chunk, { flag: 'a' })
  })
  const exited = new Promise((resolve) => {
    child.once('exit', (code) => {
      trees.delete(child.pid)
      resolve(code)
    })
  })
  return { pid: child.pid, exited }
}

/** The app's environment: the smoke's WebView2 settings and its own token credential. */
function webviewEnv() {
  return {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${String(CDP_PORT)} ${WEBVIEW_DEFAULT_ARGS}`,
    WEBVIEW2_USER_DATA_FOLDER: WEBVIEW_DATA,
    TIMER_APP_TOKEN_ACCOUNT: TOKEN_ACCOUNT,
  }
}

/** Runs `cmdkey /<action>:"<the run's token credential>"` (the quotes keep the space). */
function cmdkey(action) {
  return spawnSync('cmdkey', [`/${action}:"${TOKEN_TARGET}"`], {
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: true,
  })
}

/**
 * Whether the Windows Credential Manager holds the run's token credential: `cmdkey /list:<name>`
 * names it in its heading, and once more below it when it exists (in any display language).
 */
function tokenCredentialExists() {
  const lines = cmdkey('list').stdout.split(/\r?\n/)
  return lines.filter((line) => line.includes(TOKEN_TARGET)).length > 1
}

function deleteTokenCredential() {
  cmdkey('delete')
}

/** Starts the sync server as the end-to-end tests do, for the desktop sign-in. */
function startSyncServer() {
  const file = path.join(OUT, 'sync-server.log')
  writeFileSync(file, '')
  const child = spawn(process.execPath, ['e2e/sync-server.ts', APP_ORIGIN], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  trees.add(child.pid)
  const append = (chunk) => {
    writeFileSync(file, chunk, { flag: 'a' })
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.once('exit', () => trees.delete(child.pid))
  return child.pid
}

// ── Win32, through one PowerShell process ───────────────────────────────────────────────────

const WIN32_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SmokeWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> Of(uint[] pids) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (Array.IndexOf(pids, p) >= 0) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static string Text(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
  public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static uint PidOf(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
'@
[SmokeWin]::SetProcessDPIAware() | Out-Null

function Smoke-Windows([uint32[]]$pids) {
  if ($pids.Count -eq 0) { $pids = @(Get-Process timer-app -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id }) }
  if ($pids.Count -eq 0) { return @() }
  $fg = [SmokeWin]::GetForegroundWindow()
  @(foreach ($h in [SmokeWin]::Of($pids)) {
    $cls = [SmokeWin]::Class($h)
    $title = [SmokeWin]::Text($h)
    if ($cls -ne 'Tauri Window' -and $title -eq '') { continue }
    $r = New-Object SmokeWin+RECT
    [SmokeWin]::GetWindowRect($h, [ref]$r) | Out-Null
    $ex = [SmokeWin]::GetWindowLong($h, -20)
    [pscustomobject]@{
      hwnd = [long]$h; pid = [SmokeWin]::PidOf($h); title = $title; cls = $cls
      visible = [SmokeWin]::IsWindowVisible($h); minimized = [SmokeWin]::IsIconic($h)
      topmost = (($ex -band 0x8) -ne 0)
      x = $r.Left; y = $r.Top; w = $r.Right - $r.Left; h = $r.Bottom - $r.Top
      foreground = ($fg -eq $h)
    }
  })
}

function Smoke-Foreground {
  $fg = [SmokeWin]::GetForegroundWindow()
  [pscustomobject]@{ hwnd = [long]$fg; pid = [SmokeWin]::PidOf($fg); title = [SmokeWin]::Text($fg) }
}

function Smoke-Front([long]$hwnd) {
  # Moving the foreground needs this thread to share input with the foreground window's thread
  # (SetForegroundWindow's rules). Never tap Alt for it: a lone Alt puts the app's window into
  # menu mode, which stalls the webview.
  $fg = [SmokeWin]::GetForegroundWindow()
  if ($fg -ne [IntPtr]$hwnd) {
    $p = 0
    $other = [SmokeWin]::GetWindowThreadProcessId($fg, [ref]$p)
    $me = [SmokeWin]::GetCurrentThreadId()
    [SmokeWin]::AttachThreadInput($me, $other, $true) | Out-Null
    [SmokeWin]::BringWindowToTop([IntPtr]$hwnd) | Out-Null
    [SmokeWin]::SetForegroundWindow([IntPtr]$hwnd) | Out-Null
    [SmokeWin]::AttachThreadInput($me, $other, $false) | Out-Null
    Start-Sleep -Milliseconds 300
  }
  Smoke-Foreground
}

function Smoke-Shot([long]$hwnd, [string]$out, [bool]$front) {
  if ($front) { Smoke-Front $hwnd | Out-Null; Start-Sleep -Milliseconds 400 }
  $r = New-Object SmokeWin+RECT
  [SmokeWin]::GetWindowRect([IntPtr]$hwnd, [ref]$r) | Out-Null
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "$out $($w)x$($h)"
}

function Smoke-Move([long]$hwnd, [int]$x, [int]$y, [int]$w, [int]$h) {
  [SmokeWin]::SetWindowPos([IntPtr]$hwnd, [IntPtr]::Zero, $x, $y, $w, $h, 0x0014) | Out-Null
  'moved'
}

function Smoke-Close([long]$hwnd) {
  [SmokeWin]::PostMessage([IntPtr]$hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  'closed'
}

function Smoke-Chord([string]$keys) {
  $vks = @($keys.Split(',') | ForEach-Object { [byte][Convert]::ToInt32($_, 16) })
  foreach ($vk in $vks) { [SmokeWin]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
  [array]::Reverse($vks)
  foreach ($vk in $vks) { [SmokeWin]::keybd_event($vk, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
  'pressed'
}

function Smoke-Tray([string]$name, [bool]$invoke) {
  # The app's button in the notification area, found by its tooltip, and invoked as a left click
  # would when $invoke. Windows 11 often keeps new icons in the overflow ("Show hidden icons"),
  # which is opened for the search (its chevron is the area's first button) and closed after.
  $A = [System.Windows.Automation.AutomationElement]
  $invokeOf = { param($e) $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
  $button = New-Object System.Windows.Automation.PropertyCondition ($A::ControlTypeProperty), ([System.Windows.Automation.ControlType]::Button)
  $byClass = { param($cls) $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition ($A::ClassNameProperty), $cls)) }
  $find = { param($area) foreach ($e in $area.FindAll([System.Windows.Automation.TreeScope]::Descendants, $button)) { if ($e.Current.Name.Trim() -eq $name) { return $e } } }
  $tray = & $byClass 'Shell_TrayWnd'
  if (-not $tray) { return 'not found (no taskbar)' }
  $item = & $find $tray
  $where = 'taskbar'
  $chevron = $null
  if (-not $item) {
    foreach ($e in $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $button)) {
      if ($e.Current.ClassName -eq 'SystemTray.NormalButton') { $chevron = $e; break }
    }
    if ($chevron) {
      & $invokeOf $chevron
      Start-Sleep -Milliseconds 800
      $overflow = & $byClass 'TopLevelWindowForOverflowXamlIsland'
      if ($overflow) { $item = & $find $overflow; $where = 'overflow' }
    }
  }
  if ($item -and $invoke) { & $invokeOf $item; Start-Sleep -Milliseconds 500 }
  if ($chevron) {
    $overflow = & $byClass 'TopLevelWindowForOverflowXamlIsland'
    if ($overflow -and -not $overflow.Current.IsOffscreen) { & $invokeOf $chevron }
  }
  if (-not $item) { return 'not found' }
  if ($invoke) { "invoked in the $where" } else { "found in the $where" }
}

function Smoke-Accent {
  $value = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\DWM' -Name AccentColor -ErrorAction SilentlyContinue).AccentColor
  if ($null -eq $value) { return $null }
  $v = [uint32]($value -band 0xFFFFFFFF)
  '#{0:x2}{1:x2}{2:x2}' -f ($v -band 0xFF), (($v -shr 8) -band 0xFF), (($v -shr 16) -band 0xFF)
}
`

const FOCUS_PS1 = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.Text = 'Smoke focus window'
$f.Width = 460; $f.Height = 160; $f.StartPosition = 'Manual'; $f.Left = 40; $f.Top = 40
$l = New-Object System.Windows.Forms.Label
$l.Text = 'Another app has the focus (Timer App desktop smoke test)'; $l.AutoSize = $true; $l.Left = 16; $l.Top = 40
$f.Controls.Add($l)
$f.Add_Shown({ $f.Activate() })
[System.Windows.Forms.Application]::Run($f)
`

/** One PowerShell process that runs the helper functions above, one command at a time. */
class PowerShell {
  constructor() {
    const file = path.join(OUT, 'win32.ps1')
    writeFileSync(file, WIN32_PS1)
    this.child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    trees.add(this.child.pid)
    this.output = ''
    this.errors = ''
    this.pending = null
    this.queue = Promise.resolve()
    this.child.stdout.on('data', (chunk) => {
      this.output += chunk.toString('utf8')
      this.flush()
    })
    this.child.stderr.on('data', (chunk) => {
      this.errors += chunk.toString('utf8')
    })
    this.ready = this.raw(`. '${file.replaceAll("'", "''")}'; 'ready' | ConvertTo-Json`)
  }

  flush() {
    const end = this.output.indexOf('<<SMOKE-END>>')
    if (end < 0 || this.pending === null) return
    const text = this.output.slice(0, end).trim()
    this.output = this.output.slice(end + '<<SMOKE-END>>'.length).replace(/^\r?\n/, '')
    const { resolve } = this.pending
    this.pending = null
    resolve(text)
  }

  raw(line) {
    const run = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null
          reject(new Error(`PowerShell did not answer: ${line}\n${this.errors}`))
        }, 60_000)
        this.pending = {
          resolve: (text) => {
            clearTimeout(timer)
            resolve(text)
          },
        }
        this.child.stdin.write(
          `try { ${line} } catch { @{ error = "$_" } | ConvertTo-Json -Compress }; ` +
            `Write-Output '<<SMOKE-END>>'\n`,
        )
      })
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Runs a helper function and parses its result. */
  async call(command) {
    await this.ready
    const text = await this.raw(`${command} | ConvertTo-Json -Compress -Depth 4`)
    const value = text === '' ? null : JSON.parse(text)
    if (value && typeof value === 'object' && 'error' in value && Object.keys(value).length === 1) {
      throw new Error(`PowerShell: ${String(value.error)}`)
    }
    return value
  }

  /** The app's top-level windows (all, visible or not). */
  async windows() {
    const list = await this.call('Smoke-Windows @()')
    return (Array.isArray(list) ? list : list === null ? [] : [list]).filter(
      (w) => w.cls === 'Tauri Window',
    )
  }

  close() {
    this.child.stdin.end()
    killTree(this.child.pid)
  }
}

/** @type {PowerShell} */
let ps

async function screenshot(name, hwnd, { front = true } = {}) {
  const file = path.join(OUT, `${name}.png`)
  await ps.call(`Smoke-Shot ${String(hwnd)} '${file.replaceAll("'", "''")}' $${String(front)}`)
  screenshots.push(file)
  return file
}

// ── The webview, over the Chrome DevTools Protocol ──────────────────────────────────────────

async function targets() {
  const response = await fetch(`http://127.0.0.1:${String(CDP_PORT)}/json/list`)
  /** @type {{ type: string, url: string, webSocketDebuggerUrl: string }[]} */
  const list = await response.json()
  return list.filter((target) => target.type === 'page')
}

const isMain = (url) => url === MAIN_URL
const isMini = (url) => url.startsWith(`${APP_ORIGIN}/mini?`)

/** A DevTools connection to one page. */
class Page {
  static async open(match, what) {
    const target = await poll(
      async () => (await targets()).find((t) => match(t.url)),
      `the ${what} page appears`,
      { timeout: 30_000 },
    )
    const page = new Page(target.webSocketDebuggerUrl, what)
    await page.connected
    return page
  }

  constructor(url, what) {
    this.what = what
    this.socket = new WebSocket(url)
    this.next = 0
    this.calls = new Map()
    this.listeners = []
    this.connected = new Promise((resolve, reject) => {
      this.socket.onopen = resolve
      this.socket.onerror = () => {
        reject(new Error(`could not connect to the ${what} page`))
      }
    })
    this.socket.onmessage = (event) => {
      const data = JSON.parse(String(event.data))
      if (data.id !== undefined) {
        const call = this.calls.get(data.id)
        this.calls.delete(data.id)
        if (data.error) call?.reject(new Error(`${call.method}: ${data.error.message}`))
        else call?.resolve(data.result)
      } else {
        for (const listener of this.listeners) listener(data.method, data.params)
      }
    }
  }

  send(method, params = {}) {
    const id = ++this.next
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject, method })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(listener) {
    this.listeners.push(listener)
  }

  /**
   * Evaluates `body` (an async function body) in the page and returns its JSON value. The app's
   * modules are at hand as `app` (Vite serves each module once per URL, so these are the app's own
   * instances): `cardStore`, `settingsStore`, `platform`, and on the main page `authStore`.
   */
  async eval(body) {
    const prelude = `
      const app = {
        ...(await import('/src/state/cards.svelte.ts')),
        ...(await import('/src/state/settings.svelte.ts')),
        ...(await import('/src/platform/index.ts')),
        ...(location.pathname === '/' ? await import('/src/state/auth.svelte.ts') : {}),
        ...(location.pathname === '/' ? await import('/src/sync/remote.svelte.ts') : {}),
      }`
    const expression = `(async () => { try { ${prelude}; const v = await (async () => { ${body} })(); return { value: v } } catch (e) { return { error: String(e && e.stack || e) } } })()`
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    const value = result.result?.value
    if (value?.error) throw new Error(`in the ${this.what} page: ${value.error}`)
    return value?.value
  }

  /** Presses `key` (a `KeyboardEvent.key`) with `modifiers` (Alt 1, Ctrl 2, Meta 4, Shift 8). */
  async key(key, modifiers = 0) {
    const named = {
      ' ': ['Space', 32, ' '],
      Enter: ['Enter', 13, '\r'],
      Escape: ['Escape', 27],
      ',': ['Comma', 188, ','],
      F9: ['F9', 120],
    }
    let [code, vk, text] = named[key] ?? []
    if (code === undefined) {
      if (/^[0-9]$/.test(key)) [code, vk, text] = [`Digit${key}`, key.charCodeAt(0), key]
      else [code, vk, text] = [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0), key]
    }
    if ((modifiers & 7) !== 0) text = undefined
    const base = { key, code, windowsVirtualKeyCode: vk, modifiers }
    await this.send('Input.dispatchKeyEvent', {
      ...base,
      type: text === undefined ? 'rawKeyDown' : 'keyDown',
      ...(text === undefined ? {} : { text }),
    })
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
  }

  async keys(sequence) {
    for (const key of sequence) await this.key(key)
  }

  close() {
    this.socket.close()
  }
}

/**
 * Watches the main page for the whole run: console warnings and errors, uncaught exceptions,
 * and the app's IPC calls to the shell (Tauri's `ipc.localhost` requests), with their outcome.
 */
class Watcher {
  constructor() {
    /** @type {{ cmd: string, body: string, status: number | null, failed: boolean, at: number }[]} */
    this.ipc = []
    this.byRequest = new Map()
    this.page = null
  }

  async attach() {
    this.page?.close()
    const page = await Page.open(isMain, 'main')
    this.page = page
    page.on((method, params) => {
      if (method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(params.type)) {
        const text = params.args.map((a) => a.value ?? a.description ?? '').join(' ')
        pageProblems.push(`run ${String(run)} console.${params.type}: ${text}`)
      } else if (method === 'Runtime.exceptionThrown') {
        pageProblems.push(
          `run ${String(run)} uncaught: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`,
        )
      } else if (method === 'Network.requestWillBeSent') {
        const url = new URL(params.request.url)
        // The commands are POSTs; skip the CORS preflights (OPTIONS) that come and go with them.
        if (url.hostname !== 'ipc.localhost' || params.request.method !== 'POST') return
        const entry = {
          cmd: decodeURIComponent(url.pathname.slice(1)),
          body: params.request.postData ?? '',
          status: null,
          failed: false,
          at: Date.now(),
        }
        this.byRequest.set(params.requestId, entry)
        this.ipc.push(entry)
      } else if (method === 'Network.responseReceived') {
        const entry = this.byRequest.get(params.requestId)
        if (entry) entry.status = params.response.status
      } else if (method === 'Network.loadingFailed') {
        const entry = this.byRequest.get(params.requestId)
        if (entry) entry.failed = true
      }
    })
    await page.send('Runtime.enable')
    await page.send('Network.enable')
  }

  /** The IPC calls of command `cmd` since `since`. */
  calls(cmd, since = 0) {
    return this.ipc.filter((entry) => entry.cmd === cmd && entry.at >= since)
  }

  close() {
    this.page?.close()
  }
}

// ── The run ─────────────────────────────────────────────────────────────────────────────────

/** The main window's handle, found when it first appears. */
let mainHwnd = 0

async function windowsNow() {
  return ps.windows()
}

async function mainWindow() {
  return (await windowsNow()).find((w) => w.hwnd === mainHwnd)
}

async function miniWindow() {
  return (await windowsNow()).find((w) => w.hwnd !== mainHwnd && w.visible)
}

/** Waits for `tauri dev` to have the app up: the `main ready` line, then the page over CDP. */
async function waitForApp(timeout) {
  await nextMark(/^main ready$/, timeout, 'main ready')
  // Vite may reload the page once while it optimizes dependencies: wait until it is quiet.
  for (;;) {
    const again = nextMark(/^main ready$/, 3000, 'main ready').then(
      () => true,
      () => false,
    )
    if (!(await again)) break
  }
}

/**
 * Waits for the alarm's looping sound source (recorded by the `__smokeAudio` spy) and for its
 * audio context to run: the player resumes a suspended context as the alarm starts.
 */
async function alarmAudio(page) {
  await poll(
    () => page.eval('return window.__smokeAudio.some((s) => s.loop)'),
    'a looping alarm source starts',
    { timeout: 10_000 },
  )
  const state = () =>
    page.eval('return window.__smokeAudio.filter((s) => s.loop).at(-1).context.state')
  await poll(async () => (await state()) === 'running', 'its audio context runs', {
    timeout: 3000,
  }).catch(async () => {
    throw new Error(`the alarm's audio context is ${String(await state())}`)
  })
  return 'running'
}

async function cardPhases(page) {
  return page.eval(
    `return Object.fromEntries(app.cardStore.cards.map((c) => [c.id, c.kind === 'timer' ? c.timer.phase : c.stopwatch.phase]))`,
  )
}

/** In the page: where the sign-in token is (the OS store, the request header, the device store). */
const TOKEN_STATE = `
  const os = await app.platform.tokens.get()
  const saved = localStorage.getItem('timer-app-device') ?? ''
  return {
    status: app.authStore.status,
    supported: app.platform.tokens.supported,
    os: os && { token: os.token, expiresIn: os.expiresAt - Date.now() },
    bearer: app.bearerToken(),
    device: app.settingsStore.auth !== null || saved.includes('authToken'),
  }`

/**
 * Checks that the page's token is in the OS credential store and nowhere else (the Credential
 * Manager has the entry, the device store has none) and is the one the app sends; resolves to it.
 */
async function tokenInOsStoreOnly(page) {
  const state = await page.eval(TOKEN_STATE)
  assert(state.supported, 'the OS credential store is off (see the page warnings)')
  assert(state.os !== null, 'no token in the OS credential store')
  assert(state.os.expiresIn > 0, 'the stored token has expired')
  assert(state.bearer === state.os.token, 'the app sends another token than the stored one')
  assert(!state.device, 'the token is in the device store too')
  assert(tokenCredentialExists(), `the Credential Manager has no ${TOKEN_TARGET}`)
  return state.os
}

/** The token run 1 signed in with, which run 2 must still have (never printed). */
let signedIn = null

async function run1(watcher) {
  run = 1
  log('run 1: starting tauri dev (the first build can take minutes)')
  const tauri = startTauri([], 'tauri-dev-1.log')
  const ready = await check(
    'the app starts (tauri dev, main ready)',
    async () => {
      await Promise.race([
        waitForApp(600_000),
        tauri.exited.then((code) => {
          throw new Error(`tauri dev exited with ${String(code)} (see tauri-dev-1.log)`)
        }),
      ])
      return 'the main page printed "main ready"'
    },
    { fatal: true },
  )
  if (!ready) return tauri

  await check(
    'the main window opens',
    async () => {
      const shown = await poll(
        async () => (await windowsNow()).find((w) => w.visible && w.title === 'Timer App'),
        'a visible Timer App window',
      )
      mainHwnd = shown.hwnd
      await screenshot('01-main', mainHwnd)
      return `visible at ${String(shown.x)},${String(shown.y)} ${String(shown.w)}×${String(shown.h)}`
    },
    { fatal: true },
  )

  await watcher.attach()
  const main = await Page.open(isMain, 'main')

  await check('the tray menu follows the app language', async () => {
    const since = Date.now()
    await main.eval(`app.settingsStore.updateDevice({ locale: 'en' })`)
    const sent = await poll(
      () =>
        watcher
          .calls('set_tray_labels', since)
          .find((call) => call.status === 200 && call.body.includes('Quit Timer App')),
      'set_tray_labels with the English labels',
    )
    return `set_tray_labels ${sent.body}`
  })

  await check('the OS accent color seeds the theme', async () => {
    const os = await ps.call('Smoke-Accent')
    const seen = await main.eval(`
      const { DEFAULT_THEME_CSS } = await import('/src/ui/theme/default-theme.ts')
      const theme = document.getElementById('theme')?.textContent ?? ''
      return { accent: await app.platform.accent.get(), seed: app.settingsStore.device.seed,
        defaultTheme: theme.trim() === DEFAULT_THEME_CSS.trim(),
        primary: getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim() }`)
    assert(/^#[0-9a-f]{6}$/.test(seen.accent ?? ''), `accent_color answered ${String(seen.accent)}`)
    assert(
      os === null || seen.accent === os,
      `the app read ${seen.accent}, the OS has ${String(os)}`,
    )
    assert(seen.seed === '', `the seed setting is ${seen.seed}, not "follow the OS"`)
    assert(
      !seen.defaultTheme || seen.accent === '#0b57d0',
      'the page still has the default theme, not the accent',
    )
    return `accent ${seen.accent} (registry ${String(os)}), primary ${seen.primary}`
  })

  // ── Ringing while hidden to the tray ────────────────────────────────────────────────────
  let cardId = null
  await check('a 60 s timer rings on time while the window is hidden to the tray', async () => {
    await main.eval(`
      // Count the alarm's sound sources and the audio context's state when they start.
      if (!window.__smokeAudio) {
        window.__smokeAudio = []
        const start = AudioBufferSourceNode.prototype.start
        AudioBufferSourceNode.prototype.start = function (...args) {
          window.__smokeAudio.push({ context: this.context, loop: this.loop })
          return start.apply(this, args)
        }
      }`)
    await main.keys(['n', '1', '0', '0', 'Enter'])
    const started = await poll(
      () =>
        main.eval(`
          const card = app.cardStore.selected
          return card?.kind === 'timer' && card.timer.phase === 'running'
            ? { id: card.id, duration: card.timer.duration, endsAt: card.timer.endsAt } : null`),
      'the new timer runs',
    )
    assert(started.duration === 60_000, `the timer is ${String(started.duration)} ms, not 60 s`)
    cardId = started.id
    await poll(
      () => watcher.calls('set_running').some((c) => c.body.includes('true') && c.status === 200),
      'set_running(true) reaches the shell',
    )
    const prefix = `ringing card=${cardId} `
    const ringing = nextMark({ test: (m) => m.startsWith(prefix) }, 90_000, 'ringing')
    await ps.call(`Smoke-Close ${String(mainHwnd)}`)
    await poll(async () => (await mainWindow())?.visible === false, 'the window hides')
    assert(appProcesses().length > 0, 'the app quit instead of hiding')
    const mark = await ringing
    const late = Date.parse(mark.at) - started.endsAt
    const reported = /late=(-?\d+)ms/.exec(mark.message)?.[1]
    assert((await mainWindow())?.visible === false, 'the window was shown before the timer rang')
    assert(late >= 0 && late <= 1000, `rang ${String(late)} ms after its end`)
    return `rang ${String(late)} ms after its end (the page measured ${String(reported)} ms), window hidden`
  })

  await check('the notification call succeeds', async () => {
    const shown = await poll(
      () => watcher.calls('plugin:notification|notify').find((c) => c.status !== null || c.failed),
      'plugin:notification|notify is called',
    )
    assert(shown.status === 200 && !shown.failed, `notify answered ${String(shown.status)}`)
    const permission = await main.eval('return app.platform.notifications.permission()')
    return `notify ${shown.body} → 200; permission ${String(permission)}`
  })

  await check('the alarm sound plays', async () => {
    const state = await alarmAudio(main)
    return `a looping alarm source started; its audio context is ${state}`
  })

  await check('the tray icon shows the window again', async () => {
    // UI Automation sometimes misses the notification area's buttons while Explorer redraws it
    // (the overflow opening, say): look again a few times before giving up.
    let tray = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      tray = String(await ps.call(`Smoke-Tray 'Timer App' $true`))
      if (tray.startsWith('invoked')) break
      await sleep(1500)
    }
    const clicked = tray.startsWith('invoked')
    if (!clicked) {
      await main.eval(
        `await window.__TAURI_INTERNALS__.invoke('plugin:window|show', { label: 'main' })`,
      )
    }
    await poll(async () => (await mainWindow())?.visible === true, 'the window shows')
    await screenshot('02-ringing', mainHwnd)
    await main.key('Enter')
    await poll(async () => (await cardPhases(main))[cardId] === 'idle', 'Enter dismisses the alarm')
    if (!clicked) throw new Error(`the tray button "Timer App": ${tray}`)
    return `tray button ${tray}; Enter dismissed the alarm`
  })

  // ── Mini window ─────────────────────────────────────────────────────────────────────────
  await check('the mini window opens on top, drives the card, and the grid follows', async () => {
    await main.eval(`app.cardStore.select(${JSON.stringify(cardId)})`)
    await main.key('t')
    const mini = await Page.open(isMini, 'mini')
    try {
      const url = (await targets()).find((t) => isMini(t.url))?.url ?? ''
      assert(url.endsWith(`card=${encodeURIComponent(cardId)}`), `the mini page is ${url}`)
      const shown = await poll(miniWindow, 'the mini window appears')
      assert(shown.topmost, 'the mini window is not always on top')
      await poll(
        () =>
          mini.eval('return document.querySelector(".mini-card, [data-card-id], main") !== null'),
        'the mini card renders',
      )
      await sleep(500)
      await screenshot('03-mini-idle', shown.hwnd, { front: false })
      await mini.key(' ')
      await poll(
        async () => (await cardPhases(main))[cardId] === 'running',
        'Space in the mini window starts the card in the main grid',
      )
      await sleep(1200)
      await screenshot('04-mini-running', shown.hwnd, { front: false })
      await mini.key(' ')
      await poll(
        async () => (await cardPhases(main))[cardId] === 'paused',
        'Space again pauses it in the main grid',
      )
      const grid = await main.eval(
        `return document.querySelector('[data-card-id=${JSON.stringify(cardId)}]')?.getAttribute('data-phase')`,
      )
      assert(grid === 'paused', `the main grid's card shows ${String(grid)}`)
      await mini.key('Escape')
      await poll(async () => (await miniWindow()) === undefined, 'Esc closes the mini window')
      await poll(
        () => main.eval('return !app.platform.windows.isOpen()'),
        'the main window hears it closed',
      )
      return `topmost ${String(shown.w)}×${String(shown.h)} at ${String(shown.x)},${String(shown.y)}; start and pause reached the grid; Esc closed it`
    } finally {
      mini.close()
    }
  })

  // ── Global hotkey ───────────────────────────────────────────────────────────────────────
  await check(
    'a global hotkey toggles the last-used card while another app has the focus',
    async () => {
      await main.key(',', 2)
      await main.eval(`
      const tab = await (async () => { for (let i = 0; i < 50; i++) { const t = document.querySelector('[role=tab][id$="-tab-desktop"]'); if (t) return t; await new Promise((r) => setTimeout(r, 100)) } })()
      tab.click()
      await new Promise((r) => setTimeout(r, 300))
      document.querySelector('[data-hotkey="toggleLast"] [data-part="change"]').click()
      await new Promise((r) => setTimeout(r, 300))`)
      await main.key('F9', 1 | 2 | 8)
      const bound = await poll(
        () => main.eval('return app.settingsStore.desktop.hotkeys.toggleLast'),
        'the recorded hotkey is saved',
      )
      assert(bound === HOTKEY.text, `the hotkey saved is ${String(bound)}`)
      await sleep(500)
      await screenshot('05-settings-desktop', mainHwnd)
      await main.key('Escape')

      // The last-used card is the one the mini window paused; select another one.
      const other = await main.eval(
        `const other = app.cardStore.cards.find((c) => c.id !== ${JSON.stringify(cardId)}); app.cardStore.select(other.id); return other.id`,
      )
      const focus = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-File',
          path.join(OUT, 'focus.ps1'),
        ],
        { stdio: 'ignore' },
      )
      trees.add(focus.pid)
      try {
        const focusWindow = await poll(async () => {
          const list = await ps.call(`Smoke-Windows @(${String(focus.pid)})`)
          return (Array.isArray(list) ? list : [list]).find(
            (w) => w?.title === 'Smoke focus window',
          )
        }, 'the other app opens')
        const fg = await ps.call(`Smoke-Front ${String(focusWindow.hwnd)}`)
        assert(fg.pid === focus.pid, `the other app is not in front (${JSON.stringify(fg)})`)
        const results = []
        for (const expected of ['running', 'paused']) {
          const pressed = nextMark(/^hotkey toggle-last$/, 5000, 'hotkey toggle-last')
          await ps.call(`Smoke-Chord '${HOTKEY.vks}'`)
          await pressed
          await poll(
            async () => (await cardPhases(main))[cardId] === expected,
            `the hotkey makes the last-used card ${expected}`,
          )
          const phases = await cardPhases(main)
          assert(phases[other] === 'idle', `the selected card changed to ${String(phases[other])}`)
          const front = await ps.call('Smoke-Foreground')
          assert(front.pid === focus.pid, `the app took the focus (${JSON.stringify(front)})`)
          results.push(expected)
        }
        return `${HOTKEY.label} from another app: the last-used card went ${results.join(', then ')}; the selected card stayed idle; the other app kept the focus`
      } finally {
        killTree(focus.pid)
      }
    },
  )

  // ── Desktop sign-in ─────────────────────────────────────────────────────────────────────
  if (!options['skip-sign-in']) {
    await check('desktop sign-in: device code, bearer token in the OS store, sync', async () => {
      await main.eval(
        `if (app.authStore.status === 'signed-in') throw new Error('signed in already')`,
      )
      await main.key(',', 2)
      const providerButtons = await main.eval(`
        for (let i = 0; i < 50 && !document.querySelector('[role=tab][id$="-tab-account"]'); i++) await new Promise((r) => setTimeout(r, 100))
        document.querySelector('[role=tab][id$="-tab-account"]').click()
        await new Promise((r) => setTimeout(r, 400))
        const buttons = [...document.querySelectorAll('dialog[open] button')].map((b) => b.textContent.trim())
        const start = [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'Sign in with your browser')
        if (!start) throw new Error('no "Sign in with your browser" button: ' + buttons.join(' | '))
        start.click()
        return buttons.filter((t) => /Google|GitHub|Apple/.test(t))`)
      assert(
        providerButtons.length === 0,
        `provider buttons on desktop: ${providerButtons.join(', ')}`,
      )
      const code = await poll(
        () =>
          main.eval(
            `return document.querySelector('[data-testid="device-user-code"] [aria-hidden="true"]')?.textContent.trim() ?? null`,
          ),
        'the device code shows',
      )
      // "Open the browser" opens the URL the server gave: the main window's opener scope must
      // allow it, or the click does nothing (checked against the capability rather than clicked,
      // which would open your browser).
      const verificationUrl = await main.eval(
        `return app.authStore.device?.verificationUrl ?? null`,
      )
      assert(typeof verificationUrl === 'string', 'no verification URL')
      assert(
        openerAllows(verificationUrl),
        `"Open the browser" would be refused: ${verificationUrl} is outside the opener scope of src-tauri/capabilities/default.json`,
      )
      const address = await main.eval(
        `return document.querySelector('[data-testid="device-address"]')?.textContent.trim() ?? null`,
      )
      assert(
        typeof address === 'string' && address !== '' && verificationUrl.startsWith(address),
        `the approval page's address shows (${String(address)})`,
      )
      await sleep(300)
      await screenshot('06-device-code', mainHwnd)

      const email = `smoke-${Date.now().toString(36)}@example.com`
      const cookie = await approveOnServer(email, code)
      await poll(
        () =>
          main.eval(
            `return app.authStore.status === 'signed-in' ? app.authStore.user?.email : null`,
          ),
        'the app signs in with the approved code',
        { timeout: 30_000 },
      )
      const token = await poll(
        () => tokenInOsStoreOnly(main),
        'the token is kept in the OS credential store only',
      )
      await poll(
        () => main.eval(`return app.remoteSync.status === 'online'`),
        'the sync socket connects with the bearer token',
        { timeout: 20_000 },
      )
      const name = `Smoke ${new Date().toISOString().slice(11, 19)}`
      await main.eval(`app.cardStore.addTimer(120000, ${JSON.stringify(name)})`)
      await poll(
        async () => {
          const response = await fetch(`${SYNC_ORIGIN}/api/export`, {
            headers: smokeHeaders(cookie),
          })
          return response.ok && (await response.text()).includes(name)
        },
        'the card made on the desktop reaches the server',
        { timeout: 20_000 },
      )
      await sleep(300)
      await screenshot('07-signed-in', mainHwnd)
      await main.key('Escape')
      signedIn = token
      return `code ${code} approved by ${email} (the opener may open ${verificationUrl}); token in the Credential Manager as ${TOKEN_TARGET} only (${String(token.token.length)} chars, ${String(Math.round(token.expiresIn / 86_400_000))} days); socket online; "${name}" reached the server`
    })

    await check('a token M5 kept in the device store moves to the OS store once', async () => {
      assert(signedIn !== null, 'not signed in (see the sign-in check)')
      const problemsBefore = pageProblems.length
      // As an M5 build left it: the token in the device store, none in the OS store.
      await main.eval(`
        app.settingsStore.setAuth(await app.platform.tokens.get())
        await app.platform.tokens.clear()`)
      await poll(
        () => main.eval(`return localStorage.getItem('timer-app-device')?.includes('authToken')`),
        'the device store saves the token',
      )
      assert(!tokenCredentialExists(), `the Credential Manager still has ${TOKEN_TARGET}`)
      /** Reloads the page; resolves to the OS store writes once it runs signed in and syncing. */
      const reload = async () => {
        await main.eval('window.__smokeOldPage = true')
        const since = Date.now()
        await main.send('Page.reload')
        await poll(
          () =>
            main.eval(
              `return !window.__smokeOldPage && app.authStore.status === 'signed-in' && app.remoteSync.status === 'online'`,
            ),
          'the reloaded app signs in and syncs',
          { timeout: 30_000 },
        )
        const token = await poll(
          () => tokenInOsStoreOnly(main),
          'the token is in the OS credential store only',
        )
        assert(token.token === signedIn.token, 'the app has another token than the one moved')
        return watcher.calls('token_set', since).length
      }
      const moves = await reload()
      assert(moves === 1, `the first start wrote the OS store ${String(moves)} times, not once`)
      const again = await reload()
      assert(again === 0, `the next start wrote the OS store ${String(again)} times, not never`)
      // Tauri answers the old page's pending listeners after a reload, and says so; expected here.
      for (let i = problemsBefore; i < pageProblems.length; i++) {
        if (pageProblems[i].includes("[TAURI] Couldn't find callback id")) {
          pageProblems[i] += ' (expected: this check reloaded the page)'
        }
      }
      return `the reload moved the token into ${TOKEN_TARGET} (one token_set) and emptied the device store, signed in and syncing; the next reload wrote nothing`
    })
  }

  // ── Window state, then quit ─────────────────────────────────────────────────────────────
  await check('closing with nothing running quits and saves the window state', async () => {
    await main.eval(`
      const { timer, stopwatch } = await import('/src/core/index.ts')
      for (const card of app.cardStore.cards) {
        if (card.kind === 'timer') app.cardStore.timer(card.id, timer.reset)
        else app.cardStore.stopwatch(card.id, stopwatch.reset)
      }`)
    await poll(
      () => watcher.calls('set_running').at(-1)?.body.includes('false'),
      'set_running(false) reaches the shell',
    ).catch(async (error) => {
      const sent = watcher.calls('set_running').map((c) => `${c.body} → ${String(c.status)}`)
      const phases = JSON.stringify(await cardPhases(main))
      throw new Error(`${error.message}; set_running sent: ${sent.join(', ')}; cards: ${phases}`)
    })
    const { x, y, w, h } = SAVED_RECT
    await ps.call(
      `Smoke-Move ${String(mainHwnd)} ${String(x)} ${String(y)} ${String(w)} ${String(h)}`,
    )
    await sleep(500)
    const moved = await mainWindow()
    await ps.call(`Smoke-Close ${String(mainHwnd)}`)
    await poll(() => appProcesses().length === 0, 'the app quits', { timeout: 15_000 })
    const saved = JSON.parse(readFileSync(WINDOW_STATE, 'utf8')).main
    assert(saved, 'no saved state for the main window')
    return `moved to ${String(moved?.x)},${String(moved?.y)} ${String(moved?.w)}×${String(moved?.h)}; saved ${JSON.stringify(saved)}`
  })
  main.close()
  watcher.close()
  return tauri
}

/** The headers of a request from the app's origin, as a browser on it would send them. */
function smokeHeaders(cookie) {
  return {
    Origin: APP_ORIGIN,
    'CF-Connecting-IP': '10.255.0.1',
    ...(cookie ? { Cookie: cookie } : {}),
  }
}

/**
 * Whether the main window's opener scope (`capabilities/default.json`, `opener:allow-open-url`)
 * allows `url`, matched as the opener plugin matches it (`glob::Pattern`: `*` and `**` match any
 * run of characters, `/` included; the scope uses no other glob syntax).
 */
function openerAllows(url) {
  const capability = JSON.parse(
    readFileSync(path.join(ROOT, 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
  )
  const scope = capability.permissions.find(
    (permission) => permission.identifier === 'opener:allow-open-url',
  )
  return (scope?.allow ?? []).some(({ url: pattern }) => {
    const source = pattern
      .split(/\*+/)
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    return new RegExp(`^${source}$`).test(url)
  })
}

/** Signs `email` in with an emailed code (read from the dev endpoint) and approves `userCode`. */
async function approveOnServer(email, userCode) {
  const json = { 'Content-Type': 'application/json' }
  const sent = await fetch(`${SYNC_ORIGIN}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { ...smokeHeaders(), ...json },
    body: JSON.stringify({ email, type: 'sign-in' }),
  })
  assert(sent.ok, `sending the code failed: ${String(sent.status)}`)
  const otp = await poll(async () => {
    const response = await fetch(`${SYNC_ORIGIN}/__dev/otp?email=${encodeURIComponent(email)}`)
    return response.ok ? (await response.json()).otp : null
  }, 'the server makes a sign-in code')
  const signedIn = await fetch(`${SYNC_ORIGIN}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { ...smokeHeaders(), ...json },
    body: JSON.stringify({ email, otp }),
  })
  assert(signedIn.ok, `signing in failed: ${String(signedIn.status)}`)
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const plainCode = userCode.replaceAll('-', '')
  const claimed = await fetch(
    `${SYNC_ORIGIN}/api/auth/device?user_code=${encodeURIComponent(plainCode)}`,
    { headers: smokeHeaders(cookie) },
  )
  assert(claimed.ok, `claiming the code failed: ${String(claimed.status)} ${await claimed.text()}`)
  const approved = await fetch(`${SYNC_ORIGIN}/api/auth/device/approve`, {
    method: 'POST',
    headers: { ...smokeHeaders(cookie), ...json },
    body: JSON.stringify({ userCode: plainCode }),
  })
  assert(approved.ok, `approving failed: ${String(approved.status)} ${await approved.text()}`)
  return cookie
}

async function run2(watcher) {
  run = 2
  log('run 2: starting tauri dev with --minimized')
  mainHwnd = 0
  const tauri = startTauri(['--minimized'], 'tauri-dev-2.log')
  const ready = await check(
    'with --minimized the app starts hidden to the tray',
    async () => {
      await Promise.race([
        waitForApp(300_000),
        tauri.exited.then((code) => {
          throw new Error(`tauri dev exited with ${String(code)} (see tauri-dev-2.log)`)
        }),
      ])
      const list = await windowsNow()
      assert(list.length > 0, 'no app window exists')
      assert(
        list.every((w) => !w.visible),
        'a window is visible after starting minimized',
      )
      mainHwnd = list[0].hwnd
      await sleep(2000)
      assert((await mainWindow())?.visible === false, 'the window showed up later')
      const tray = await ps.call(`Smoke-Tray 'Timer App' $false`)
      return `main window hidden; tray button ${String(tray)}`
    },
    { fatal: false },
  )
  if (!ready) return tauri
  await watcher.attach()
  const main = await Page.open(isMain, 'main')

  if (!options['skip-sign-in']) {
    await check('the stored token survives the restart, and Sign out removes it', async () => {
      assert(signedIn !== null, 'run 1 did not sign in (see its sign-in check)')
      await poll(
        () =>
          main.eval(
            `return app.authStore.status === 'signed-in' && app.remoteSync.status === 'online'`,
          ),
        'the restarted app signs in and syncs with the stored token',
        { timeout: 30_000 },
      )
      const token = await tokenInOsStoreOnly(main)
      assert(token.token === signedIn.token, 'the stored token changed across the restart')
      // Settings › Account › Sign out, clicked in the page (the window stays hidden).
      await main.eval(`
        const wait = async (find, what) => {
          for (let i = 0; i < 50; i++) {
            const found = find()
            if (found) return found
            await new Promise((r) => setTimeout(r, 100))
          }
          throw new Error('no ' + what)
        }
        document.querySelector('button[aria-label="Settings"]').click()
        ;(await wait(() => document.querySelector('[role=tab][id$="-tab-account"]'), 'Account tab')).click()
        const buttons = () => [...document.querySelectorAll('dialog[open] button')]
        ;(await wait(() => buttons().find((b) => b.textContent.trim() === 'Sign out'), 'Sign out button')).click()`)
      await poll(async () => {
        const state = await main.eval(TOKEN_STATE)
        const credential = tokenCredentialExists()
        const gone =
          state.status === 'signed-out' &&
          state.os === null &&
          state.bearer === null &&
          !state.device &&
          !credential
        // What is left, for the timeout's message (never the token itself).
        if (!gone) {
          throw new Error(
            `status ${String(state.status)}, OS store ${state.os ? 'has a token' : 'empty'}, ` +
              `request header ${state.bearer ? 'has a token' : 'empty'}, device store ` +
              `${state.device ? 'has a token' : 'empty'}, Credential Manager ` +
              `${credential ? `has ${TOKEN_TARGET}` : 'empty'}`,
          )
        }
        return true
      }, 'Sign out removes the token from the OS store and the app')
      await main.eval(`document.querySelector('dialog[open]')?.close()`)
      return `signed in and syncing after the restart with the token from ${TOKEN_TARGET}; Sign out removed it (the Credential Manager has no ${TOKEN_TARGET}; the device store has none)`
    })
  }

  await check('an alarm sounds in the never-shown window', async () => {
    const result = await main.eval(`
      window.__smokeAudio = []
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.__smokeAudio.push({ context: this.context, loop: this.loop })
        return start.apply(this, args)
      }
      const { timer } = await import('/src/core/index.ts')
      const id = app.cardStore.addTimer(2000, 'Smoke silent start')
      app.cardStore.timer(id, timer.start)
      return { id, activated: navigator.userActivation?.hasBeenActive ?? null }`)
    try {
      const state = await alarmAudio(main)
      return `a looping alarm source started; its audio context is ${state} (the page's user activation: ${String(result.activated)})`
    } finally {
      await main.eval(
        `app.cardStore.remove(${JSON.stringify(result.id)}); app.cardStore.forgetRemoved()`,
      )
    }
  })

  await check('a second instance exits and brings the window back where it was saved', async () => {
    const begin = Date.now()
    const second = spawnSync(DEBUG_EXE, [], {
      cwd: path.dirname(DEBUG_EXE),
      env: webviewEnv(),
      timeout: 30_000,
      windowsHide: true,
    })
    assert(second.status === 0, `the second instance exited with ${String(second.status)}`)
    const shown = await poll(async () => {
      const w = await mainWindow()
      return w?.visible ? w : null
    }, 'the first instance shows its window')
    const near = (a, b) => Math.abs(a - b) <= 2
    const { x, y, w, h } = SAVED_RECT
    assert(
      near(shown.x, x) && near(shown.y, y) && near(shown.w, w) && near(shown.h, h),
      `the window is at ${String(shown.x)},${String(shown.y)} ${String(shown.w)}×${String(shown.h)}, saved ${String(x)},${String(y)} ${String(w)}×${String(h)}`,
    )
    await sleep(500)
    await screenshot('08-second-instance-restored', mainHwnd)
    const front = await ps.call('Smoke-Foreground')
    return `exit code 0 after ${String(Date.now() - begin)} ms; window shown at ${String(shown.x)},${String(shown.y)} ${String(shown.w)}×${String(shown.h)}${front.hwnd === mainHwnd ? ', focused' : ' (not in front)'}`
  })

  await check('the app quits when its window closes with nothing running', async () => {
    await ps.call(`Smoke-Close ${String(mainHwnd)}`)
    await poll(() => appProcesses().length === 0, 'the app quits', { timeout: 15_000 })
    return 'quit'
  })
  main.close()
  watcher.close()
  return tauri
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('[smoke-desktop] This smoke test drives Windows (WebView2, Win32); run it there.')
    process.exit(2)
  }
  const unsafe = unsafeOutDir()
  if (unsafe !== null) {
    console.error(`[smoke-desktop] Not deleting --out: ${unsafe}. Pick another folder.`)
    process.exit(2)
  }
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'focus.ps1'), FOCUS_PS1)

  for (const port of [5173, 8787, CDP_PORT]) {
    if (await listening(port)) {
      console.error(
        `[smoke-desktop] Port ${String(port)} is in use; stop what listens there first.`,
      )
      process.exit(2)
    }
  }
  if (appProcesses().length > 0) {
    console.error('[smoke-desktop] A Timer App is running (single instance); quit it first.')
    process.exit(2)
  }
  if (!existsSync(TAURI_CLI)) {
    console.error('[smoke-desktop] The Tauri CLI is missing; run pnpm install.')
    process.exit(2)
  }

  const backup = path.join(OUT, 'window-state.backup.json')
  const hadState = existsSync(WINDOW_STATE)
  if (hadState) copyFileSync(WINDOW_STATE, backup)
  // A token an interrupted run left behind.
  deleteTokenCredential()

  /** Stops everything the run started and puts the window-state file back; once. */
  let cleanedUp = false
  const cleanUp = () => {
    if (cleanedUp) return
    cleanedUp = true
    ps?.close()
    killAll()
    for (const pid of appProcesses()) killTree(pid)
    if (hadState) copyFileSync(backup, WINDOW_STATE)
    else rmSync(WINDOW_STATE, { force: true })
    deleteTokenCredential()
  }
  // Ctrl+C or a kill: the same cleanup as the end of a run, which `finally` would not reach.
  const stop = () => {
    log('interrupted; cleaning up')
    cleanUp()
    process.exit(130)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  let report
  try {
    ps = new PowerShell()
    await ps.ready
    if (!options['skip-sign-in']) {
      log('starting the sync server (wrangler dev on 8787)')
      startSyncServer()
      await check(
        'the sync server starts',
        () =>
          poll(async () => (await fetch(`${SYNC_ORIGIN}/api/time`)).ok, 'wrangler answers', {
            timeout: 120_000,
            interval: 500,
          }).then(() => 'wrangler dev on 8787'),
        { fatal: true },
      )
    }
    const watcher = new Watcher()
    const first = await run1(watcher)
    await Promise.race([first.exited, sleep(15_000)])
    killTree(first.pid)
    await poll(async () => !(await listening(5173)), 'run 1 frees port 5173', { timeout: 15_000 })
    if (existsSync(WINDOW_STATE) && mainHwnd !== 0) {
      const second = await run2(watcher)
      await Promise.race([second.exited, sleep(15_000)])
      killTree(second.pid)
    }
  } catch (error) {
    log(`stopped: ${error instanceof Error ? error.message : String(error)}`)
    if (checks.length === 0 || checks.every((c) => c.ok)) {
      checks.push({ name: 'the run completes', ok: false, details: String(error), ms: 0 })
    }
  } finally {
    cleanUp()
    report = writeReport()
  }
  const busy = []
  for (const port of [5173, 8787, CDP_PORT]) if (await listening(port)) busy.push(port)
  if (busy.length > 0) log(`warning: ports still in use after cleanup: ${busy.join(', ')}`)
  log(`${report.ok ? 'PASSED' : 'FAILED'}; report: ${path.join(OUT, 'report.md')}`)
  process.exit(report.ok ? 0 : 1)
}

await main()
