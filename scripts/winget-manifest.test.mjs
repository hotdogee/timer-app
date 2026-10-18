import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseAssetName } from './check-latest-json.mjs'
import { ROOT } from './release.mjs'
import {
  MANIFEST_VERSION,
  PACKAGE_IDENTIFIER,
  WINGET_TEMPLATE_DIR,
  assetSha256,
  defaultAssetName,
  fetchRelease,
  githubRepo,
  main,
  pickInstaller,
  placeholderSha256,
  readApp,
  renderManifests,
  renderTemplate,
  sha256,
  wingetValues,
  yamlScalar,
} from './winget-manifest.mjs'

const roots = []
/** Discards a line of output. */
const ignore = () => undefined
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A temporary directory, removed after the test. */
function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'winget-manifest-'))
  roots.push(dir)
  return dir
}

const TAURI = {
  productName: 'Timer App',
  version: '0.3.0',
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

/** A repository with the app's files at version `version` and the real packaging templates. */
function fixture({ version = '0.3.0', tauri = TAURI } = {}) {
  const root = tempDir()
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  write(
    'package.json',
    `${JSON.stringify({ name: 'timer-app', version, license: 'MIT' }, null, 2)}\n`,
  )
  write('src-tauri/tauri.conf.json', `${JSON.stringify({ ...tauri, version }, null, 2)}\n`)
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

/** A published release `v0.3.0` with the release workflow's asset names. */
function release(overrides = {}) {
  const asset = (name, digest) => ({
    name,
    digest: digest === undefined ? undefined : `sha256:${digest}`,
    url: `${API}/releases/assets/${name.length}`,
    browser_download_url: `https://github.com/someone/timer-app/releases/download/v0.3.0/${name}`,
  })
  return {
    tag_name: 'v0.3.0',
    draft: false,
    published_at: '2026-11-02T10:20:30Z',
    assets: [
      asset('timer-app_0.3.0_windows_x64-setup.exe', 'a'.repeat(64)),
      asset('timer-app_0.3.0_windows_x64-setup.exe.sig', 'e'.repeat(64)),
      asset('timer-app_0.3.0_windows_x64.msi', 'f'.repeat(64)),
      asset('timer-app_0.3.0_windows_arm64-setup.exe', 'B'.repeat(64)),
      asset('timer-app_0.3.0_darwin_aarch64.dmg', 'c'.repeat(64)),
      asset('timer-app_0.3.0_darwin_x64.dmg', 'd'.repeat(64)),
      asset('latest.json'),
    ],
    ...overrides,
  }
}

/** Runs the CLI in `root` with `argv`, collecting what it prints. */
async function run(argv, { root, fetch = fakeFetch({}).fetch, env = {}, winget } = {}) {
  const lines = []
  const errors = []
  const code = await main(argv, {
    root,
    cwd: root,
    env,
    fetch,
    today: '2026-10-18',
    out: (line) => lines.push(line),
    err: (line) => errors.push(line),
    winget,
  })
  return { code, out: lines.join('\n'), err: errors.join('\n') }
}

/** The manifests `main` wrote into `dir`, by file name. */
function written(dir) {
  return Object.fromEntries(
    readdirSync(dir).map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
  )
}

describe('YAML scalars', () => {
  it('leaves plain text plain', () => {
    for (const text of [
      'Timer App',
      '0.3.0',
      'MIT',
      'https://github.com/x/y',
      'Copyright © 2026 Han Lin',
    ]) {
      expect(yamlScalar(text)).toBe(text)
    }
    expect(yamlScalar('A keyboard-first timer and stopwatch.')).toBe(
      'A keyboard-first timer and stopwatch.',
    )
    // A quote inside plain text is just a character.
    expect(yamlScalar("it's")).toBe("it's")
  })

  it('quotes what YAML would read as something else', () => {
    const quoted = {
      'a: b': "'a: b'",
      '%LocalAppData%\\Timer App': "'%LocalAppData%\\Timer App'",
      '1.0': "'1.0'",
      12: "'12'",
      true: "'true'",
      No: "'No'",
      '~': "'~'",
      ' padded': "' padded'",
      'a #comment': "'a #comment'",
      'ends with:': "'ends with:'",
      "'quoted'": "'''quoted'''",
      '- item': "'- item'",
      '1:20': "'1:20'",
      '0x1F': "'0x1F'",
    }
    for (const [text, yaml] of Object.entries(quoted)) expect(yamlScalar(text), text).toBe(yaml)
  })

  it('writes several lines as a literal block and refuses control characters', () => {
    expect(yamlScalar('one\n\ntwo')).toBe('|-\n  one\n\n  two')
    expect(() => yamlScalar('bell\u0007')).toThrow(/control character/)
  })
})

describe('templates', () => {
  it('replaces placeholders and indents values of several lines like their line', () => {
    expect(renderTemplate('a: {{x}}\n  {{list}}\nb', { x: '1', list: '- one\n- two' })).toBe(
      'a: 1\n  - one\n  - two\nb',
    )
  })

  it('drops a line that holds only an empty placeholder, and empties lines of spaces', () => {
    expect(renderTemplate('a\n  {{gone}}\nb\n  {{gap}}', { gone: '', gap: '\nc' })).toBe(
      'a\nb\n\n  c',
    )
  })

  it('refuses a placeholder without a value and a malformed one', () => {
    expect(() => renderTemplate('{{missing}}', {})).toThrow(/\{\{missing\}\}/)
    expect(() => renderTemplate('{{ spaced }}', {})).toThrow(/malformed/)
  })
})

describe('release assets', () => {
  it('knows the names the release workflow uploads bundles as', () => {
    const app = readApp(fixture())
    expect(defaultAssetName(app, 'nsis', 'arm64')).toBe('timer-app_0.3.0_windows_arm64-setup.exe')
    expect(defaultAssetName(app, 'dmg', 'aarch64')).toBe('timer-app_0.3.0_darwin_aarch64.dmg')
    expect(parseAssetName(defaultAssetName(app, 'nsis', 'x64'), '0.3.0')).toMatchObject({
      platform: 'windows',
      arch: 'x64',
      bundle: 'nsis',
    })
    expect(() => defaultAssetName(app, 'msi', 'x64')).toThrow(/unknown bundle kind/)
  })

  it('picks the NSIS installer per architecture, whatever the name pattern', () => {
    const assets = release().assets
    expect(pickInstaller(assets, 'x64').asset.name).toBe('timer-app_0.3.0_windows_x64-setup.exe')
    expect(pickInstaller(assets, 'arm64').asset.name).toBe(
      'timer-app_0.3.0_windows_arm64-setup.exe',
    )
    // Tauri's own names (no releaseAssetNamePattern), with [_setup], and a plain binary.
    const renamed = [
      { name: 'Timer.App_0.3.0_x64-setup.exe' },
      { name: 'Timer.App_0.3.0_aarch64_setup.exe' },
      { name: 'timer-app_windows_x64.exe' },
    ]
    expect(pickInstaller(renamed, 'x64').asset.name).toBe('Timer.App_0.3.0_x64-setup.exe')
    const arm = renamed[1].name
    expect(pickInstaller(renamed, 'arm64')).toMatchObject({
      token: 'aarch64',
      index: arm.indexOf('aarch64'),
    })
  })

  it('refuses a missing or ambiguous installer, listing the assets', () => {
    expect(() => pickInstaller([{ name: 'Timer.App_0.3.0_x64.dmg' }], 'arm64')).toThrow(
      /no arm64 NSIS installer.*\n\s+Timer\.App_0\.3\.0_x64\.dmg/s,
    )
    const two = [{ name: 'a_x64-setup.exe' }, { name: 'a_x64_fixed_webview2-setup.exe' }]
    expect(() => pickInstaller(two, 'x64')).toThrow(/2 candidates/)
  })

  it('reads a release by its tag, and a draft from the release list', async () => {
    const repo = githubRepo('https://github.com/someone/timer-app')
    const published = fakeFetch({ [`${API}/releases/tags/v0.3.0`]: json(release()) })
    expect((await fetchRelease({ repo, tag: 'v0.3.0', fetch: published.fetch })).tag_name).toBe(
      'v0.3.0',
    )

    const draft = fakeFetch({ [`${API}/releases?per_page=100`]: json([release({ draft: true })]) })
    const found = await fetchRelease({ repo, tag: 'v0.3.0', fetch: draft.fetch, token: 'secret' })
    expect(found.draft).toBe(true)
    expect(draft.calls[0].init.headers.Authorization).toBe('Bearer secret')

    const none = fakeFetch({ [`${API}/releases?per_page=100`]: json([]) })
    await expect(fetchRelease({ repo, tag: 'v0.3.0', fetch: none.fetch })).rejects.toThrow(
      /no release v0\.3\.0 \(a draft is visible only with GITHUB_TOKEN/,
    )
    const down = fakeFetch({ [`${API}/releases/tags/v0.3.0`]: json({}, 502) })
    await expect(fetchRelease({ repo, tag: 'v0.3.0', fetch: down.fetch })).rejects.toThrow(/502/)
  })

  it('takes the checksum GitHub records, or downloads and hashes the asset', async () => {
    const recorded = { name: 'x', digest: `sha256:${'AB'.repeat(32)}` }
    const nothing = fakeFetch({})
    expect(await assetSha256(recorded, { fetch: nothing.fetch })).toBe('ab'.repeat(32))
    expect(nothing.calls).toHaveLength(0)

    const bytes = new TextEncoder().encode('installer bytes')
    const asset = {
      name: 'x',
      url: `${API}/releases/assets/1`,
      browser_download_url: 'https://dl/x',
    }
    const plain = fakeFetch({ 'https://dl/x': new Response(bytes) })
    expect(await assetSha256(asset, { fetch: plain.fetch })).toBe(sha256(bytes))
    const api = fakeFetch({ [asset.url]: new Response(bytes) })
    expect(await assetSha256(asset, { fetch: api.fetch, token: 't' })).toBe(sha256(bytes))
    expect(api.calls[0].init.headers.Accept).toBe('application/octet-stream')
    await expect(assetSha256(asset, { fetch: fakeFetch({}).fetch })).rejects.toThrow(/404/)
  })
})

describe('the manifests', () => {
  const installers = [
    { arch: 'x64', url: 'https://example.com/a-setup.exe', sha256: 'ab'.repeat(32) },
    { arch: 'arm64', url: 'https://example.com/b-setup.exe', sha256: 'cd'.repeat(32) },
  ]

  it('renders the three files from the app and the installers', () => {
    const app = readApp(fixture())
    const values = wingetValues(app, { installers, releaseDate: '2026-11-02', notice: '# note' })
    const files = renderManifests(path.join(ROOT, WINGET_TEMPLATE_DIR), values)
    expect([...files.keys()]).toEqual([
      'Hotdogee.TimerApp.installer.yaml',
      'Hotdogee.TimerApp.locale.en-US.yaml',
      'Hotdogee.TimerApp.yaml',
    ])
    const installer = files.get('Hotdogee.TimerApp.installer.yaml')
    expect(installer).toContain(
      [
        'Installers:',
        '- Architecture: x64',
        '  InstallerUrl: https://example.com/a-setup.exe',
        `  InstallerSha256: ${'AB'.repeat(32)}`,
        '- Architecture: arm64',
      ].join('\n'),
    )
    expect(installer).toMatch(/^ProductCode: Timer App$/m)
    expect(installer).toMatch(/^ReleaseDate: 2026-11-02$/m)
    expect(installer).toMatch(/^ {2}DefaultInstallLocation: '%LocalAppData%\\Timer App'$/m)
    const locale = files.get('Hotdogee.TimerApp.locale.en-US.yaml')
    expect(locale).toMatch(/^Publisher: Jane Doe$/m)
    expect(locale).toMatch(/^PublisherUrl: https:\/\/github\.com\/someone$/m)
    expect(locale).toMatch(/^Description: 'Timers: type a duration and press Enter\.'$/m)
    expect(locale).toMatch(
      /^ReleaseNotesUrl: https:\/\/github\.com\/someone\/timer-app\/releases\/tag\/v0\.3\.0$/m,
    )
    expect(locale).toMatch(/^Moniker: timer-app$/m)
    for (const text of files.values()) {
      expect(text.startsWith('# note\n')).toBe(true)
      expect(text).toMatch(new RegExp(`^PackageIdentifier: ${PACKAGE_IDENTIFIER}$`, 'm'))
      expect(text).toMatch(/^PackageVersion: 0\.3\.0$/m)
      expect(text).toMatch(
        new RegExp(`^ManifestVersion: ${MANIFEST_VERSION.replaceAll('.', '\\.')}$`, 'm'),
      )
      expect(text).toContain(`.${MANIFEST_VERSION}.schema.json`)
      expect(text).not.toMatch(/[ \t]$/m)
    }
  })

  it('refuses installers it cannot list', () => {
    const app = readApp(fixture())
    const bad = (installer) => () =>
      wingetValues(app, {
        installers: [{ ...installers[0], ...installer }],
        releaseDate: '2026-11-02',
        notice: '',
      })
    expect(bad({ arch: 'x86' })).toThrow(/arch/)
    expect(bad({ url: 'http://example.com/a.exe' })).toThrow(/URL/)
    expect(bad({ sha256: 'abc' })).toThrow(/SHA-256/)
    expect(() =>
      wingetValues(app, { installers: [], releaseDate: '2026-11-02', notice: '' }),
    ).toThrow()
  })
})

describe('the CLI', () => {
  it('--placeholder renders validatable files that say they are placeholders', async () => {
    const root = fixture()
    const result = await run(['--placeholder', '--out', 'out'], { root })
    expect(result.code).toBe(0)
    const files = written(path.join(root, 'out'))
    expect(Object.keys(files)).toHaveLength(3)
    for (const text of Object.values(files))
      expect(text).toMatch(/^# PLACEHOLDER: no release v0\.3\.0 exists/m)
    const installer = files['Hotdogee.TimerApp.installer.yaml']
    expect(installer).toContain('releases/download/v0.3.0/timer-app_0.3.0_windows_x64-setup.exe')
    expect(installer).toContain('releases/download/v0.3.0/timer-app_0.3.0_windows_arm64-setup.exe')
    expect(installer).toContain(placeholderSha256(1).toUpperCase())
    expect(installer).toContain(placeholderSha256(2).toUpperCase())
    expect(installer).toMatch(/^ReleaseDate: 2026-10-18$/m)
  })

  it('--release lists the release’s installers with their checksums and date', async () => {
    const root = fixture()
    const { fetch } = fakeFetch({ [`${API}/releases/tags/v0.3.0`]: json(release()) })
    const result = await run(['--release', '--out', 'out'], { root, fetch })
    expect(result.code).toBe(0)
    const installer = written(path.join(root, 'out'))['Hotdogee.TimerApp.installer.yaml']
    expect(installer).toContain(`InstallerSha256: ${'A'.repeat(64)}`)
    expect(installer).toContain(`InstallerSha256: ${'B'.repeat(64)}`)
    expect(installer).toMatch(/^ReleaseDate: 2026-11-02$/m)
    expect(installer).not.toMatch(/PLACEHOLDER|LOCAL/)
    expect(installer).not.toContain('.msi')
  })

  it('--print-urls prints the installer URLs for wingetcreate, without downloading', async () => {
    const root = fixture()
    const plain = release()
    for (const asset of plain.assets) delete asset.digest
    const { fetch, calls } = fakeFetch({ [`${API}/releases/tags/v0.3.0`]: json(plain) })
    const result = await run(['--release', '--print-urls'], { root, fetch })
    expect(result).toMatchObject({ code: 0 })
    expect(result.out.split('\n')).toEqual([
      'https://github.com/someone/timer-app/releases/download/v0.3.0/timer-app_0.3.0_windows_x64-setup.exe|x64',
      'https://github.com/someone/timer-app/releases/download/v0.3.0/timer-app_0.3.0_windows_arm64-setup.exe|arm64',
    ])
    expect(calls).toHaveLength(1)
  })

  it('--installer hashes local files and lists only those', async () => {
    const root = fixture()
    writeFileSync(path.join(root, 'Timer App_0.3.0_x64-setup.exe'), 'local installer')
    const result = await run(['--installer', 'x64=Timer App_0.3.0_x64-setup.exe', '--out', 'out'], {
      root,
    })
    expect(result.code).toBe(0)
    const installer = written(path.join(root, 'out'))['Hotdogee.TimerApp.installer.yaml']
    expect(installer).toMatch(/^# LOCAL: /m)
    expect(installer).toContain('/releases/download/v0.3.0/timer-app_0.3.0_windows_x64-setup.exe')
    expect(installer).toContain(sha256('local installer').toUpperCase())
    expect(installer).not.toContain('arm64')
  })

  it('--validate runs winget validate and fails on its warnings too', async () => {
    const root = fixture()
    const calls = []
    const ok = await run(['--placeholder', '--out', 'out', '--validate'], {
      root,
      winget: (args) => (calls.push(args), 'Manifest validation succeeded.'),
    })
    expect(ok.code).toBe(0)
    expect(calls).toEqual([
      ['validate', '--manifest', path.join(root, 'out'), '--disable-interactivity'],
    ])
    const warned = await run(['--placeholder', '--out', 'out', '--validate'], {
      root,
      winget: () => {
        throw Object.assign(new Error('failed'), {
          status: 0x8a150028,
          stdout: 'Manifest Warning: …',
        })
      },
    })
    expect(warned.code).toBe(1)
    expect(warned.err).toMatch(/winget validate failed \(exit 0x8A150028\):\nManifest Warning/)
  })

  it('takes --version and --repo instead of the app’s own', async () => {
    const root = fixture()
    const other = 'https://api.github.com/repos/else/where/releases/tags/v1.2.3'
    const assets = [{ name: 'X_1.2.3_x64-setup.exe' }, { name: 'X_1.2.3_arm64-setup.exe' }].map(
      (a) => ({
        ...a,
        digest: `sha256:${'1'.repeat(64)}`,
        browser_download_url: `https://github.com/else/where/releases/download/v1.2.3/${a.name}`,
      }),
    )
    const { fetch } = fakeFetch({
      [other]: json({ tag_name: 'v1.2.3', published_at: null, assets }),
    })
    const result = await run(
      ['--release', '--print-urls', '--version', '1.2.3', '--repo', 'else/where'],
      {
        root,
        fetch,
      },
    )
    expect(result.code).toBe(0)
    expect(result.out).toContain(
      'else/where/releases/download/v1.2.3/X_1.2.3_arm64-setup.exe|arm64',
    )
  })

  it('answers usage errors with exit code 2', async () => {
    const root = fixture()
    for (const argv of [
      [],
      ['--out', 'out'],
      ['--release', '--placeholder', '--out', 'out'],
      ['--placeholder'],
      ['--placeholder', '--print-urls'],
      ['--release', '--print-urls', '--out', 'out'],
      ['--installer', 'x86=a.exe', '--out', 'out'],
      ['--installer', 'x64=a.exe', '--installer', 'x64=b.exe', '--out', 'out'],
      ['--placeholder', '--out', 'out', '--version', 'v1.0.0'],
      ['--placeholder', '--out', 'out', '--release-date', '18.10.2026'],
      ['--placeholder', '--out', 'out', '--repo', 'not a repo'],
      ['--bogus'],
    ]) {
      expect((await run(argv, { root })).code, argv.join(' ')).toBe(2)
    }
  })

  it('fails with exit code 1 when the release lacks an installer', async () => {
    const root = fixture()
    const partial = release({ assets: release().assets.filter((a) => !a.name.includes('arm64')) })
    const { fetch } = fakeFetch({ [`${API}/releases/tags/v0.3.0`]: json(partial) })
    const result = await run(['--release', '--out', 'out'], { root, fetch })
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/no arm64 NSIS installer/)
  })
})

describe('this repository', () => {
  const app = readApp(ROOT)
  const tauri = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'))

  it('names the package as the NSIS installer names its Add/Remove Programs entry', () => {
    // NSIS MANUFACTURER and PRODUCTNAME: winget matches installed copies by these.
    expect(app.publisher).toBe(tauri.bundle.publisher)
    expect(app.productName).toBe(tauri.productName)
    expect(tauri.bundle.windows?.nsis?.installMode).toBe('currentUser')
    expect(tauri.bundle.targets).toContain('nsis')
  })

  it('renders the templates for the current version', async () => {
    const dir = tempDir()
    const result = await main(['--placeholder', '--out', dir], { out: ignore, err: ignore })
    expect(result).toBe(0)
    const files = written(dir)
    expect(Object.keys(files).sort()).toEqual([
      'Hotdogee.TimerApp.installer.yaml',
      'Hotdogee.TimerApp.locale.en-US.yaml',
      'Hotdogee.TimerApp.yaml',
    ])
    const locale = files['Hotdogee.TimerApp.locale.en-US.yaml']
    expect(locale).toMatch(new RegExp(`^Publisher: ${tauri.bundle.publisher}$`, 'm'))
    expect(locale).toMatch(new RegExp(`^PackageName: ${tauri.productName}$`, 'm'))
    expect(locale).toMatch(/^License: MIT$/m)
    expect(files['Hotdogee.TimerApp.yaml']).toMatch(
      new RegExp(`^PackageVersion: ${app.version.replaceAll('.', '\\.')}$`, 'm'),
    )
  })
})
