#!/usr/bin/env node
/**
 * Renders the Homebrew cask of a release and pushes it to the tap (packaging/README.md).
 *
 *   node scripts/update-cask.mjs --release [--out <file>] [--push] [--not-notarized]
 *   node scripts/update-cask.mjs --dmg arm=<file> --dmg intel=<file> [--out <file>]
 *   node scripts/update-cask.mjs --placeholder [--out <file>]
 *
 * `packaging/homebrew/timer-app.rb.tmpl` becomes `Casks/<token>.rb` (printed, or written to
 * `--out`). The name, description, homepage, minimum macOS, bundle id (for `zap`) and whether the
 * app updates itself come from `src-tauri/tauri.conf.json`. Where the disk images come from:
 *
 * - `--release`: the two DMGs (Apple Silicon and Intel) in the GitHub release `v<version>`, with
 *   the SHA-256 GitHub records for each (downloaded and hashed when it has none). The cask's
 *   `url` is built from their actual names, with `#{version}` and `#{arch}` in place, and checked
 *   against both download URLs.
 * - `--dmg arm=<file> --dmg intel=<file>`: local disk images, hashed here, under the names the
 *   release workflow gives them. For trying the cask out; never pushed.
 * - `--placeholder`: those names with placeholder checksums, before any release exists.
 *
 * `--push` (with `--release` only) commits the cask to the tap repository through the GitHub API
 * with HOMEBREW_TAP_TOKEN (a token that may write the tap's contents; it is never printed), unless
 * the tap already has exactly that file. The tap is `--tap owner/homebrew-name` (default: the app's
 * GitHub owner's `homebrew-tap`), which must exist. `--not-notarized` adds a caveat telling people
 * how to open an app Apple has not notarized (a release built without the Apple secrets).
 *
 * `--version` (default: the app's version) and `--repo owner/name` (default: from
 * `bundle.homepage`) as in `scripts/winget-manifest.mjs`, whose release helpers this script uses.
 * GITHUB_TOKEN or GH_TOKEN, when set, authenticates the reads. Exit codes: 0 done, 1 failed,
 * 2 usage.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { ROOT, ReleaseError, parseVersion } from './release.mjs'
import {
  archPairs,
  assetSha256,
  defaultAssetName,
  downloadUrl,
  fetchRelease,
  githubToken,
  pickAsset,
  placeholderSha256,
  readApp,
  renderTemplate,
  repoFromSlug,
  sha256,
} from './winget-manifest.mjs'

/** The cask template, relative to the repository root. */
export const CASK_TEMPLATE = 'packaging/homebrew/timer-app.rb.tmpl'

/** The cask's architectures and the words a DMG's name may use for each (tauri-action: first). */
export const MAC_ARCHES = Object.freeze({
  arm: Object.freeze(['aarch64', 'arm64']),
  intel: Object.freeze(['x64', 'x86_64', 'intel']),
})

/** Homebrew's names for macOS releases from 12 on; 11 (Big Sur) is the oldest Homebrew runs on. */
const MACOS_NAMES = Object.freeze({
  12: 'monterey',
  13: 'ventura',
  14: 'sonoma',
  15: 'sequoia',
  26: 'tahoe',
  27: 'golden_gate',
})

/** The oldest macOS Homebrew allows; a lower or equal minimum is not declared (Cask Cookbook). */
const HOMEBREW_MACOS_FLOOR = 11

// ── Ruby ────────────────────────────────────────────────────────────────────────────────────

/** `text` escaped for the inside of a Ruby double-quoted string (no interpolation). */
function rubyEscape(text) {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(text)) throw new ReleaseError(`control character in ${text}`)
  return text.replace(/[\\"]/g, '\\$&').replace(/#(?=[{$@])/g, '\\#')
}

/** `text` as a Ruby double-quoted string literal. */
export function rubyString(text) {
  return `"${rubyEscape(String(text))}"`
}

/** Homebrew's cask token for an app name: lowercase words joined by `-` (Cask Cookbook). */
export function caskToken(productName) {
  const token = productName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (token === '') throw new ReleaseError(`no cask token in ${productName}`)
  return token
}

/**
 * `shortDescription` the way Homebrew's `desc` style wants it: no leading article, a capital
 * letter, no full stop, at most 80 characters, without the platform or the app's own name.
 */
export function caskDescription(shortDescription, productName) {
  let desc = shortDescription
    .trim()
    .replace(/^(?:the|an?)\s+/i, '')
    .replace(/\.$/, '')
  desc = desc.charAt(0).toUpperCase() + desc.slice(1)
  const problems = []
  if (desc === '') problems.push('it is empty')
  if (desc.length > 80) problems.push(`it has ${desc.length} characters (at most 80)`)
  if (/\b(?:macOS|Mac(?: ?OS(?: ?X)?)?|OS ?X)\b/i.test(desc)) problems.push('it names the platform')
  const name = productName.replace(/[\s-]+/g, '[\\s-]?')
  if (new RegExp(`^${name}\\b`, 'i').test(desc)) problems.push('it starts with the app name')
  if (/command ?line/i.test(desc)) problems.push('Homebrew spells it command-line')
  if (problems.length > 0) {
    throw new ReleaseError(
      `bundle.shortDescription does not make a cask desc: ${problems.join('; ')}`,
    )
  }
  return desc
}

/** The `depends_on` stanza for `minimumSystemVersion` (`11.0`, `12`, …; null: no minimum). */
export function dependsOnMacos(minimumSystemVersion) {
  if (minimumSystemVersion === null || minimumSystemVersion === undefined) {
    return 'depends_on :macos'
  }
  const major = Number(/^(\d+)(?:\.\d+){0,2}$/.exec(String(minimumSystemVersion))?.[1] ?? NaN)
  if (Number.isNaN(major)) {
    throw new ReleaseError(`bad minimumSystemVersion ${minimumSystemVersion}`)
  }
  if (major <= HOMEBREW_MACOS_FLOOR) return 'depends_on :macos'
  const name = MACOS_NAMES[major]
  if (name === undefined) throw new ReleaseError(`no Homebrew name for macOS ${major}: add it here`)
  return `depends_on macos: :${name}`
}

/**
 * What `brew uninstall --zap` trashes: the app's data under `~/Library` (named after the bundle
 * id; WebKit keeps the cards there) and the launch-at-login agent, sorted as Homebrew's style
 * wants (case-insensitively, as written).
 */
export function zapPaths(app) {
  const id = app.identifier
  return [
    `~/Library/Application Support/${id}`,
    `~/Library/Caches/${id}`,
    `~/Library/HTTPStorages/${id}`,
    `~/Library/HTTPStorages/${id}.binarycookies`,
    `~/Library/LaunchAgents/${app.productName}.plist`,
    `~/Library/Preferences/${id}.plist`,
    `~/Library/Saved Application State/${id}.savedState`,
    `~/Library/WebKit/${id}`,
  ].sort((a, b) => {
    // Cask/ArrayAlphabetization compares the lines as written, downcased: `"path",`.
    const [x, y] = [`${rubyString(a)},`.toLowerCase(), `${rubyString(b)},`.toLowerCase()]
    return x < y ? -1 : x > y ? 1 : 0
  })
}

/**
 * The cask's `url` as Ruby, from the two DMG names (`arm` and `intel`: `{ name, token, index }`,
 * the arch word and where it is) of release `tag`: the arch word becomes `#{arch}` and the
 * version `#{version}`. Throws unless the names differ only in the arch word.
 */
export function caskUrl(app, tag, dmgs) {
  if (tag !== `v${app.version}`) throw new ReleaseError(`tag ${tag} is not v${app.version}`)
  const { arm, intel } = dmgs
  const swapped = `${arm.name.slice(0, arm.index)}${intel.token}${arm.name.slice(arm.index + arm.token.length)}`
  if (swapped !== intel.name) {
    throw new ReleaseError(
      `the DMGs ${arm.name} and ${intel.name} differ in more than the architecture, so one url ` +
        'cannot name both',
    )
  }
  const parts = [arm.name.slice(0, arm.index), arm.name.slice(arm.index + arm.token.length)]
  const interpolate = (text) => text.split(app.version).map(rubyEscape).join('#{version}')
  const base = `${app.repo.url}/releases/download/`
  return `"${rubyEscape(base)}v#{version}/${interpolate(parts[0])}#{arch}${interpolate(parts[1])}"`
}

/** `url` (Ruby, as {@link caskUrl} writes it) with `version` and `arch` filled in. */
export function expandCaskUrl(url, { version, arch }) {
  return url
    .slice(1, -1)
    .replaceAll('#{version}', version)
    .replaceAll('#{arch}', arch)
    .replace(/\\(.)/g, '$1')
}

/** The caveat for an app Apple has not notarized, as a Ruby heredoc stanza. */
function notarizationCaveat(productName) {
  return [
    '',
    'caveats <<~EOS',
    `  ${rubyEscape(productName)} is not notarized by Apple. If macOS will not open it, choose Open Anyway`,
    '  in System Settings > Privacy & Security.',
    'EOS',
  ].join('\n')
}

/**
 * The values the cask template uses, for `app`, release `tag`, the `dmgs` (`arm` and `intel`:
 * `{ name, token, index, sha256 }`), the first comment line(s) `notice` and whether to add the
 * notarization caveat.
 */
export function caskValues(app, { tag, dmgs, notice, notNotarized = false }) {
  for (const arch of Object.keys(MAC_ARCHES)) {
    if (!/^[0-9a-f]{64}$/.test(dmgs[arch]?.sha256 ?? '')) {
      throw new ReleaseError(`bad SHA-256 for the ${arch} DMG: ${dmgs[arch]?.sha256}`)
    }
  }
  return {
    notice,
    token: rubyString(caskToken(app.productName)),
    arch_arm: rubyString(dmgs.arm.token),
    arch_intel: rubyString(dmgs.intel.token),
    version: rubyString(app.version),
    sha256_arm: rubyString(dmgs.arm.sha256),
    sha256_intel: rubyString(dmgs.intel.sha256),
    url: caskUrl(app, tag, dmgs),
    name: rubyString(app.productName),
    desc: rubyString(caskDescription(app.shortDescription, app.productName)),
    homepage: rubyString(app.homepage),
    // Only an app with the updater's key replaces itself; until then `brew upgrade` updates it.
    auto_updates: app.updaterConfigured ? 'auto_updates true' : '',
    depends_on: dependsOnMacos(app.minimumSystemVersion),
    app: rubyString(`${app.productName}.app`),
    // One per line, each with a comma: Homebrew's style wants trailing commas in multi-line arrays.
    zap_trash: zapPaths(app)
      .map((file) => `${rubyString(file)},`)
      .join('\n'),
    caveats: notNotarized ? notarizationCaveat(app.productName) : '',
  }
}

/** The cask rendered from the template under `root` with `values`. */
export function renderCask(root, values) {
  const text = renderTemplate(readFileSync(path.join(root, CASK_TEMPLATE), 'utf8'), values)
  return text.endsWith('\n') ? text : `${text}\n`
}

// ── The tap ─────────────────────────────────────────────────────────────────────────────────

/** GitHub API headers for the tap, with `token`. */
function tapHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'timer-app-release-scripts',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/**
 * Commits `text` as `file` (`Casks/<token>.rb`) to `tap` (`owner/name`) with `message`, through
 * the GitHub contents API with `token`. Resolves to what happened: `unchanged`, `created` or
 * `updated`, with the commit's URL.
 */
export async function pushCask({
  tap,
  file,
  text,
  message,
  token,
  fetch,
  apiUrl = 'https://api.github.com',
}) {
  const repoUrl = `${apiUrl}/repos/${tap}`
  const repo = await fetch(repoUrl, { headers: tapHeaders(token) })
  if (repo.status === 404) {
    throw new ReleaseError(
      `the tap ${tap} does not exist, or HOMEBREW_TAP_TOKEN may not see it; create it first ` +
        '(packaging/README.md)',
    )
  }
  if (!repo.ok) throw new ReleaseError(`GitHub answered ${repo.status} for ${tap}`)
  const contentsUrl = `${repoUrl}/contents/${file.split('/').map(encodeURIComponent).join('/')}`
  const current = await fetch(contentsUrl, { headers: tapHeaders(token) })
  let sha
  if (current.ok) {
    const existing = await current.json()
    if (Buffer.from(String(existing.content ?? ''), 'base64').toString('utf8') === text) {
      return { result: 'unchanged', url: existing.html_url ?? null }
    }
    sha = existing.sha
  } else if (current.status !== 404) {
    throw new ReleaseError(`GitHub answered ${current.status} reading ${file} in ${tap}`)
  }
  const put = await fetch(contentsUrl, {
    method: 'PUT',
    headers: { ...tapHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(text, 'utf8').toString('base64'),
      ...(sha === undefined ? {} : { sha }),
    }),
  })
  if (!put.ok) {
    const detail = await put.text().catch(() => '')
    throw new ReleaseError(
      `GitHub answered ${put.status} writing ${file} to ${tap}: ${detail.slice(0, 300)}`,
    )
  }
  const body = await put.json()
  return { result: sha === undefined ? 'created' : 'updated', url: body.commit?.html_url ?? null }
}

// ── Command line ────────────────────────────────────────────────────────────────────────────

const USAGE = `Usage:
  node scripts/update-cask.mjs --release [--out <file>] [--push] [--not-notarized]
  node scripts/update-cask.mjs --dmg arm=<file> --dmg intel=<file> [--out <file>]
  node scripts/update-cask.mjs --placeholder [--out <file>]
Options: --version x.y.z, --repo owner/name, --tap owner/homebrew-name`

/** The comment the cask starts with. */
function noticeFor(source, app) {
  const made = `# Generated by ${app.repo.url}/blob/main/scripts/update-cask.mjs; edit the template there.`
  if (source === 'release') return made
  if (source === 'placeholder') {
    return `${made}\n# PLACEHOLDER: no release v${app.version} exists; the checksums are not real.`
  }
  return `${made}\n# LOCAL: checksums of local builds, not of the release.`
}

/** The two DMGs for each source: `{ arm, intel }` of `{ name, token, index, sha256 }`. */
async function collectDmgs(source, app, options, context) {
  const tag = `v${app.version}`
  const named = (arch, file, sha) => {
    const name = file ?? defaultAssetName(app, 'dmg', MAC_ARCHES[arch][0])
    const { token, index } = pickAsset([{ name }], {
      suffixes: ['.dmg'],
      tokens: MAC_ARCHES[arch],
      what: `${arch} DMG`,
    })
    return { name, token, index, sha256: sha }
  }
  if (source === 'placeholder') {
    return {
      arm: named('arm', undefined, placeholderSha256(1)),
      intel: named('intel', undefined, placeholderSha256(2)),
    }
  }
  if (source === 'local') {
    const files = archPairs(options.dmg, Object.keys(MAC_ARCHES), '--dmg')
    if (files.size !== 2) throw new ReleaseError('--dmg needs both arm=<file> and intel=<file>', 2)
    const dmg = (arch) => {
      const file = path.resolve(context.cwd, files.get(arch))
      return named(arch, undefined, sha256(readFileSync(file)))
    }
    return { arm: dmg('arm'), intel: dmg('intel') }
  }
  const token = githubToken(context.env)
  const release = await fetchRelease({
    repo: app.repo,
    tag,
    fetch: context.fetch,
    token,
    apiUrl: context.apiUrl,
  })
  const dmgs = {}
  for (const arch of Object.keys(MAC_ARCHES)) {
    const picked = pickAsset(release.assets ?? [], {
      suffixes: ['.dmg'],
      tokens: MAC_ARCHES[arch],
      what: `${arch} DMG`,
    })
    dmgs[arch] = {
      name: picked.asset.name,
      token: picked.token,
      index: picked.index,
      sha256: await assetSha256(picked.asset, { fetch: context.fetch, token }),
      url: picked.asset.browser_download_url ?? downloadUrl(app.repo, tag, picked.asset.name),
    }
  }
  return dmgs
}

/**
 * Runs the script with arguments `argv`; resolves to its exit code. `context` replaces the
 * repository root, the working directory, the environment, `fetch`, the GitHub API URL and the
 * output, for tests.
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
  const out =
    context.out ?? ((text) => process.stdout.write(text.endsWith('\n') ? text : `${text}\n`))
  const err = context.err ?? ((line) => console.error(line))
  try {
    let parsed
    try {
      parsed = parseArgs({
        args: argv,
        options: {
          release: { type: 'boolean', default: false },
          placeholder: { type: 'boolean', default: false },
          dmg: { type: 'string', multiple: true },
          version: { type: 'string' },
          repo: { type: 'string' },
          tap: { type: 'string' },
          out: { type: 'string' },
          push: { type: 'boolean', default: false },
          'not-notarized': { type: 'boolean', default: false },
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
      options.dmg !== undefined && 'local',
    ].filter(Boolean)
    if (sources.length !== 1) {
      throw new ReleaseError(`use exactly one of --release, --dmg and --placeholder\n${USAGE}`, 2)
    }
    const [source] = sources
    if (options.push && source !== 'release') {
      throw new ReleaseError(
        '--push goes with --release only: the tap gets released files alone',
        2,
      )
    }
    if (options.version !== undefined && parseVersion(options.version) === null) {
      throw new ReleaseError(`--version ${options.version} is not x.y.z`, 2)
    }
    if (options.tap !== undefined && !/^[\w.-]+\/homebrew-[\w.-]+$/.test(options.tap)) {
      throw new ReleaseError(`--tap ${options.tap} is not owner/homebrew-<name>`, 2)
    }
    const tapToken = env.HOMEBREW_TAP_TOKEN
    if (options.push && !tapToken) throw new ReleaseError('--push needs HOMEBREW_TAP_TOKEN')

    const base = readApp(root, options.version)
    const app =
      options.repo === undefined
        ? base
        : Object.freeze({ ...base, repo: repoFromSlug(options.repo) })
    const tag = `v${app.version}`
    const dmgs = await collectDmgs(source, app, options, ctx)
    const values = caskValues(app, {
      tag,
      dmgs,
      notice: noticeFor(source, app),
      notNotarized: options['not-notarized'],
    })
    for (const arch of Object.keys(MAC_ARCHES)) {
      const expected = dmgs[arch].url ?? downloadUrl(app.repo, tag, dmgs[arch].name)
      const actual = expandCaskUrl(values.url, { version: app.version, arch: dmgs[arch].token })
      if (actual !== expected) {
        throw new ReleaseError(`the cask's ${arch} url ${actual} is not ${expected}`)
      }
    }
    const cask = renderCask(root, values)
    const file = `Casks/${caskToken(app.productName)}.rb`

    if (options.out !== undefined) {
      const target = path.resolve(ctx.cwd, options.out)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, cask)
      err(`wrote ${target}`)
    } else if (!options.push) {
      out(cask)
    }
    if (options.push) {
      const tap = options.tap ?? `${app.repo.owner}/homebrew-tap`
      const { result, url } = await pushCask({
        tap,
        file,
        text: cask,
        message: `${caskToken(app.productName)} ${app.version}`,
        token: tapToken,
        fetch: ctx.fetch,
        apiUrl: ctx.apiUrl,
      })
      err(
        result === 'unchanged'
          ? `${tap} already has this ${file}`
          : `${result} ${file} in ${tap}${url ? `: ${url}` : ''}`,
      )
    }
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
  process.exitCode = await main(process.argv.slice(2))
}
