import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ROOT } from './release.mjs'
import {
  CASK_TEMPLATE,
  caskDescription,
  caskToken,
  caskUrl,
  caskValues,
  dependsOnMacos,
  expandCaskUrl,
  main,
  pushCask,
  renderCask,
  rubyString,
  zapPaths,
} from './update-cask.mjs'
import { placeholderSha256, readApp, sha256 } from './winget-manifest.mjs'

const roots = []
/** Discards a line of output. */
const ignore = () => undefined
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const TAURI = {
  productName: 'Timer App',
  identifier: 'com.example.timer',
  bundle: {
    publisher: 'Jane Doe',
    copyright: 'Copyright © 2026 Jane Doe',
    shortDescription: 'A keyboard-first timer and stopwatch.',
    longDescription: 'Timers: type a duration and press Enter.',
    homepage: 'https://github.com/someone/timer-app',
    macOS: { minimumSystemVersion: '11.0' },
  },
  plugins: { updater: { pubkey: 'UPDATER_PUBKEY_PLACEHOLDER' } },
}

/** A repository with the app's files at `version`, `tauri` over the defaults, and the templates. */
function fixture({ version = '0.3.0', tauri = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'update-cask-'))
  roots.push(root)
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  const config = {
    ...TAURI,
    ...tauri,
    version,
    bundle: { ...TAURI.bundle, ...tauri.bundle },
    plugins: tauri.plugins ?? TAURI.plugins,
  }
  write(
    'package.json',
    `${JSON.stringify({ name: 'timer-app', version, license: 'MIT' }, null, 2)}\n`,
  )
  write('src-tauri/tauri.conf.json', `${JSON.stringify(config, null, 2)}\n`)
  write('src-tauri/Cargo.toml', `[package]\nname = "timer-app"\nversion = "${version}"\n`)
  write('src-tauri/Cargo.lock', `[[package]]\nname = "timer-app"\nversion = "${version}"\n`)
  cpSync(path.join(ROOT, 'packaging'), path.join(root, 'packaging'), { recursive: true })
  return root
}

/** A JSON response. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** `fetch` answering `routes` (URL → Response or `(init) => Response`), 404 otherwise. */
function fakeFetch(routes) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const route = routes[String(url)]
    if (route === undefined) return new Response('Not Found', { status: 404 })
    return typeof route === 'function' ? route(init) : route.clone()
  }
  return { fetch, calls }
}

const API = 'https://api.github.com/repos/someone/timer-app'
const TAP = 'https://api.github.com/repos/someone/homebrew-tap'

/** A published release `v0.3.0` whose DMGs are named `names` (arm first). */
function release(names = ['timer-app_0.3.0_darwin_aarch64.dmg', 'timer-app_0.3.0_darwin_x64.dmg']) {
  const digests = ['c'.repeat(64), 'd'.repeat(64)]
  return {
    tag_name: 'v0.3.0',
    published_at: '2026-11-02T10:20:30Z',
    assets: [
      { name: 'timer-app_0.3.0_windows_x64-setup.exe' },
      { name: 'timer-app_0.3.0_darwin_aarch64.app.tar.gz' },
      ...names.map((name, i) => ({ name, digest: `sha256:${digests[i]}` })),
    ].map((asset) => ({
      ...asset,
      url: `${API}/releases/assets/${asset.name.length}`,
      browser_download_url: `https://github.com/someone/timer-app/releases/download/v0.3.0/${asset.name}`,
    })),
  }
}

/** Runs the CLI in `root` with `argv`, collecting what it prints. */
async function run(argv, { root, fetch = fakeFetch({}).fetch, env = {} } = {}) {
  const outs = []
  const errors = []
  const code = await main(argv, {
    root,
    cwd: root,
    env,
    fetch,
    out: (text) => outs.push(text),
    err: (line) => errors.push(line),
  })
  return { code, out: outs.join(''), err: errors.join('\n') }
}

describe('Ruby and Homebrew conventions', () => {
  it('writes Ruby strings that never interpolate', () => {
    expect(rubyString('Timer App.app')).toBe('"Timer App.app"')
    expect(rubyString('a "b" \\ #{c} #$d #@e #f')).toBe('"a \\"b\\" \\\\ \\#{c} \\#$d \\#@e #f"')
    expect(() => rubyString('two\nlines')).toThrow(/control character/)
  })

  it('makes the token from the app name', () => {
    expect(caskToken('Timer App')).toBe('timer-app')
    expect(caskToken('  Foo++ Bar 2 ')).toBe('foo-bar-2')
    expect(() => caskToken('!!!')).toThrow()
  })

  it('turns the short description into a desc Homebrew accepts', () => {
    expect(caskDescription('A keyboard-first timer and stopwatch.', 'Timer App')).toBe(
      'Keyboard-first timer and stopwatch',
    )
    expect(caskDescription('the tool', 'X')).toBe('Tool')
    expect(() => caskDescription(`An ${'x'.repeat(81)}`, 'X')).toThrow(/81 characters/)
    expect(() => caskDescription('Timer for macOS', 'X')).toThrow(/platform/)
    expect(() => caskDescription('Timer-app for focus', 'Timer App')).toThrow(/app name/)
    expect(() => caskDescription('A command line timer', 'X')).toThrow(/command-line/)
  })

  it('declares a minimum macOS only above the oldest one Homebrew runs on', () => {
    expect(dependsOnMacos(null)).toBe('depends_on :macos')
    expect(dependsOnMacos('10.15')).toBe('depends_on :macos')
    expect(dependsOnMacos('11.0')).toBe('depends_on :macos')
    expect(dependsOnMacos('12.0')).toBe('depends_on macos: :monterey')
    expect(dependsOnMacos('15')).toBe('depends_on macos: :sequoia')
    expect(dependsOnMacos('26.0.1')).toBe('depends_on macos: :tahoe')
    expect(() => dependsOnMacos('99.0')).toThrow(/no Homebrew name/)
    expect(() => dependsOnMacos('eleven')).toThrow(/bad minimumSystemVersion/)
  })

  it('zaps the bundle id’s data and the login agent, sorted as the style check sorts', () => {
    const app = readApp(fixture())
    const paths = zapPaths(app)
    expect(paths).toContain('~/Library/WebKit/com.example.timer')
    expect(paths).toContain('~/Library/Application Support/com.example.timer')
    expect(paths).toContain('~/Library/LaunchAgents/Timer App.plist')
    const lines = paths.map((p) => `${rubyString(p)},`.toLowerCase())
    expect(lines).toEqual([...lines].sort())
    expect(paths.indexOf('~/Library/HTTPStorages/com.example.timer')).toBeLessThan(
      paths.indexOf('~/Library/HTTPStorages/com.example.timer.binarycookies'),
    )
  })
})

describe('the url', () => {
  const app = () => readApp(fixture())
  const dmg = (name, token) => ({ name, token, index: name.lastIndexOf(token) })

  it('interpolates the version and the arch word into the DMG names', () => {
    const dmgs = {
      arm: dmg('Timer.App_0.3.0_aarch64.dmg', 'aarch64'),
      intel: dmg('Timer.App_0.3.0_x64.dmg', 'x64'),
    }
    const url = caskUrl(app(), 'v0.3.0', dmgs)
    expect(url).toBe(
      '"https://github.com/someone/timer-app/releases/download/v#{version}/Timer.App_#{version}_#{arch}.dmg"',
    )
    expect(expandCaskUrl(url, { version: '0.3.0', arch: 'x64' })).toBe(
      'https://github.com/someone/timer-app/releases/download/v0.3.0/Timer.App_0.3.0_x64.dmg',
    )
  })

  it('follows a renaming pattern', () => {
    const dmgs = {
      arm: dmg('Timer.App_0.3.0_macos_aarch64.dmg', 'aarch64'),
      intel: dmg('Timer.App_0.3.0_macos_x64.dmg', 'x64'),
    }
    expect(caskUrl(app(), 'v0.3.0', dmgs)).toContain('/Timer.App_#{version}_macos_#{arch}.dmg"')
  })

  it('refuses names that differ in more than the arch, and a tag that is not the version', () => {
    const dmgs = {
      arm: dmg('A_0.3.0_aarch64.dmg', 'aarch64'),
      intel: dmg('B_0.3.0_x64.dmg', 'x64'),
    }
    expect(() => caskUrl(app(), 'v0.3.0', dmgs)).toThrow(/differ in more than the architecture/)
    const same = {
      arm: dmg('A_0.3.0_aarch64.dmg', 'aarch64'),
      intel: dmg('A_0.3.0_x64.dmg', 'x64'),
    }
    expect(() => caskUrl(app(), 'v0.3.1', same)).toThrow(/not v0\.3\.0/)
  })
})

describe('the cask', () => {
  const dmgs = {
    arm: {
      name: 'timer-app_0.3.0_darwin_aarch64.dmg',
      token: 'aarch64',
      index: 23,
      sha256: 'c'.repeat(64),
    },
    intel: {
      name: 'timer-app_0.3.0_darwin_x64.dmg',
      token: 'x64',
      index: 23,
      sha256: 'd'.repeat(64),
    },
  }

  it('renders every stanza in Homebrew’s order and layout', () => {
    const root = fixture()
    const cask = renderCask(
      root,
      caskValues(readApp(root), { tag: 'v0.3.0', dmgs, notice: '# note' }),
    )
    expect(cask).toBe(
      [
        '# note',
        'cask "timer-app" do',
        '  arch arm: "aarch64", intel: "x64"',
        '',
        '  version "0.3.0"',
        `  sha256 arm:   "${'c'.repeat(64)}",`,
        `         intel: "${'d'.repeat(64)}"`,
        '',
        '  url "https://github.com/someone/timer-app/releases/download/v#{version}/timer-app_#{version}_darwin_#{arch}.dmg"',
        '  name "Timer App"',
        '  desc "Keyboard-first timer and stopwatch"',
        '  homepage "https://github.com/someone/timer-app"',
        '',
        '  livecheck do',
        '    url :url',
        '    strategy :github_latest',
        '  end',
        '',
        '  depends_on :macos',
        '',
        '  app "Timer App.app"',
        '',
        '  zap trash: [',
        '    "~/Library/Application Support/com.example.timer",',
        '    "~/Library/Caches/com.example.timer",',
        '    "~/Library/HTTPStorages/com.example.timer",',
        '    "~/Library/HTTPStorages/com.example.timer.binarycookies",',
        '    "~/Library/LaunchAgents/Timer App.plist",',
        '    "~/Library/Preferences/com.example.timer.plist",',
        '    "~/Library/Saved Application State/com.example.timer.savedState",',
        '    "~/Library/WebKit/com.example.timer",',
        '  ]',
        'end',
        '',
      ].join('\n'),
    )
  })

  it('says auto_updates only once the updater has its key, and adds the notarization caveat on request', () => {
    const root = fixture({
      tauri: {
        bundle: { macOS: { minimumSystemVersion: '13.0' } },
        plugins: { updater: { pubkey: 'dW50cnVzdGVk' } },
      },
    })
    const cask = renderCask(
      root,
      caskValues(readApp(root), { tag: 'v0.3.0', dmgs, notice: '# note', notNotarized: true }),
    )
    expect(cask).toContain(
      '  end\n\n  auto_updates true\n  depends_on macos: :ventura\n\n  app "Timer App.app"',
    )
    expect(cask).toContain(
      '  ]\n\n  caveats <<~EOS\n    Timer App is not notarized by Apple. If macOS will not open it, choose Open Anyway\n' +
        '    in System Settings > Privacy & Security.\n  EOS\nend\n',
    )
    expect(cask).not.toMatch(/[ \t]$/m)
    for (const line of cask.split('\n')) expect(line.length, line).toBeLessThanOrEqual(118)
  })

  it('refuses a checksum that is not SHA-256', () => {
    const root = fixture()
    const bad = { ...dmgs, intel: { ...dmgs.intel, sha256: 'D'.repeat(64) } }
    expect(() => caskValues(readApp(root), { tag: 'v0.3.0', dmgs: bad, notice: '' })).toThrow(
      /intel DMG/,
    )
  })
})

describe('pushing to the tap', () => {
  const file = 'Casks/timer-app.rb'
  const base = {
    tap: 'someone/homebrew-tap',
    file,
    message: 'timer-app 0.3.0',
    token: 'tap-secret',
  }

  it('creates the cask in the tap', async () => {
    const { fetch, calls } = fakeFetch({
      [TAP]: json({ full_name: 'someone/homebrew-tap' }),
      [`${TAP}/contents/Casks/timer-app.rb`]: (init) =>
        init.method === 'PUT'
          ? json({ commit: { html_url: 'https://github.com/c/1' } }, 201)
          : json({}, 404),
    })
    expect(await pushCask({ ...base, text: 'cask "timer-app"\n', fetch })).toEqual({
      result: 'created',
      url: 'https://github.com/c/1',
    })
    const put = calls.find((call) => call.init.method === 'PUT')
    expect(JSON.parse(put.init.body)).toEqual({
      message: 'timer-app 0.3.0',
      content: Buffer.from('cask "timer-app"\n').toString('base64'),
    })
    for (const call of calls) expect(call.init.headers.Authorization).toBe('Bearer tap-secret')
  })

  it('updates the cask with the current file’s sha, and leaves an identical one alone', async () => {
    const existing = (text) =>
      json({ sha: 'abc123', content: Buffer.from(text).toString('base64'), html_url: 'h' })
    const update = fakeFetch({
      [TAP]: json({}),
      [`${TAP}/contents/Casks/timer-app.rb`]: (init) =>
        init.method === 'PUT' ? json({ commit: { html_url: 'u' } }) : existing('old\n'),
    })
    expect((await pushCask({ ...base, text: 'new\n', fetch: update.fetch })).result).toBe('updated')
    expect(JSON.parse(update.calls.at(-1).init.body).sha).toBe('abc123')

    const same = fakeFetch({
      [TAP]: json({}),
      [`${TAP}/contents/Casks/timer-app.rb`]: () => existing('same\n'),
    })
    expect(await pushCask({ ...base, text: 'same\n', fetch: same.fetch })).toEqual({
      result: 'unchanged',
      url: 'h',
    })
    expect(same.calls.some((call) => call.init.method === 'PUT')).toBe(false)
  })

  it('fails clearly when the tap is missing or the write is refused', async () => {
    await expect(pushCask({ ...base, text: 'x', fetch: fakeFetch({}).fetch })).rejects.toThrow(
      /the tap someone\/homebrew-tap does not exist/,
    )
    const refused = fakeFetch({
      [TAP]: json({}),
      [`${TAP}/contents/Casks/timer-app.rb`]: (init) =>
        init.method === 'PUT' ? json({ message: 'Resource not accessible' }, 403) : json({}, 404),
    })
    await expect(pushCask({ ...base, text: 'x', fetch: refused.fetch })).rejects.toThrow(
      /403.*not accessible/,
    )
  })
})

describe('the CLI', () => {
  it('--placeholder prints a cask that says it is one', async () => {
    const root = fixture()
    const result = await run(['--placeholder'], { root })
    expect(result.code).toBe(0)
    expect(result.out).toMatch(/^# PLACEHOLDER: no release v0\.3\.0 exists/m)
    expect(result.out).toContain(`sha256 arm:   "${placeholderSha256(1)}",`)
    expect(result.out).toContain('/v#{version}/timer-app_#{version}_darwin_#{arch}.dmg"')
  })

  it('--release reads the DMGs from the release and writes the cask to --out', async () => {
    const root = fixture()
    const { fetch } = fakeFetch({ [`${API}/releases/tags/v0.3.0`]: json(release()) })
    const result = await run(['--release', '--out', 'timer-app.rb'], { root, fetch })
    expect(result.code).toBe(0)
    const cask = readFileSync(path.join(root, 'timer-app.rb'), 'utf8')
    expect(cask).toContain(
      `sha256 arm:   "${'c'.repeat(64)}",\n         intel: "${'d'.repeat(64)}"`,
    )
    expect(cask).not.toMatch(/PLACEHOLDER|LOCAL/)
  })

  it('--out creates the folder it names', async () => {
    const root = fixture()
    const { fetch } = fakeFetch({ [`${API}/releases/tags/v0.3.0`]: json(release()) })
    const result = await run(['--release', '--out', 'tap/Casks/timer-app.rb'], { root, fetch })
    expect(result.code).toBe(0)
    expect(readFileSync(path.join(root, 'tap', 'Casks', 'timer-app.rb'), 'utf8')).toMatch(/^cask /m)
  })

  it('--release builds the url from renamed assets', async () => {
    const root = fixture()
    const names = ['Timer.App_0.3.0_macos_aarch64.dmg', 'Timer.App_0.3.0_macos_x64.dmg']
    const { fetch } = fakeFetch({ [`${API}/releases/tags/v0.3.0`]: json(release(names)) })
    const result = await run(['--release'], { root, fetch })
    expect(result.code).toBe(0)
    expect(result.out).toContain(
      'releases/download/v#{version}/Timer.App_#{version}_macos_#{arch}.dmg"',
    )
  })

  it('--push commits the rendered cask to the owner’s tap with HOMEBREW_TAP_TOKEN', async () => {
    const root = fixture()
    const { fetch, calls } = fakeFetch({
      [`${API}/releases/tags/v0.3.0`]: json(release()),
      [TAP]: json({}),
      [`${TAP}/contents/Casks/timer-app.rb`]: (init) =>
        init.method === 'PUT'
          ? json({ commit: { html_url: 'https://github.com/c/2' } }, 201)
          : json({}, 404),
    })
    const result = await run(['--release', '--push'], {
      root,
      fetch,
      env: { HOMEBREW_TAP_TOKEN: 'tap-secret' },
    })
    expect(result).toMatchObject({ code: 0, out: '' })
    expect(result.err).toBe(
      'created Casks/timer-app.rb in someone/homebrew-tap: https://github.com/c/2',
    )
    const put = JSON.parse(calls.find((call) => call.init.method === 'PUT').init.body)
    expect(Buffer.from(put.content, 'base64').toString()).toMatch(/^cask "timer-app" do$/m)
    expect(put.message).toBe('timer-app 0.3.0')
    expect(`${result.out}${result.err}`).not.toContain('tap-secret')
  })

  it('--push needs the token and a release; --dmg needs both disk images', async () => {
    const root = fixture()
    expect((await run(['--release', '--push'], { root })).code).toBe(1)
    expect(
      (await run(['--placeholder', '--push'], { root, env: { HOMEBREW_TAP_TOKEN: 't' } })).code,
    ).toBe(2)
    writeFileSync(path.join(root, 'arm.dmg'), 'arm image')
    expect((await run(['--dmg', 'arm=arm.dmg'], { root })).code).toBe(2)
  })

  it('--dmg hashes local disk images under Tauri’s default names', async () => {
    const root = fixture()
    writeFileSync(path.join(root, 'Timer App_0.3.0_aarch64.dmg'), 'arm image')
    writeFileSync(path.join(root, 'Timer App_0.3.0_x64.dmg'), 'intel image')
    const result = await run(
      ['--dmg', 'arm=Timer App_0.3.0_aarch64.dmg', '--dmg', 'intel=Timer App_0.3.0_x64.dmg'],
      { root },
    )
    expect(result.code).toBe(0)
    expect(result.out).toMatch(/^# LOCAL: /m)
    expect(result.out).toContain(`arm:   "${sha256('arm image')}"`)
    expect(result.out).toContain(`intel: "${sha256('intel image')}"`)
    expect(result.out).toContain('/v#{version}/timer-app_#{version}_darwin_#{arch}.dmg"')
  })

  it('answers usage errors with exit code 2', async () => {
    const root = fixture()
    for (const argv of [
      [],
      ['--release', '--placeholder'],
      ['--placeholder', '--version', '1.0'],
      ['--placeholder', '--tap', 'someone/tap'],
      ['--dmg', 'x86=a.dmg'],
      ['--unknown'],
    ]) {
      expect((await run(argv, { root })).code, argv.join(' ')).toBe(2)
    }
  })

  it('fails with exit code 1 when the release lacks a DMG', async () => {
    const root = fixture()
    const { fetch } = fakeFetch({
      [`${API}/releases/tags/v0.3.0`]: json(release(['timer-app_0.3.0_darwin_x64.dmg'])),
    })
    const result = await run(['--release'], { root, fetch })
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/no arm DMG/)
  })
})

describe('this repository', () => {
  it('renders the template from tauri.conf.json', async () => {
    const tauri = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'))
    const outs = []
    expect(await main(['--placeholder'], { out: (text) => outs.push(text), err: ignore })).toBe(0)
    const cask = outs.join('')
    expect(cask).toContain(`cask "${caskToken(tauri.productName)}" do`)
    expect(cask).toContain(`  app "${tauri.productName}.app"`)
    expect(cask).toContain(`  homepage "${tauri.bundle.homepage}"`)
    expect(cask).toContain(`"~/Library/WebKit/${tauri.identifier}",`)
    expect(cask).toContain(dependsOnMacos(tauri.bundle.macOS?.minimumSystemVersion ?? null))
    expect(cask.includes('auto_updates true')).toBe(readApp(ROOT).updaterConfigured)
    expect(readFileSync(path.join(ROOT, CASK_TEMPLATE), 'utf8')).toContain('cask {{token}} do')
  })
})
