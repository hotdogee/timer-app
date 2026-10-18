import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ASSET_NAME_PATTERN,
  LATEST_JSON,
  UPDATER_BUNDLES,
  assetName,
  checkLatestJson,
  expectedPlatforms,
  main,
  minisignKeyId,
  parseAssetName,
  signedVersion,
  updaterArch,
} from './check-latest-json.mjs'
import { PUBKEY_PLACEHOLDER, ROOT } from './release.mjs'

const VERSION = '1.2.3'
const REPO = 'hotdogee/timer-app'
const KEY = Buffer.from('0123456789abcdef', 'hex')
const OTHER_KEY = Buffer.from('fedcba9876543210', 'hex')

/** A minisign public key as Tauri stores it (base64 of the key file's text). */
function publicKey(keyId = KEY) {
  const bytes = Buffer.concat([Buffer.from('Ed'), keyId, Buffer.alloc(32, 7)])
  const id = keyId.toString('hex').toUpperCase()
  const text = `untrusted comment: minisign public key: ${id}\n${bytes.toString('base64')}\n`
  return Buffer.from(text).toString('base64')
}

/**
 * A minisign signature of `file` as the Tauri CLI writes a .sig file (base64 of the signature
 * text, with the version in the trusted comment unless `version` is null).
 */
function signatureOf(file, keyId = KEY, version = VERSION) {
  const sig = createHash('sha512').update(file).digest()
  const bytes = Buffer.concat([Buffer.from('ED'), keyId, sig])
  const comment = `timestamp:1760000000\tfile:${file}${version === null ? '' : `\tversion:${version}`}`
  const text =
    'untrusted comment: signature from tauri secret key\n' +
    `${bytes.toString('base64')}\n` +
    `trusted comment: ${comment}\n` +
    `${Buffer.alloc(64, 1).toString('base64')}`
  return Buffer.from(text).toString('base64')
}

/** The updater bundles of a full release by their latest.json keys, in tauri-action's names. */
const BUNDLES = Object.freeze({
  'windows-x86_64-nsis': 'timer-app_1.2.3_windows_x64-setup.exe',
  'windows-x86_64-msi': 'timer-app_1.2.3_windows_x64.msi',
  'windows-aarch64-nsis': 'timer-app_1.2.3_windows_arm64-setup.exe',
  'windows-aarch64-msi': 'timer-app_1.2.3_windows_arm64.msi',
  'darwin-aarch64-app': 'timer-app_1.2.3_darwin_aarch64.app.tar.gz',
  'darwin-x86_64-app': 'timer-app_1.2.3_darwin_x64.app.tar.gz',
  'linux-x86_64-appimage': 'timer-app_1.2.3_linux_amd64.AppImage',
  'linux-x86_64-deb': 'timer-app_1.2.3_linux_amd64.deb',
  'linux-x86_64-rpm': 'timer-app_1.2.3_linux_x86_64.rpm',
  'linux-aarch64-appimage': 'timer-app_1.2.3_linux_aarch64.AppImage',
  'linux-aarch64-deb': 'timer-app_1.2.3_linux_arm64.deb',
  'linux-aarch64-rpm': 'timer-app_1.2.3_linux_aarch64.rpm',
})

/** Each `{os}-{arch}` key and the bundle it names first. */
const PREFERRED = Object.freeze({
  'windows-x86_64': 'windows-x86_64-nsis',
  'windows-aarch64': 'windows-aarch64-nsis',
  'darwin-aarch64': 'darwin-aarch64-app',
  'darwin-x86_64': 'darwin-x86_64-app',
  'linux-x86_64': 'linux-x86_64-appimage',
  'linux-aarch64': 'linux-aarch64-appimage',
})

const BUILT = Object.keys(PREFERRED)

/** A release's assets: the bundles (each with its .sig), the DMGs and latest.json. */
function release({ bundles = BUNDLES, keyId = KEY, signedAs = VERSION } = {}) {
  let id = 100
  const assets = []
  const signatures = new Map()
  const add = (name) => {
    id += 1
    const asset = { name, apiUrl: `https://api.github.com/repos/${REPO}/releases/assets/${id}` }
    assets.push(asset)
    return asset
  }
  for (const name of Object.values(bundles)) {
    add(name)
    add(`${name}.sig`)
    signatures.set(`${name}.sig`, signatureOf(name, keyId, signedAs))
  }
  add('timer-app_1.2.3_darwin_aarch64.dmg')
  add('timer-app_1.2.3_darwin_x64.dmg')
  add(LATEST_JSON)
  return { assets, signatures }
}

/** latest.json as tauri-action writes it for `bundles` (keys and base keys from the tables). */
function tauriActionLatest({ assets, signatures }, bundles = BUNDLES) {
  const entry = (key) => {
    const name = bundles[key]
    return {
      signature: signatures.get(`${name}.sig`),
      url: assets.find((asset) => asset.name === name).apiUrl,
    }
  }
  const platforms = {}
  for (const [base, key] of Object.entries(PREFERRED)) {
    if (bundles[key] !== undefined) platforms[base] = entry(key)
  }
  for (const key of Object.keys(bundles)) platforms[key] = entry(key)
  return {
    version: VERSION,
    notes: 'See the release.',
    pub_date: '2026-10-20T08:00:00.000Z',
    platforms,
  }
}

describe('asset names', () => {
  it("renders tauri-action's names for each bundle", () => {
    const name = (platform, arch, bundle) => assetName({ version: VERSION, platform, arch, bundle })
    expect(name('windows', 'x64', 'nsis')).toBe('timer-app_1.2.3_windows_x64-setup.exe')
    expect(name('windows', 'arm64', 'msi')).toBe('timer-app_1.2.3_windows_arm64.msi')
    expect(name('darwin', 'aarch64', 'dmg')).toBe('timer-app_1.2.3_darwin_aarch64.dmg')
    expect(name('darwin', 'x64', 'app')).toBe('timer-app_1.2.3_darwin_x64.app.tar.gz')
    expect(name('linux', 'amd64', 'appimage')).toBe('timer-app_1.2.3_linux_amd64.AppImage')
    expect(name('linux', 'arm64', 'deb')).toBe('timer-app_1.2.3_linux_arm64.deb')
    expect(name('linux', 'x86_64', 'rpm')).toBe('timer-app_1.2.3_linux_x86_64.rpm')
    expect(() => name('linux', 'x86_64', 'snap')).toThrow(/unknown bundle/)
  })

  it('parses every name it renders, and its signature', () => {
    for (const name of Object.values(BUNDLES)) {
      const parsed = parseAssetName(name, VERSION)
      expect(parsed, name).not.toBeNull()
      expect(assetName({ version: VERSION, ...parsed })).toBe(name)
      expect(parseAssetName(`${name}.sig`, VERSION)).toEqual({ ...parsed, signature: true })
    }
    expect(parseAssetName('timer-app_1.2.3_linux_x86_64.rpm', VERSION)).toEqual({
      platform: 'linux',
      arch: 'x86_64',
      bundle: 'rpm',
      signature: false,
    })
  })

  it('rejects other versions, names and files', () => {
    for (const name of [
      'timer-app_1.2.30_windows_x64-setup.exe',
      'timer-app_1.2.4_windows_x64-setup.exe',
      'Timer.App_1.2.3_x64-setup.exe',
      'timer-app_1.2.3_windows_x64.exe',
      'timer-app_1.2.3_android_arm64.apk',
      'timer-app_1.2.3_linux_amd64.deb.sig.sig',
      LATEST_JSON,
    ]) {
      expect(parseAssetName(name, VERSION), name).toBeNull()
    }
  })

  it('spells architectures as the updater does', () => {
    expect(['x64', 'amd64', 'x86_64'].map(updaterArch)).toEqual(['x86_64', 'x86_64', 'x86_64'])
    expect(['arm64', 'aarch64'].map(updaterArch)).toEqual(['aarch64', 'aarch64'])
    expect(updaterArch('i686')).toBe('i686')
    expect(updaterArch('riscv64')).toBe('riscv64')
  })
})

describe('minisignKeyId', () => {
  it('reads the key id of a signature and of a public key', () => {
    expect(minisignKeyId(signatureOf('a.exe'), 'signature')).toBe('0123456789ABCDEF')
    expect(minisignKeyId(publicKey(), 'public key')).toBe('0123456789ABCDEF')
    expect(minisignKeyId(signatureOf('a.exe', OTHER_KEY), 'signature')).toBe('FEDCBA9876543210')
  })

  it('rejects anything else', () => {
    for (const text of ['', 'not base64 at all', Buffer.from('hello\nworld').toString('base64')]) {
      expect(() => minisignKeyId(text, 'signature')).toThrow(/not a minisign signature/)
    }
    // A signature is not a public key, and the other way round.
    expect(() => minisignKeyId(signatureOf('a.exe'), 'public key')).toThrow(/public key/)
    expect(() => minisignKeyId(publicKey(), 'signature')).toThrow(/signature/)
  })

  it('reads the version a signature was made for, when the CLI wrote one', () => {
    expect(signedVersion(signatureOf('a.exe'))).toBe(VERSION)
    expect(signedVersion(signatureOf('a.exe', KEY, '0.9.0'))).toBe('0.9.0')
    expect(signedVersion(signatureOf('a.exe', KEY, null))).toBeNull()
  })
})

describe('expectedPlatforms', () => {
  it('calls for one entry per signed bundle and one per target, preferring NSIS and the AppImage', () => {
    const { assets, signatures } = release()
    const { platforms, signed, problems } = expectedPlatforms({
      assets,
      signatures,
      version: VERSION,
    })
    expect(problems).toEqual([])
    expect(Object.keys(platforms).sort()).toEqual([...Object.keys(BUNDLES), ...BUILT].sort())
    expect(signed.map((entry) => entry.key).sort()).toEqual(Object.keys(BUNDLES).sort())
    for (const [base, key] of Object.entries(PREFERRED)) {
      expect(platforms[base], base).toEqual(platforms[key])
      expect(platforms[key].asset).toBe(BUNDLES[key])
    }
    const msi = assets.find((asset) => asset.name === BUNDLES['windows-x86_64-msi'])
    expect(platforms['windows-x86_64-msi']).toEqual({
      signature: signatures.get(`${msi.name}.sig`),
      url: msi.apiUrl,
      asset: msi.name,
    })
  })

  it('falls back to the next bundle when the preferred one is not signed', () => {
    const bundles = {
      'windows-x86_64-msi': BUNDLES['windows-x86_64-msi'],
      'linux-x86_64-deb': BUNDLES['linux-x86_64-deb'],
      'linux-x86_64-rpm': BUNDLES['linux-x86_64-rpm'],
    }
    const { platforms } = expectedPlatforms({ ...release({ bundles }), version: VERSION })
    expect(platforms['windows-x86_64'].asset).toBe(bundles['windows-x86_64-msi'])
    expect(platforms['linux-x86_64'].asset).toBe(bundles['linux-x86_64-deb'])
  })

  it('reports signatures it cannot use', () => {
    const { assets, signatures } = release({ bundles: {} })
    const stray = [
      'timer-app_1.2.2_windows_x64-setup.exe.sig',
      'timer-app_1.2.3_darwin_aarch64.dmg.sig',
      'timer-app_1.2.3_linux_amd64.deb.sig',
      'timer-app_1.2.3_linux_arm64.deb.sig',
    ]
    for (const name of stray) assets.push({ name, apiUrl: `https://api.github.com/x/${name}` })
    assets.push({ name: 'timer-app_1.2.3_linux_arm64.deb', apiUrl: 'https://api.github.com/x/deb' })
    for (const name of stray.slice(0, 3)) signatures.set(name, signatureOf(name))
    const { platforms, problems } = expectedPlatforms({ assets, signatures, version: VERSION })
    expect(platforms).toEqual({})
    expect(problems).toEqual([
      'timer-app_1.2.2_windows_x64-setup.exe.sig is not the signature of a version 1.2.3 updater bundle',
      'timer-app_1.2.3_darwin_aarch64.dmg.sig is not the signature of a version 1.2.3 updater bundle',
      'timer-app_1.2.3_linux_amd64.deb.sig has no timer-app_1.2.3_linux_amd64.deb beside it',
      'timer-app_1.2.3_linux_arm64.deb.sig was not downloaded',
    ])
  })
})

describe('checkLatestJson', () => {
  const check = (fixture, latest, options = {}) =>
    checkLatestJson({
      latest,
      ...fixture,
      version: VERSION,
      platforms: BUILT,
      pubkey: publicKey(),
      repo: REPO,
      tag: `v${VERSION}`,
      now: new Date('2026-10-21T00:00:00Z'),
      ...options,
    })

  it("accepts tauri-action's manifest for the whole matrix", () => {
    const fixture = release()
    const latest = tauriActionLatest(fixture)
    const result = check(fixture, latest)
    expect(result.problems).toEqual([])
    expect(result.repairable).toBe(true)
    expect(result.repaired).toEqual(latest)
  })

  it('accepts download URLs of the tag as well as API URLs', () => {
    const fixture = release()
    const latest = tauriActionLatest(fixture)
    latest.platforms['linux-x86_64-deb'].url =
      `https://github.com/${REPO}/releases/download/v${VERSION}/${BUNDLES['linux-x86_64-deb']}`
    expect(check(fixture, latest).problems).toEqual([])
    expect(check(fixture, latest, { tag: 'v9.9.9' }).problems).toHaveLength(1)
  })

  it('repairs the entries that two jobs uploading at once dropped', () => {
    const fixture = release()
    const full = tauriActionLatest(fixture)
    const latest = structuredClone(full)
    delete latest.platforms['linux-aarch64']
    delete latest.platforms['linux-aarch64-deb']
    const result = check(fixture, latest)
    expect(result.problems).toEqual([
      `latest.json has no linux-aarch64 (${BUNDLES['linux-aarch64-appimage']})`,
      `latest.json has no linux-aarch64-deb (${BUNDLES['linux-aarch64-deb']})`,
    ])
    expect(result.repairable).toBe(true)
    expect(result.repaired).toEqual(full)
    expect(check(fixture, result.repaired).problems).toEqual([])
  })

  it('repairs stale URLs and signatures, extra entries, the version and the date', () => {
    const fixture = release()
    const latest = tauriActionLatest(fixture)
    latest.version = '1.2.2'
    latest.pub_date = 'yesterday'
    latest.platforms['windows-x86_64'].url = latest.platforms['windows-x86_64-msi'].url
    latest.platforms['darwin-x86_64-app'].signature = signatureOf('old')
    latest.platforms['linux-x86_64-snap'] = { signature: 'x', url: 'https://example.com/x' }
    const result = check(fixture, latest)
    expect(result.problems).toEqual([
      'latest.json says version 1.2.2, not 1.2.3',
      'latest.json\'s pub_date "yesterday" is not RFC 3339',
      `latest.json's windows-x86_64 points to ${BUNDLES['windows-x86_64-msi']}, not ${BUNDLES['windows-x86_64-nsis']}`,
      `latest.json's darwin-x86_64-app signature is not the one in ${BUNDLES['darwin-x86_64-app']}.sig`,
      'latest.json lists linux-x86_64-snap, which has no signed bundle on the release',
    ])
    expect(result.repairable).toBe(true)
    expect(result.repaired).toEqual({
      ...tauriActionLatest(fixture),
      pub_date: '2026-10-21T00:00:00.000Z',
    })
  })

  it('writes a whole manifest when the release has none', () => {
    const fixture = release()
    const result = check(fixture, null, { notes: 'Notes.' })
    expect(result.problems).toEqual(['the release has no latest.json'])
    expect(result.repaired).toEqual({
      ...tauriActionLatest(fixture),
      notes: 'Notes.',
      pub_date: '2026-10-21T00:00:00.000Z',
    })
    expect(check(fixture, { version: VERSION }).problems).toEqual([
      'latest.json has no "platforms" object',
    ])
  })

  it('writes download URLs with downloadUrls, and rewrites API URLs to them', () => {
    const fixture = release()
    const download = (name) => `https://github.com/${REPO}/releases/download/v${VERSION}/${name}`
    const written = check(fixture, null, { notes: 'Notes.', downloadUrls: true })
    expect(written.problems).toEqual(['the release has no latest.json'])
    expect(written.repairable).toBe(true)
    for (const [key, entry] of Object.entries(written.repaired.platforms)) {
      const name = BUNDLES[key] ?? BUNDLES[PREFERRED[key]]
      expect(entry.url, key).toBe(download(name))
    }
    expect(check(fixture, written.repaired, { downloadUrls: true }).problems).toEqual([])
    // Without the flag, either form is accepted.
    expect(check(fixture, written.repaired).problems).toEqual([])

    const apiUrls = check(fixture, tauriActionLatest(fixture), { downloadUrls: true })
    expect(apiUrls.problems).toHaveLength(Object.keys(written.repaired.platforms).length)
    expect(apiUrls.problems[0]).toMatch(
      /^latest\.json's \S+ points to https:\/\/api\.github\.com\//,
    )
    expect(apiUrls.repairable).toBe(true)
    expect(apiUrls.repaired.platforms).toEqual(written.repaired.platforms)
    expect(() => check(fixture, null, { downloadUrls: true, repo: undefined })).toThrow(
      /repository/,
    )
  })

  it('fails without repair when a target was not built', () => {
    const bundles = { ...BUNDLES }
    delete bundles['darwin-x86_64-app']
    const fixture = release({ bundles })
    const result = check(fixture, tauriActionLatest(fixture, bundles))
    expect(result.problems).toEqual([
      'no signed updater bundle for darwin-x86_64 on the release: did its build run?',
    ])
    expect(result.repairable).toBe(false)
  })

  it('fails without repair when a bundle was signed with another key', () => {
    const fixture = release({ keyId: OTHER_KEY })
    const result = check(fixture, tauriActionLatest(fixture))
    expect(result.repairable).toBe(false)
    expect(result.problems).toHaveLength(Object.keys(BUNDLES).length)
    expect(result.problems[0]).toMatch(
      /signed with key FEDCBA9876543210, but the app trusts 0123456789ABCDEF/,
    )
    // Without the app's key, the signatures are only compared with the .sig files.
    expect(check(fixture, tauriActionLatest(fixture), { pubkey: undefined }).problems).toEqual([])
  })

  it('fails without repair when the bundles were signed as another version', () => {
    const fixture = release({ signedAs: '1.2.2' })
    const result = check(fixture, tauriActionLatest(fixture))
    expect(result.repairable).toBe(false)
    expect(result.problems).toContain(
      `${BUNDLES['windows-x86_64-nsis']} was signed as version 1.2.2, not 1.2.3`,
    )
    // Older CLIs wrote no version: nothing to compare.
    const unversioned = release({ signedAs: null })
    expect(check(unversioned, tauriActionLatest(unversioned)).problems).toEqual([])
  })

  it('fails without repair on a signature that is not minisign', () => {
    const fixture = release()
    const name = `${BUNDLES['linux-x86_64-rpm']}.sig`
    fixture.signatures.set(name, 'garbage')
    const result = check(fixture, tauriActionLatest(fixture))
    expect(result.problems).toEqual([
      `${BUNDLES['linux-x86_64-rpm']}.sig is not a minisign signature`,
    ])
    expect(result.repairable).toBe(false)
  })
})

describe('the CLI', () => {
  /** @type {string[]} */
  const dirs = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A download folder and an asset list as the publish job writes them. */
  function downloads({ latest, pubkey = publicKey() } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'latest-json-test-'))
    dirs.push(dir)
    const fixture = release()
    mkdirSync(path.join(dir, 'files'))
    for (const [name, text] of fixture.signatures)
      writeFileSync(path.join(dir, 'files', name), text)
    const manifest = latest === undefined ? tauriActionLatest(fixture) : latest
    if (manifest !== null) {
      writeFileSync(path.join(dir, 'files', LATEST_JSON), JSON.stringify(manifest, null, 2))
    }
    // gh prints more fields per asset; the script reads `name` and `apiUrl`.
    const assets = fixture.assets.map((asset) => ({ ...asset, state: 'uploaded', size: 1 }))
    writeFileSync(path.join(dir, 'assets.json'), JSON.stringify(assets))
    writeFileSync(
      path.join(dir, 'tauri.conf.json'),
      JSON.stringify({ plugins: { updater: { pubkey } } }),
    )
    const args = [
      '--version',
      VERSION,
      '--assets',
      path.join(dir, 'assets.json'),
      '--dir',
      path.join(dir, 'files'),
      '--platforms',
      BUILT.join(','),
      '--tauri-config',
      path.join(dir, 'tauri.conf.json'),
    ]
    return { dir, fixture, args }
  }

  function run(argv) {
    const output = { out: [], err: [] }
    const code = main(argv, {
      env: { GITHUB_REPOSITORY: REPO },
      now: new Date('2026-10-21T00:00:00Z'),
      out: (line) => output.out.push(line),
      err: (line) => output.err.push(line),
    })
    return { code, ...output }
  }

  it('passes a consistent release', () => {
    const { args } = downloads()
    const result = run(args)
    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expect(result.out).toEqual([
      `OK: latest.json for 1.2.3 lists ${[...Object.keys(BUNDLES), ...BUILT].sort().join(', ')}`,
    ])
  })

  it('fails on a dropped entry, and writes the repaired manifest with --write', () => {
    const fixture = release()
    const latest = tauriActionLatest(fixture)
    delete latest.platforms['windows-aarch64-msi']
    const { dir, args } = downloads({ latest })
    const failed = run(args)
    expect(failed.code).toBe(1)
    expect(failed.err).toContain(
      `  - latest.json has no windows-aarch64-msi (${BUNDLES['windows-aarch64-msi']})`,
    )

    const repaired = path.join(dir, 'repaired', LATEST_JSON)
    const fixed = run([...args, '--write', repaired])
    expect(fixed.code).toBe(0)
    expect(fixed.out.at(-1)).toMatch(/^Repaired: wrote /)
    expect(JSON.parse(readFileSync(repaired, 'utf8'))).toEqual(tauriActionLatest(fixture))

    // The repaired file passes in its turn.
    writeFileSync(path.join(dir, 'files', LATEST_JSON), readFileSync(repaired))
    expect(run(args).code).toBe(0)
  })

  it('writes nothing and fails when the signatures cannot fix it', () => {
    const { dir, args } = downloads({ pubkey: publicKey(OTHER_KEY) })
    const repaired = path.join(dir, 'repaired', LATEST_JSON)
    const result = run([...args, '--write', repaired])
    expect(result.code).toBe(1)
    expect(result.err.at(-1)).toMatch(/cannot fix this/)
    expect(() => readFileSync(repaired)).toThrow()
  })

  it('creates the manifest when the release has none', () => {
    const { dir, args } = downloads({ latest: null })
    const repaired = path.join(dir, 'out.json')
    expect(run([...args, '--notes', 'Hi.', '--write', repaired]).code).toBe(0)
    expect(JSON.parse(readFileSync(repaired, 'utf8')).notes).toBe('Hi.')
  })

  it('writes download URLs with --download-urls, which need the repository', () => {
    const { dir, args } = downloads({ latest: null })
    const repaired = path.join(dir, 'out.json')
    expect(run([...args, '--download-urls', '--write', repaired]).code).toBe(0)
    const { platforms } = JSON.parse(readFileSync(repaired, 'utf8'))
    expect(platforms['windows-x86_64'].url).toBe(
      `https://github.com/${REPO}/releases/download/v${VERSION}/${BUNDLES['windows-x86_64-nsis']}`,
    )
    const output = { out: [], err: [] }
    const code = main([...args, '--download-urls'], {
      env: {},
      out: (line) => output.out.push(line),
      err: (line) => output.err.push(line),
    })
    expect(code).toBe(2)
    expect(output.err.join('\n')).toMatch(/--repo/)
  })

  it('skips the key check while the app has the placeholder key', () => {
    const { args } = downloads({ pubkey: PUBKEY_PLACEHOLDER })
    const result = run(args)
    expect(result.code).toBe(0)
    expect(result.out[0]).toMatch(/^Skipping the key check/)
  })

  it('exits 2 on usage errors', () => {
    const { dir, args } = downloads()
    expect(run([]).code).toBe(2)
    expect(run(['--version', '1.2', ...args.slice(2)]).code).toBe(2)
    expect(run([...args, '--bogus']).code).toBe(2)
    writeFileSync(path.join(dir, 'assets.json'), '{"nope":1}')
    expect(run(args).code).toBe(2)
  })
})

describe('the release workflow', () => {
  const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')

  it("names the assets with this script's pattern, and only this script writes latest.json", () => {
    const pattern = /releaseAssetNamePattern:\s*'([^'\n]+)'/.exec(workflow)
    expect(pattern?.[1]).toBe(ASSET_NAME_PATTERN)
    // Every tauri-action step leaves latest.json alone (its matrix jobs would race to rewrite it);
    // publish writes it from the signatures, with download URLs, and prefers NSIS on Windows.
    const steps = workflow.split(/\n(?=\s+- )/).filter((step) => step.includes('tauri-action@'))
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) expect(step).toMatch(/uploadUpdaterJson:\s*false/)
    // (the command's continued lines: `\` at each line's end)
    expect(workflow).toMatch(/check-latest-json\.mjs(?:[^\n]*\\\n)*[^\n]*--download-urls/)
    expect(UPDATER_BUNDLES.windows[0]).toBe('nsis')
  })

  it('checks latest.json for every updater target the matrix builds', () => {
    const matrix = [...workflow.matchAll(/^\s+updater:\s*([\w-]+)\s*$/gm)].map((match) => match[1])
    const checked = /UPDATER_PLATFORMS:\s*([\w,-]+)/.exec(workflow)?.[1].split(',')
    expect(matrix.length).toBeGreaterThan(0)
    expect([...new Set(matrix)].sort()).toEqual(matrix.toSorted())
    expect(checked?.toSorted()).toEqual(matrix.toSorted())
  })
})
