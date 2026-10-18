#!/usr/bin/env node
/**
 * Checks a draft release's `latest.json`, the in-app updater's manifest, against the signed
 * bundles on the same release, and writes or repairs it when it can (`.github/workflows/release.yml`
 * › publish, before the release is made public).
 *
 *   node scripts/check-latest-json.mjs --version x.y.z --assets assets.json --dir <downloads>
 *     [--platforms windows-x86_64,darwin-aarch64,…] [--tauri-config src-tauri/tauri.conf.json]
 *     [--tag vX.Y.Z] [--repo owner/name] [--notes text] [--download-urls]
 *     [--write repaired/latest.json]
 *
 * - `--assets`: the release's assets, as `gh release view <tag> --json assets --jq .assets`
 *   prints them (`name` and `apiUrl` are read).
 * - `--dir`: a folder holding the release's `latest.json` (when it has one) and its `*.sig`
 *   files, as `gh release download <tag> --pattern '*.sig' --pattern latest.json` saves them.
 * - `--platforms`: the `{os}-{arch}` targets the release was built for; each must have a signed
 *   bundle and an entry.
 * - `--tauri-config`: checks that every signature was made with the key whose public half is the
 *   app's `plugins.updater.pubkey` (skipped while that is the placeholder).
 *
 * - `--download-urls`: each entry's `url` is the asset's download URL,
 *   `https://github.com/<repo>/releases/download/<tag>/<name>` (the default is its API URL,
 *   `https://api.github.com/repos/<repo>/releases/assets/<id>`, as tauri-action writes it). Download
 *   URLs work once the release is public and, unlike API URLs, are not limited to 60 requests an
 *   hour per IP address; with this flag an API URL counts as a problem the file rewrite fixes.
 *
 * tauri-action's own `latest.json` (`uploadUpdaterJson`) is written by each matrix job in turn:
 * it downloads the current file, adds its own targets and uploads it again, so jobs that finish
 * together race (dropped entries, or a failed job). The release workflow turns it off, and this
 * script writes the file instead. Every entry follows from the signatures: it builds the expected
 * manifest from the `.sig` assets: `{os}-{arch}-{bundle}` for
 * each signed bundle, and `{os}-{arch}` for the preferred one (NSIS on Windows, as
 * `updaterJsonPreferNsis` sets; the AppImage on Linux; the `.app.tar.gz` on macOS). Any
 * difference is a problem; with `--write`, problems the signatures can fix (no file at all, a
 * lost, stale or extra entry, a wrong version or date) are fixed in a file written there, for the
 * workflow to upload (in place of the old one, if any), and anything else (a target that was not built, a signature
 * without its bundle, the wrong key) fails.
 *
 * Exit codes: 0 consistent (or repaired, with `--write`), 1 problems, 2 a usage error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { PUBKEY_PLACEHOLDER, ReleaseError, parseVersion } from './release.mjs'

/**
 * The release assets' names: tauri-action's `releaseAssetNamePattern` in release.yml (a test
 * keeps the two equal). `[platform]` is `windows`, `darwin` or `linux`; `[arch]` is the bundle's
 * own spelling (`x64`/`arm64` on Windows, `aarch64`/`x64` on macOS, `amd64`/`arm64` for .deb,
 * `x86_64`/`aarch64` for .rpm, `amd64`/`aarch64` for the AppImage); `[setup]` is `-setup` for
 * the NSIS installer. The name has no spaces, so GitHub keeps it as is.
 */
export const ASSET_NAME_PATTERN = 'timer-app_[version]_[platform]_[arch][setup][ext]'

/** Each bundle's file extension, in an asset name. */
const BUNDLE_EXTENSIONS = Object.freeze({
  nsis: '.exe',
  msi: '.msi',
  dmg: '.dmg',
  app: '.app.tar.gz',
  appimage: '.AppImage',
  deb: '.deb',
  rpm: '.rpm',
})

/** The bundles the updater installs, per OS, the one `{os}-{arch}` points to first. */
export const UPDATER_BUNDLES = Object.freeze({
  windows: Object.freeze(['nsis', 'msi']),
  darwin: Object.freeze(['app']),
  linux: Object.freeze(['appimage', 'deb', 'rpm']),
})

/** The latest.json file name. */
export const LATEST_JSON = 'latest.json'

const USAGE = `Usage: node scripts/check-latest-json.mjs --version x.y.z --assets assets.json --dir <downloads>
  [--platforms windows-x86_64,…] [--tauri-config src-tauri/tauri.conf.json] [--tag vX.Y.Z]
  [--repo owner/name] [--notes text] [--download-urls] [--write repaired/latest.json]`

// ── Asset names ─────────────────────────────────────────────────────────────────────────────

/**
 * The release asset name of a bundle: `platform` `windows`, `darwin` or `linux`, `arch` as the
 * bundle spells it, `bundle` one of `nsis`, `msi`, `dmg`, `app`, `appimage`, `deb`, `rpm`.
 */
export function assetName({ version, platform, arch, bundle }) {
  const ext = BUNDLE_EXTENSIONS[bundle]
  if (ext === undefined) throw new ReleaseError(`unknown bundle: ${bundle}`)
  const values = { version, platform, arch, setup: bundle === 'nsis' ? '-setup' : '', ext }
  return ASSET_NAME_PATTERN.replace(/\[(\w+)\]/g, (match, key) => values[key] ?? match)
}

/** A regular expression that matches `text` literally. */
function literal(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The bundle a release asset of version `version` holds, from its name: `{ platform, arch,
 * bundle, signature }` (`signature` true for its `.sig`), or null for any other name.
 */
export function parseAssetName(name, version) {
  const exts = Object.entries(BUNDLE_EXTENSIONS)
    .map(([bundle, ext]) => (bundle === 'nsis' ? `-setup${ext}` : ext))
    .map(literal)
    .join('|')
  const pattern = new RegExp(
    `^${literal(ASSET_NAME_PATTERN)
      .replace(literal('[version]'), literal(version))
      .replace(literal('[platform]'), '(windows|darwin|linux)')
      .replace(literal('[arch]'), '([A-Za-z0-9_]+)')
      .replace(literal('[setup]'), '')
      .replace(literal('[ext]'), `(${exts})`)}(\\.sig)?$`,
  )
  const match = pattern.exec(name)
  if (match === null) return null
  const [, platform, arch, ext, sig] = match
  const bundle = Object.keys(BUNDLE_EXTENSIONS).find(
    (key) => (key === 'nsis' ? `-setup${BUNDLE_EXTENSIONS[key]}` : BUNDLE_EXTENSIONS[key]) === ext,
  )
  return { platform, arch, bundle, signature: sig !== undefined }
}

/** The updater's spelling of a bundle's architecture (`x86_64`, `aarch64`, …). */
export function updaterArch(arch) {
  if (['x64', 'amd64', 'x86_64'].includes(arch)) return 'x86_64'
  if (['arm64', 'aarch64'].includes(arch)) return 'aarch64'
  if (['x86', 'i386', 'i686'].includes(arch)) return 'i686'
  if (['arm', 'armhf', 'armv7'].includes(arch)) return 'armv7'
  return arch
}

// ── Signatures ──────────────────────────────────────────────────────────────────────────────

/**
 * A minisign signature or public key, as Tauri stores them (base64 of the minisign file's text):
 * its key id (16 hex digits) and, for a signature, its trusted comment. Throws a
 * {@link ReleaseError} when it is not one.
 */
function readMinisign(base64, kind) {
  const text = Buffer.from(String(base64), 'base64').toString('utf8')
  const lines = text.split(/\r?\n/)
  const bytes = lines[1] === undefined ? Buffer.alloc(0) : Buffer.from(lines[1], 'base64')
  const length = kind === 'public key' ? 42 : 74
  const algorithm = bytes.subarray(0, 2).toString('latin1')
  const algorithms = kind === 'public key' ? ['Ed'] : ['Ed', 'ED']
  const trusted = /^trusted comment: (.*)$/.exec(lines[2] ?? '')
  if (
    !lines[0]?.startsWith('untrusted comment:') ||
    bytes.length !== length ||
    !algorithms.includes(algorithm) ||
    (kind === 'signature' && trusted === null)
  ) {
    throw new ReleaseError(`not a minisign ${kind}`)
  }
  return { keyId: bytes.subarray(2, 10).toString('hex').toUpperCase(), trusted: trusted?.[1] ?? '' }
}

/** The key id (16 hex digits) of a minisign signature or public key (see {@link readMinisign}). */
export function minisignKeyId(base64, kind) {
  return readMinisign(base64, kind).keyId
}

/**
 * The version a minisign signature says it was made for: the `version:` field of its trusted
 * comment, which the Tauri CLI writes and the updater compares with the manifest's `version`.
 * Null for a signature without one (older CLIs).
 */
export function signedVersion(base64) {
  const field = readMinisign(base64, 'signature')
    .trusted.split('\t')
    .find((part) => part.startsWith('version:'))
  return field === undefined ? null : field.slice('version:'.length)
}

// ── The check ───────────────────────────────────────────────────────────────────────────────

/** Whether `text` is an RFC 3339 date-time, as the updater reads `pub_date`. */
function isRfc3339(text) {
  return (
    typeof text === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(text) &&
    !Number.isNaN(Date.parse(text))
  )
}

/**
 * The manifest entries the release's signed bundles call for, as `{ platforms, signed, problems }`:
 * `platforms` maps each `{os}-{arch}-{bundle}` and `{os}-{arch}` key to `{ signature, url, asset }`
 * (`asset` the bundle's name, `url` what `urlOf` gives for its asset, by default its API URL as
 * tauri-action writes it), `signed` lists each
 * signed bundle once (`{ key, signature, asset }`, by its `{os}-{arch}-{bundle}` key), and
 * `problems` the signatures that cannot be used.
 */
export function expectedPlatforms({
  assets,
  signatures,
  version,
  urlOf = (asset) => asset.apiUrl,
}) {
  const problems = []
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  const found = new Map()
  for (const asset of assets) {
    if (!asset.name.endsWith('.sig')) continue
    const parsed = parseAssetName(asset.name, version)
    const target = asset.name.slice(0, -'.sig'.length)
    const bundles = parsed === null ? undefined : UPDATER_BUNDLES[parsed.platform]
    if (parsed === null || !bundles.includes(parsed.bundle)) {
      problems.push(`${asset.name} is not the signature of a version ${version} updater bundle`)
      continue
    }
    const bundle = byName.get(target)
    if (bundle === undefined) {
      problems.push(`${asset.name} has no ${target} beside it`)
      continue
    }
    const signature = signatures.get(asset.name)
    if (signature === undefined) {
      problems.push(`${asset.name} was not downloaded`)
      continue
    }
    const os = parsed.platform
    const key = `${os}-${updaterArch(parsed.arch)}`
    const url = urlOf(bundle)
    const entry = { signature, url, asset: bundle.name }
    if (typeof url !== 'string' || url === '') {
      problems.push(`${target} has no API URL in the asset list`)
      continue
    }
    if (found.has(`${key}-${parsed.bundle}`)) {
      problems.push(`${key}-${parsed.bundle} has two signed bundles`)
      continue
    }
    found.set(`${key}-${parsed.bundle}`, { ...entry, os, key, bundle: parsed.bundle })
  }
  const platforms = {}
  const signed = []
  for (const [installerKey, entry] of found) {
    signed.push({ key: installerKey, signature: entry.signature, asset: entry.asset })
    platforms[installerKey] = { signature: entry.signature, url: entry.url, asset: entry.asset }
    const preferred = UPDATER_BUNDLES[entry.os].find((bundle) =>
      found.has(`${entry.key}-${bundle}`),
    )
    if (preferred === entry.bundle) {
      platforms[entry.key] = { signature: entry.signature, url: entry.url, asset: entry.asset }
    }
  }
  return { platforms, signed, problems }
}

/** The download URL of release asset `name`: public once the release is published. */
export function downloadUrl({ repo, tag, name }) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
}

/**
 * The release asset `url` points to: an API asset URL (`…/releases/assets/<id>`, tauri-action's
 * form) or, with `repo` and `tag`, a download URL (`https://github.com/<repo>/releases/download/
 * <tag>/<name>`). Undefined for anything else.
 */
function assetAt(url, assets, { repo, tag }) {
  const api = assets.find((asset) => asset.apiUrl === url)
  if (api !== undefined) return api
  if (repo === undefined || tag === undefined) return undefined
  const prefix = `https://github.com/${repo}/releases/download/${tag}/`
  if (typeof url !== 'string' || !url.startsWith(prefix)) return undefined
  const name = url.slice(prefix.length)
  return assets.find((asset) => asset.name === name || encodeURIComponent(asset.name) === name)
}

/**
 * Compares `latest` (the parsed latest.json, or null when the release has none) with what the
 * release's signed bundles call for. Returns `{ problems, repairable, repaired, platforms }`:
 * every problem found, whether rewriting the file from the signatures fixes all of them, that
 * rewritten manifest, and the expected entries. `platforms` (the `{os}-{arch}` targets that were
 * built) and `pubkey` (the app's updater public key) are optional. With `downloadUrls`, the
 * entries use download URLs (which need `repo` and `tag`) and an entry with another URL for the
 * right asset is a problem the rewrite fixes.
 */
export function checkLatestJson({
  latest,
  assets,
  signatures,
  version,
  platforms: built = [],
  pubkey,
  repo,
  tag,
  notes = '',
  downloadUrls = false,
  now = new Date(),
}) {
  if (downloadUrls && (repo === undefined || tag === undefined)) {
    throw new ReleaseError('download URLs need the repository and the tag', 2)
  }
  const fixable = []
  const fatal = []
  const urlOf = downloadUrls ? (asset) => downloadUrl({ repo, tag, name: asset.name }) : undefined
  const expected = expectedPlatforms({ assets, signatures, version, urlOf })
  fatal.push(...expected.problems)

  for (const key of built) {
    if (expected.platforms[key] === undefined) {
      fatal.push(`no signed updater bundle for ${key} on the release: did its build run?`)
    }
  }
  const trustedKey = pubkey === undefined ? undefined : minisignKeyId(pubkey, 'public key')
  for (const entry of expected.signed) {
    let signature
    try {
      signature = readMinisign(entry.signature, 'signature')
    } catch {
      fatal.push(`${entry.asset}.sig is not a minisign signature`)
      continue
    }
    if (trustedKey !== undefined && signature.keyId !== trustedKey) {
      fatal.push(
        `${entry.asset} is signed with key ${signature.keyId}, but the app trusts ${trustedKey} ` +
          '(TAURI_SIGNING_PRIVATE_KEY and plugins.updater.pubkey are not a pair)',
      )
    }
    // The updater refuses a signature made for another version than the manifest announces.
    const signedFor = signedVersion(entry.signature)
    if (signedFor !== null && signedFor.replace(/^v/, '') !== version) {
      fatal.push(`${entry.asset} was signed as version ${signedFor}, not ${version}`)
    }
  }

  const listed = latest?.platforms
  if (latest === null) {
    fixable.push(`the release has no ${LATEST_JSON}`)
  } else if (typeof latest !== 'object' || listed === null || typeof listed !== 'object') {
    fixable.push(`${LATEST_JSON} has no "platforms" object`)
  } else {
    if (String(latest.version).replace(/^v/, '') !== version) {
      fixable.push(`${LATEST_JSON} says version ${String(latest.version)}, not ${version}`)
    }
    if (!isRfc3339(latest.pub_date)) {
      fixable.push(`${LATEST_JSON}'s pub_date ${JSON.stringify(latest.pub_date)} is not RFC 3339`)
    }
    for (const [key, entry] of Object.entries(expected.platforms)) {
      const actual = listed[key]
      if (actual === undefined) {
        fixable.push(`${LATEST_JSON} has no ${key} (${entry.asset})`)
        continue
      }
      const at = assetAt(actual?.url, assets, { repo, tag })
      if (at?.name !== entry.asset) {
        fixable.push(
          `${LATEST_JSON}'s ${key} points to ${at?.name ?? String(actual?.url)}, not ${entry.asset}`,
        )
      } else if (actual.signature !== entry.signature) {
        fixable.push(`${LATEST_JSON}'s ${key} signature is not the one in ${entry.asset}.sig`)
      } else if (downloadUrls && actual.url !== entry.url) {
        fixable.push(`${LATEST_JSON}'s ${key} points to ${String(actual.url)}, not ${entry.url}`)
      }
    }
    for (const key of Object.keys(listed)) {
      if (expected.platforms[key] === undefined) {
        fixable.push(`${LATEST_JSON} lists ${key}, which has no signed bundle on the release`)
      }
    }
  }

  const keepDate = isRfc3339(latest?.pub_date) ? latest.pub_date : now.toISOString()
  const repaired = {
    version,
    notes: typeof latest?.notes === 'string' ? latest.notes : notes,
    pub_date: keepDate,
    platforms: Object.fromEntries(
      Object.entries(expected.platforms)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, { signature: entry.signature, url: entry.url }]),
    ),
  }
  return {
    problems: [...fatal, ...fixable],
    repairable: fatal.length === 0,
    repaired,
    platforms: expected.platforms,
  }
}

// ── Command line ────────────────────────────────────────────────────────────────────────────

/** Reads and parses a JSON file, or throws a {@link ReleaseError} saying which. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ReleaseError(
      `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Runs the script with arguments `argv` and returns its exit code. `context` replaces the
 * environment, the clock and the output, for tests.
 */
export function main(argv, context = {}) {
  const env = context.env ?? process.env
  const now = context.now ?? new Date()
  const out = context.out ?? ((line) => console.log(line))
  const err = context.err ?? ((line) => console.error(line))
  try {
    let options
    try {
      options = parseArgs({
        args: argv,
        options: {
          version: { type: 'string' },
          assets: { type: 'string' },
          dir: { type: 'string' },
          platforms: { type: 'string' },
          'tauri-config': { type: 'string' },
          tag: { type: 'string' },
          repo: { type: 'string' },
          notes: { type: 'string' },
          'download-urls': { type: 'boolean', default: false },
          write: { type: 'string' },
          help: { type: 'boolean', default: false },
        },
      }).values
    } catch (error) {
      throw new ReleaseError(
        `${error instanceof Error ? error.message : String(error)}\n${USAGE}`,
        2,
      )
    }
    if (options.help) {
      out(USAGE)
      return 0
    }
    if (
      options.version === undefined ||
      options.assets === undefined ||
      options.dir === undefined
    ) {
      throw new ReleaseError(`--version, --assets and --dir are required\n${USAGE}`, 2)
    }
    const version = options.version.replace(/^v/, '')
    if (parseVersion(version) === null) {
      throw new ReleaseError(`--version ${options.version} is not x.y.z`, 2)
    }
    const listed = readJson(options.assets)
    const assets = Array.isArray(listed) ? listed : listed?.assets
    if (!Array.isArray(assets) || assets.some((asset) => typeof asset?.name !== 'string')) {
      throw new ReleaseError(`${options.assets} is not a list of release assets`, 2)
    }
    const signatures = new Map()
    for (const asset of assets) {
      const file = path.join(options.dir, asset.name)
      if (asset.name.endsWith('.sig') && existsSync(file)) {
        signatures.set(asset.name, readFileSync(file, 'utf8'))
      }
    }
    const latestFile = path.join(options.dir, LATEST_JSON)
    const latest = existsSync(latestFile) ? readJson(latestFile) : null
    let pubkey
    if (options['tauri-config'] !== undefined) {
      const key = readJson(options['tauri-config']).plugins?.updater?.pubkey
      if (typeof key === 'string' && key.trim() !== '' && key !== PUBKEY_PLACEHOLDER) pubkey = key
      else out(`Skipping the key check: ${options['tauri-config']} has no updater public key yet.`)
    }
    const repo = options.repo ?? env.GITHUB_REPOSITORY
    if (options['download-urls'] && (repo === undefined || repo === '')) {
      throw new ReleaseError('--download-urls needs --repo owner/name (or GITHUB_REPOSITORY)', 2)
    }
    const built = (options.platforms ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key !== '')
    const result = checkLatestJson({
      latest,
      assets,
      signatures,
      version,
      platforms: built,
      pubkey,
      repo,
      tag: options.tag ?? `v${version}`,
      notes: options.notes,
      downloadUrls: options['download-urls'],
      now,
    })

    const keys = Object.keys(result.platforms).sort()
    if (result.problems.length === 0) {
      out(`OK: ${LATEST_JSON} for ${version} lists ${keys.join(', ')}`)
      return 0
    }
    err(`${LATEST_JSON} does not match the release's signed bundles:`)
    for (const problem of result.problems) err(`  - ${problem}`)
    if (!result.repairable) {
      err('The signatures cannot fix this: rebuild the targets above (re-run their jobs).')
      return 1
    }
    if (options.write === undefined) {
      err('Every problem can be fixed from the signatures: run again with --write <file>.')
      return 1
    }
    mkdirSync(path.dirname(path.resolve(options.write)), { recursive: true })
    writeFileSync(options.write, `${JSON.stringify(result.repaired, null, 2)}\n`)
    out(
      `Repaired: wrote ${options.write} with ${keys.join(', ')}; upload it in place of the old one.`,
    )
    return 0
  } catch (error) {
    if (error instanceof ReleaseError) {
      err(error.message)
      return error.code
    }
    err(error instanceof Error ? (error.stack ?? error.message) : String(error))
    return 1
  }
}

/** Whether paths `a` and `b` name the same file (case-insensitively on Windows). */
function sameFile(a, b) {
  const [x, y] = [path.resolve(a), path.resolve(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

if (process.argv[1] !== undefined && sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2))
}
