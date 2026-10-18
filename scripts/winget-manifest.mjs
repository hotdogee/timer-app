#!/usr/bin/env node
/**
 * Renders the winget manifests of a release (packaging/README.md).
 *
 *   node scripts/winget-manifest.mjs --release --out <dir> [--validate]
 *   node scripts/winget-manifest.mjs --release --print-urls
 *   node scripts/winget-manifest.mjs --installer <arch>=<file> … --out <dir> [--validate]
 *   node scripts/winget-manifest.mjs --placeholder --out <dir> [--validate]
 *
 * The three templates in `packaging/winget/Hotdogee.TimerApp/` (version, default locale,
 * installer) become `Hotdogee.TimerApp*.yaml` in `--out`, a folder `winget validate` and
 * `wingetcreate submit` take as it is. Publisher, name, descriptions, copyright and homepage come
 * from `src-tauri/tauri.conf.json`, the license and moniker from `package.json`, so they match what
 * the installer writes to Add/Remove Programs. The privacy policy's URL is the production site's
 * `/privacy` page ({@link privacyPolicyUrl}). Where the installers come from:
 *
 * - `--release`: the NSIS installers (`*-setup.exe`) for x64 and arm64 in the GitHub release
 *   `v<version>`, with the SHA-256 GitHub records for each asset (downloaded and hashed when it has
 *   none) and the release's date. `--print-urls` prints their URLs as `<url>|<arch>`, one per line,
 *   for `wingetcreate update --urls`.
 * - `--installer <arch>=<file>` (repeatable): local installers, hashed here, listed at the URLs the
 *   release would give them (the release workflow's asset names). For trying the manifests out;
 *   never submit them.
 * - `--placeholder`: those URLs with placeholder checksums, so the templates can be validated
 *   before any release exists.
 *
 * Placeholder and local files say what they are in their first lines.
 *
 * `--version` (default: the app's version, which `pnpm version:check` keeps in one value),
 * `--release-date YYYY-MM-DD` (default: the release's date, else today in UTC), `--repo
 * owner/name` (default: from `bundle.homepage`). `--validate` runs `winget validate` on the
 * output (Windows). GITHUB_TOKEN or GH_TOKEN, when set, authenticates the GitHub API calls (and
 * makes a draft release visible). Exit codes as `scripts/release.mjs`: 0 done, 1 failed, 2 usage.
 *
 * The other exports are shared with `scripts/update-cask.mjs`: what the app says about itself,
 * the template renderer, and reading a release's assets.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  FILES,
  PUBKEY_PLACEHOLDER,
  ROOT,
  ReleaseError,
  agreedVersion,
  parseVersion,
  productionOrigin,
  readVersions,
} from './release.mjs'
import { assetName } from './check-latest-json.mjs'

/**
 * The package's id in the winget repository. It must never change once the package is there: a
 * new id is a new package, and installed copies would not update.
 */
export const PACKAGE_IDENTIFIER = 'Hotdogee.TimerApp'

/** The manifests' schema version (also written in each template). */
export const MANIFEST_VERSION = '1.12.0'
/** `winget validate`'s exit code for "Manifest validation succeeded with warnings". */
const VALIDATION_WARNINGS = 0x8a150028

/** The winget templates, relative to the repository root. */
export const WINGET_TEMPLATE_DIR = 'packaging/winget/Hotdogee.TimerApp'

/** The Windows architectures a release ships an NSIS installer for, in manifest order. */
export const WINDOWS_ARCHES = Object.freeze(['x64', 'arm64'])

/**
 * The checksum of placeholder output for the `n`th file (from 1): valid in form, plainly matching
 * no file, and different per file (winget warns when two installers share one).
 */
export function placeholderSha256(n) {
  return String(n).padStart(64, '0')
}

/** The words an asset name may use for an architecture (tauri-action writes the first). */
export const ARCH_TOKENS = Object.freeze({
  x64: Object.freeze(['x64', 'x86_64', 'amd64']),
  arm64: Object.freeze(['arm64', 'aarch64']),
})

/** The NSIS installer's suffixes: tauri-action's `[setup]` and `[_setup]`. */
const NSIS_SUFFIXES = ['-setup.exe', '_setup.exe']

// ── The app ──────────────────────────────────────────────────────────────────────────────────

/** `value` when it is a non-empty string; throws naming `what` otherwise. */
function required(value, what) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReleaseError(`${what} is missing`)
  }
  return value.trim()
}

/** `https://github.com/<owner>/<name>` as its parts. Throws for any other URL. */
export function githubRepo(url) {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)\/?$/.exec(String(url))
  if (match === null) {
    throw new ReleaseError(`${url} is not a https://github.com/<owner>/<repo> URL`)
  }
  const [, owner, name] = match
  return Object.freeze({
    owner,
    name,
    slug: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  })
}

/** `owner/name` as a repository, for `--repo`; a usage error for anything else. */
export function repoFromSlug(slug) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(slug))) {
    throw new ReleaseError(`--repo ${slug} is not owner/name`, 2)
  }
  return githubRepo(`https://github.com/${slug}`)
}

/**
 * What the app says about itself, from `package.json` and `src-tauri/tauri.conf.json` under
 * `root`, for version `version` (default: the version the four versioned files agree on).
 */
export function readApp(root, version) {
  const pkg = JSON.parse(readFileSync(path.join(root, FILES.packageJson), 'utf8'))
  const tauri = JSON.parse(readFileSync(path.join(root, FILES.tauriConfig), 'utf8'))
  const bundle = tauri.bundle ?? {}
  const appVersion = version ?? agreedVersion(readVersions(root))
  if (parseVersion(appVersion) === null) throw new ReleaseError(`${appVersion} is not x.y.z`, 2)
  const homepage = required(bundle.homepage, `${FILES.tauriConfig} bundle.homepage`)
  const pubkey = String(tauri.plugins?.updater?.pubkey ?? '').trim()
  return Object.freeze({
    name: required(pkg.name, `${FILES.packageJson} name`),
    license: required(pkg.license, `${FILES.packageJson} license`),
    productName: required(tauri.productName, `${FILES.tauriConfig} productName`),
    identifier: required(tauri.identifier, `${FILES.tauriConfig} identifier`),
    version: appVersion,
    publisher: required(bundle.publisher, `${FILES.tauriConfig} bundle.publisher`),
    copyright: required(bundle.copyright, `${FILES.tauriConfig} bundle.copyright`),
    shortDescription: required(
      bundle.shortDescription,
      `${FILES.tauriConfig} bundle.shortDescription`,
    ),
    longDescription: required(
      bundle.longDescription,
      `${FILES.tauriConfig} bundle.longDescription`,
    ),
    homepage: homepage.replace(/\/$/, ''),
    repo: githubRepo(homepage),
    minimumSystemVersion: bundle.macOS?.minimumSystemVersion ?? null,
    updaterConfigured: pubkey !== '' && pubkey !== PUBKEY_PLACEHOLDER,
  })
}

/**
 * The privacy policy's public page, `/privacy` on the production site (the sync server's origin
 * the desktop app allows, {@link productionOrigin}, which serves the web app too), from the files
 * under `root`. Throws a {@link ReleaseError} when the configuration names no such origin.
 */
export function privacyPolicyUrl(root) {
  const tauri = JSON.parse(readFileSync(path.join(root, FILES.tauriConfig), 'utf8'))
  const capability = JSON.parse(readFileSync(path.join(root, FILES.capability), 'utf8'))
  return `${productionOrigin(tauri, capability)}/privacy`
}

// ── Templates ───────────────────────────────────────────────────────────────────────────────

/**
 * `template` with each `{{key}}` replaced by `values[key]` (a string). A value of several lines
 * continues at the indentation of its placeholder's line, a line that holds nothing but a
 * placeholder whose value is empty is left out, and lines of only spaces come out empty. Throws
 * for a placeholder without a value and for anything left looking like one.
 */
export function renderTemplate(template, values) {
  const out = []
  for (const line of template.split('\n')) {
    const indent = /^[ \t]*/.exec(line)[0]
    const rendered = line.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!Object.hasOwn(values, key)) {
        throw new ReleaseError(`the template uses {{${key}}}, which has no value`)
      }
      return String(values[key])
    })
    if (rendered.trim() === '' && /^[ \t]*\{\{\w+\}\}[ \t]*$/.test(line)) continue
    const [first, ...rest] = rendered.split('\n')
    for (const next of [first, ...rest.map((more) => `${indent}${more}`)]) {
      out.push(next.trim() === '' ? '' : next)
    }
  }
  const text = out.join('\n')
  const leftover = /\{\{[^}]*\}\}/.exec(text)
  if (leftover !== null) throw new ReleaseError(`the template has a malformed ${leftover[0]}`)
  return text
}

/** Whether `text` can be a plain (unquoted) YAML scalar that reads back as the same string. */
function isPlainYaml(text) {
  if (text === '' || text !== text.trim()) return false
  // An indicator character at the start, a mapping or comment marker inside, a trailing colon.
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) || /: | #|:$/.test(text)) return false
  // Words YAML (1.1 or 1.2) reads as booleans or null, and anything that reads as a number.
  if (/^(?:~|null|true|false|yes|no|on|off|y|n)$/i.test(text)) return false
  if (/^[-+]?(?:\d[\d_]*)?(?:\.\d*)?(?:e[-+]?\d+)?$/i.test(text)) return false
  if (/^[-+]?(?:0x[\da-f_]+|0o?[0-7_]+|0b[01_]+|\.inf|\.nan)$/i.test(text)) return false
  if (/^[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.\d*)?$/.test(text)) return false
  return true
}

/**
 * `value` as a YAML scalar for a top-level key: plain when that reads back unchanged, single-quoted
 * otherwise, and a literal block (`|-`) when it has several lines. Throws for control characters.
 */
export function yamlScalar(value) {
  const text = String(value)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw new ReleaseError(`control character in ${text}`)
  if (text.includes('\n')) {
    return ['|-', ...text.split('\n').map((line) => (line === '' ? '' : `  ${line}`))].join('\n')
  }
  return isPlainYaml(text) ? text : `'${text.replaceAll("'", "''")}'`
}

// ── Release assets ──────────────────────────────────────────────────────────────────────────

/** The download URL of asset `name` in release `tag` of `repo`. */
export function downloadUrl(repo, tag, name) {
  return `${repo.url}/releases/download/${tag}/${name}`
}

/**
 * The name the release workflow uploads a bundle as (release.yml's `releaseAssetNamePattern`,
 * which `scripts/check-latest-json.mjs` holds too): `kind` `nsis` (`arch` x64, arm64) or `dmg`
 * (aarch64, x64). For placeholder and local output; `--release` reads the actual names.
 */
export function defaultAssetName(app, kind, arch) {
  if (kind !== 'nsis' && kind !== 'dmg') throw new ReleaseError(`unknown bundle kind ${kind}`)
  const platform = kind === 'nsis' ? 'windows' : 'darwin'
  return assetName({ version: app.version, platform, arch, bundle: kind })
}

/**
 * The one asset among `assets` (GitHub release assets, `{ name, … }`) whose name ends with one of
 * `suffixes` and names the architecture by one of `tokens` (a word between `.`, `_` or `-`, or
 * the name's ends), with the token it used and where. Throws, listing the assets, for none or
 * several.
 */
export function pickAsset(assets, { suffixes, tokens, what }) {
  const token = new RegExp(`(^|[._-])(${tokens.join('|')})(?=[._-]|$)`, 'i')
  const found = []
  for (const asset of assets) {
    const suffix = suffixes.find((end) => asset.name.toLowerCase().endsWith(end))
    if (suffix === undefined) continue
    const match = token.exec(asset.name.slice(0, -suffix.length))
    if (match !== null) {
      found.push({ asset, token: match[2], index: match.index + match[1].length })
    }
  }
  if (found.length === 1) return found[0]
  const names = assets.map((asset) => `  ${asset.name}`).join('\n') || '  (none)'
  throw new ReleaseError(
    found.length === 0
      ? `the release has no ${what}; its assets:\n${names}`
      : `the release has ${found.length} candidates for the ${what}: ${found.map((f) => f.asset.name).join(', ')}`,
  )
}

/** The NSIS installer for Windows architecture `arch` among a release's `assets`. */
export function pickInstaller(assets, arch) {
  return pickAsset(assets, {
    suffixes: NSIS_SUFFIXES,
    tokens: ARCH_TOKENS[arch],
    what: `${arch} NSIS installer (*-setup.exe)`,
  })
}

/** The GitHub API's request headers, with `token` when there is one. */
function apiHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    'User-Agent': 'timer-app-release-scripts',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/** The token for GitHub API reads: GITHUB_TOKEN or GH_TOKEN from `env`, or undefined. */
export function githubToken(env) {
  return env.GITHUB_TOKEN || env.GH_TOKEN || undefined
}

/**
 * Release `tag` of `repo` from the GitHub API (`{ tag_name, draft, published_at, assets }`). A draft
 * release has no tag yet, so when the tag is not found the newest releases are searched as well,
 * which shows drafts to a token that may push to the repository.
 */
export async function fetchRelease({ repo, tag, fetch, token, apiUrl = 'https://api.github.com' }) {
  const base = `${apiUrl}/repos/${repo.slug}/releases`
  const byTag = await fetch(`${base}/tags/${encodeURIComponent(tag)}`, {
    headers: apiHeaders(token),
  })
  if (byTag.ok) return await byTag.json()
  if (byTag.status !== 404) {
    throw new ReleaseError(`GitHub answered ${byTag.status} for release ${tag} of ${repo.slug}`)
  }
  const list = await fetch(`${base}?per_page=100`, { headers: apiHeaders(token) })
  if (!list.ok) {
    throw new ReleaseError(`GitHub answered ${list.status} listing ${repo.slug}'s releases`)
  }
  const release = (await list.json()).find((candidate) => candidate.tag_name === tag)
  if (release === undefined) {
    const hint = token ? '' : ' (a draft is visible only with GITHUB_TOKEN or GH_TOKEN set)'
    throw new ReleaseError(`${repo.slug} has no release ${tag}${hint}`)
  }
  return release
}

/** The SHA-256 of `bytes` as lowercase hex. */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The SHA-256 (lowercase hex) of release asset `asset`: the digest GitHub records for it, or else
 * its content, downloaded (through the API with `token`, which also reaches a draft's assets).
 */
export async function assetSha256(asset, { fetch, token }) {
  const recorded = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest ?? ''))
  if (recorded !== null) return recorded[1].toLowerCase()
  const response = token
    ? await fetch(asset.url, { headers: apiHeaders(token, 'application/octet-stream') })
    : await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': 'timer-app-release-scripts' },
      })
  if (!response.ok) throw new ReleaseError(`downloading ${asset.name} failed: ${response.status}`)
  return sha256(Buffer.from(await response.arrayBuffer()))
}

/** The `<arch>=<value>` pairs of a repeatable option, as a Map; throws for a bad or repeated arch. */
export function archPairs(values, arches, option) {
  const pairs = new Map()
  for (const value of values ?? []) {
    const match = /^([^=]+)=(.+)$/.exec(value)
    if (match === null || !arches.includes(match[1])) {
      throw new ReleaseError(
        `${option} ${value}: use <arch>=<file> with arch ${arches.join(' or ')}`,
        2,
      )
    }
    if (pairs.has(match[1])) throw new ReleaseError(`${option} names ${match[1]} twice`, 2)
    pairs.set(match[1], match[2])
  }
  return pairs
}

// ── The manifests ───────────────────────────────────────────────────────────────────────────

/**
 * The values the winget templates use, for `app` and `installers` (`{ arch, url, sha256 }`, in
 * manifest order) released on `releaseDate` (`YYYY-MM-DD`), with the privacy policy at
 * `privacyUrl` ({@link privacyPolicyUrl}). `notice` is the comment the files start with.
 */
export function wingetValues(app, { installers, releaseDate, notice, privacyUrl }) {
  if (installers.length === 0) throw new ReleaseError('no installer to list')
  if (!/^https:\/\/\S+$/.test(String(privacyUrl))) {
    throw new ReleaseError(`bad privacy policy URL ${String(privacyUrl)}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    throw new ReleaseError(`bad release date ${releaseDate}`)
  }
  for (const installer of installers) {
    if (!WINDOWS_ARCHES.includes(installer.arch)) {
      throw new ReleaseError(`bad arch ${installer.arch}`)
    }
    if (!/^https:\/\/\S+$/.test(installer.url)) throw new ReleaseError(`bad URL ${installer.url}`)
    if (!/^[0-9a-f]{64}$/i.test(installer.sha256)) {
      throw new ReleaseError(`bad SHA-256 ${installer.sha256}`)
    }
  }
  const home = app.repo.url
  return {
    notice,
    package_identifier: yamlScalar(PACKAGE_IDENTIFIER),
    version: yamlScalar(app.version),
    publisher: yamlScalar(app.publisher),
    publisher_url: yamlScalar(`https://github.com/${app.repo.owner}`),
    support_url: yamlScalar(`${home}/issues`),
    privacy_url: yamlScalar(privacyUrl),
    package_name: yamlScalar(app.productName),
    package_url: yamlScalar(app.homepage),
    license: yamlScalar(app.license),
    license_url: yamlScalar(`${home}/blob/main/LICENSE`),
    copyright: yamlScalar(app.copyright),
    short_description: yamlScalar(app.shortDescription),
    description: yamlScalar(app.longDescription),
    moniker: yamlScalar(app.name),
    release_notes_url: yamlScalar(`${home}/releases/tag/v${app.version}`),
    // Tauri's NSIS installer names its Add/Remove Programs key after the product and installs a
    // current-user copy (bundle.windows.nsis.installMode) into %LOCALAPPDATA%\<product>.
    product_code: yamlScalar(app.productName),
    install_location: yamlScalar(`%LocalAppData%\\${app.productName}`),
    release_date: releaseDate,
    installers: installers
      .map((installer) =>
        [
          `- Architecture: ${installer.arch}`,
          `  InstallerUrl: ${yamlScalar(installer.url)}`,
          `  InstallerSha256: ${installer.sha256.toUpperCase()}`,
        ].join('\n'),
      )
      .join('\n'),
  }
}

/**
 * The manifests rendered from the templates in `templateDir` with `values`: a Map from the file
 * name (the template's, without `.tmpl`) to its text.
 */
export function renderManifests(templateDir, values) {
  const templates = readdirSync(templateDir)
    .filter((file) => file.endsWith('.yaml.tmpl'))
    .sort()
  if (templates.length !== 3) {
    throw new ReleaseError(
      `${templateDir} should hold 3 *.yaml.tmpl files, not ${templates.length}`,
    )
  }
  return new Map(
    templates.map((file) => [
      file.slice(0, -'.tmpl'.length),
      renderTemplate(readFileSync(path.join(templateDir, file), 'utf8'), values),
    ]),
  )
}

// ── Command line ────────────────────────────────────────────────────────────────────────────

const USAGE = `Usage:
  node scripts/winget-manifest.mjs --release --out <dir> [--validate]
  node scripts/winget-manifest.mjs --release --print-urls
  node scripts/winget-manifest.mjs --installer <arch>=<file> … --out <dir> [--validate]
  node scripts/winget-manifest.mjs --placeholder --out <dir> [--validate]
Options: --version x.y.z, --release-date YYYY-MM-DD, --repo owner/name`

/** The comment every rendered file starts with. */
function noticeFor(source, app) {
  const made = '# Rendered by scripts/winget-manifest.mjs (https://github.com/hotdogee/timer-app).'
  if (source === 'release') return made
  if (source === 'placeholder') {
    return `${made}\n# PLACEHOLDER: no release v${app.version} exists; the checksums are not real. Never submit.`
  }
  return `${made}\n# LOCAL: checksums of local builds, not of the release. Never submit.`
}

/**
 * The installers for each source: `{ arch, url, sha256 }` (no checksum with `urlsOnly`) and the
 * release date when known.
 */
async function collectInstallers(source, app, options, context, urlsOnly = false) {
  const tag = `v${app.version}`
  if (source === 'placeholder') {
    return {
      installers: WINDOWS_ARCHES.map((arch, index) => ({
        arch,
        url: downloadUrl(app.repo, tag, defaultAssetName(app, 'nsis', arch)),
        sha256: placeholderSha256(index + 1),
      })),
      date: null,
    }
  }
  if (source === 'local') {
    const files = archPairs(options.installer, WINDOWS_ARCHES, '--installer')
    return {
      installers: WINDOWS_ARCHES.filter((arch) => files.has(arch)).map((arch) => {
        const file = path.resolve(context.cwd, files.get(arch))
        return {
          arch,
          url: downloadUrl(app.repo, tag, defaultAssetName(app, 'nsis', arch)),
          sha256: sha256(readFileSync(file)),
        }
      }),
      date: null,
    }
  }
  const token = githubToken(context.env)
  const release = await fetchRelease({
    repo: app.repo,
    tag,
    fetch: context.fetch,
    token,
    apiUrl: context.apiUrl,
  })
  const installers = []
  for (const arch of WINDOWS_ARCHES) {
    const { asset } = pickInstaller(release.assets ?? [], arch)
    installers.push({
      arch,
      url: asset.browser_download_url ?? downloadUrl(app.repo, tag, asset.name),
      sha256: urlsOnly ? null : await assetSha256(asset, { fetch: context.fetch, token }),
    })
  }
  return {
    installers,
    date: release.published_at ? String(release.published_at).slice(0, 10) : null,
  }
}

/**
 * Runs the script with arguments `argv`; resolves to its exit code. `context` replaces the
 * repository root, the working directory, the environment, `fetch`, the GitHub API URL, today's
 * date, the output and `winget` (`(args) => output`, throwing on failure), for tests.
 */
export async function main(argv, context = {}) {
  const root = context.root ?? ROOT
  const env = context.env ?? process.env
  const ctx = {
    cwd: context.cwd ?? process.cwd(),
    env,
    fetch: context.fetch ?? globalThis.fetch,
    apiUrl: context.apiUrl ?? env.GITHUB_API_URL ?? 'https://api.github.com',
  }
  const today = context.today ?? new Date().toISOString().slice(0, 10)
  const out = context.out ?? ((line) => console.log(line))
  const err = context.err ?? ((line) => console.error(line))
  const winget =
    context.winget ??
    ((args) =>
      execFileSync('winget', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  try {
    let parsed
    try {
      parsed = parseArgs({
        args: argv,
        options: {
          release: { type: 'boolean', default: false },
          placeholder: { type: 'boolean', default: false },
          installer: { type: 'string', multiple: true },
          version: { type: 'string' },
          'release-date': { type: 'string' },
          repo: { type: 'string' },
          out: { type: 'string' },
          'print-urls': { type: 'boolean', default: false },
          validate: { type: 'boolean', default: false },
          help: { type: 'boolean', default: false },
        },
      })
    } catch (error) {
      throw new ReleaseError(
        `${error instanceof Error ? error.message : String(error)}\n${USAGE}`,
        2,
      )
    }
    const options = parsed.values
    if (options.help) {
      out(USAGE)
      return 0
    }
    const sources = [
      options.release && 'release',
      options.placeholder && 'placeholder',
      options.installer !== undefined && 'local',
    ].filter(Boolean)
    if (sources.length !== 1) {
      throw new ReleaseError(
        `use exactly one of --release, --installer and --placeholder\n${USAGE}`,
        2,
      )
    }
    const [source] = sources
    if (
      options['print-urls'] &&
      (source !== 'release' || options.out !== undefined || options.validate)
    ) {
      throw new ReleaseError('--print-urls goes with --release alone', 2)
    }
    if (!options['print-urls'] && options.out === undefined) {
      throw new ReleaseError(`--out is missing\n${USAGE}`, 2)
    }
    if (
      options['release-date'] !== undefined &&
      !/^\d{4}-\d{2}-\d{2}$/.test(options['release-date'])
    ) {
      throw new ReleaseError(`--release-date ${options['release-date']} is not YYYY-MM-DD`, 2)
    }
    if (options.version !== undefined && parseVersion(options.version) === null) {
      throw new ReleaseError(`--version ${options.version} is not x.y.z`, 2)
    }

    const base = readApp(root, options.version)
    const app =
      options.repo === undefined
        ? base
        : Object.freeze({ ...base, repo: repoFromSlug(options.repo) })
    const { installers, date } = await collectInstallers(
      source,
      app,
      options,
      ctx,
      options['print-urls'],
    )
    if (options['print-urls']) {
      for (const installer of installers) out(`${installer.url}|${installer.arch}`)
      return 0
    }
    const values = wingetValues(app, {
      installers,
      releaseDate: options['release-date'] ?? date ?? today,
      notice: noticeFor(source, app),
      privacyUrl: privacyPolicyUrl(root),
    })
    const manifests = renderManifests(path.join(root, WINGET_TEMPLATE_DIR), values)
    const dir = path.resolve(ctx.cwd, options.out)
    mkdirSync(dir, { recursive: true })
    for (const [file, text] of manifests) {
      writeFileSync(path.join(dir, file), text)
      out(`wrote ${path.join(dir, file)}`)
    }
    for (const installer of installers) {
      out(`  ${installer.arch}: ${installer.url} (${installer.sha256})`)
    }
    if (options.validate) {
      try {
        out(winget(['validate', '--manifest', dir, '--disable-interactivity']).trim())
      } catch (error) {
        const code = typeof error?.status === 'number' ? error.status >>> 0 : null
        const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
        if (code === VALIDATION_WARNINGS) {
          // "Validation succeeded with warnings": the manifests are valid. The warnings are shown
          // (as GitHub annotations under Actions) for the submitter to judge; the winget repository
          // runs its own checks on the pull request. Some winget builds warn about the schema header
          // comment that others accept, so a warning must not fail a release.
          for (const line of output.split('\n').filter((l) => l.trim() !== '')) {
            err(process.env.GITHUB_ACTIONS ? `::warning::${line}` : line)
          }
          return 0
        }
        const status = code === null ? '' : ` (exit 0x${code.toString(16).toUpperCase()})`
        throw new ReleaseError(`winget validate failed${status}:\n${output || String(error)}`)
      }
    }
    return 0
  } catch (error) {
    if (error instanceof ReleaseError) {
      err(error.message)
      return error.code
    }
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
    err(output || (error instanceof Error ? (error.stack ?? error.message) : String(error)))
    return 1
  }
}

/** Whether paths `a` and `b` name the same file (case-insensitively on Windows). */
function sameFile(a, b) {
  const [x, y] = [path.resolve(a), path.resolve(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

if (process.argv[1] !== undefined && sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2))
}
