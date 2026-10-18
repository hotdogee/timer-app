#!/usr/bin/env node
/**
 * Cuts a release and checks that the app's version is one value (docs/release.md).
 *
 *   pnpm release <patch|minor|major|x.y.z> [--dry-run] [--commit]
 *   pnpm version:check [--tag vX.Y.Z] [--origin https://…] [--updater-key]
 *   node scripts/release.mjs --print-origin
 *
 * `package.json` holds the version; a release writes the next one to `package.json`,
 * `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the crate's entry in
 * `src-tauri/Cargo.lock`, and adds a `## vX.Y.Z - YYYY-MM-DD` section to `CHANGELOG.md` under
 * `## Unreleased`: the notes written under Unreleased (moved, leaving it empty) and the subjects of
 * the commits since the last `v*` tag. Each file is edited in place, so its formatting stays.
 * Versions are plain `x.y.z` and fit an MSI version (major and minor at most 255, patch at most
 * 65535), since Windows builds include an MSI.
 *
 * - `--dry-run` prints the planned edits and changes nothing.
 * - `--commit` also commits the edited files as `Release vX.Y.Z` and creates the annotated tag
 *   `vX.Y.Z`, on a clean working tree only. Nothing is ever pushed: the script prints the push.
 * - `--check` (`pnpm version:check`) fails unless the four versions agree on one a release can
 *   carry ({@link versionProblem}); with `--tag`, unless the tag is `v` plus that version; with `--origin`, unless the content security policy and the
 *   browser opener allow exactly that sync server (see {@link productionOrigin}); with
 *   `--updater-key`, while the updater's public key is still the placeholder.
 * - `--print-origin` prints the production sync server's origin, for `TIMER_SERVER_ORIGIN`.
 *
 * Exit codes: 0 done, 1 a check or a step failed, 2 a usage error.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** The repository root. */
export const ROOT = path.resolve(import.meta.dirname, '..')

/** The files a release edits (the first five) or reads, relative to the root. */
export const FILES = Object.freeze({
  packageJson: 'package.json',
  tauriConfig: 'src-tauri/tauri.conf.json',
  cargoToml: 'src-tauri/Cargo.toml',
  cargoLock: 'src-tauri/Cargo.lock',
  changelog: 'CHANGELOG.md',
  capability: 'src-tauri/capabilities/default.json',
})

/** The files that carry the version, which `--check` compares. */
export const VERSIONED_FILES = Object.freeze([
  FILES.packageJson,
  FILES.tauriConfig,
  FILES.cargoToml,
  FILES.cargoLock,
])

/** The updater's public key in `tauri.conf.json` until the real one is generated. */
export const PUBKEY_PLACEHOLDER = 'UPDATER_PUBKEY_PLACEHOLDER'

/** The largest version an MSI accepts: major.minor.build up to 255, 255 and 65535. */
const MSI_LIMITS = [255, 255, 65535]

const USAGE = `Usage:
  pnpm release <patch|minor|major|x.y.z> [--dry-run] [--commit]
  pnpm version:check [--tag vX.Y.Z] [--origin https://…] [--updater-key]
  node scripts/release.mjs --print-origin`

/** An error that ends the script with its message and exit code 1 (2 for usage errors). */
export class ReleaseError extends Error {
  constructor(message, code = 1) {
    super(message)
    this.name = 'ReleaseError'
    this.code = code
  }
}

// ── Versions ────────────────────────────────────────────────────────────────────────────────

/** `x.y.z` as three numbers, or null when it is not a plain version (no pre-release, no `v`). */
export function parseVersion(text) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(text))
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Negative, zero or positive as version `a` is lower than, equal to or higher than `b`. */
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  if (x === null) throw new ReleaseError(`not a version: ${a}`)
  if (y === null) throw new ReleaseError(`not a version: ${b}`)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/**
 * Why `version` cannot be released, or null when it can. A release version is a plain `x.y.z`
 * (no `v`, pre-release or build part) that fits an MSI version: Windows builds include an MSI,
 * and its bundler refuses anything else, after the whole build. `pnpm release` and
 * `pnpm version:check` both apply this rule.
 */
export function versionProblem(version) {
  const parts = parseVersion(version)
  if (parts === null) {
    return `${version} is not x.y.z (an MSI version has no pre-release or build part)`
  }
  if (parts.some((part, i) => part > MSI_LIMITS[i])) {
    return `${version} does not fit an MSI version (at most ${MSI_LIMITS.join('.')})`
  }
  return null
}

/**
 * The version after `current` for `bump`: `patch`, `minor`, `major` or an explicit `x.y.z`, which
 * must be higher. Throws a {@link ReleaseError} for anything else, and for a version an MSI
 * cannot carry.
 */
export function nextVersion(current, bump) {
  const parts = parseVersion(current)
  if (parts === null) throw new ReleaseError(`the current version ${current} is not x.y.z`)
  const [major, minor, patch] = parts
  let next
  if (bump === 'patch') next = `${major}.${minor}.${patch + 1}`
  else if (bump === 'minor') next = `${major}.${minor + 1}.0`
  else if (bump === 'major') next = `${major + 1}.0.0`
  else if (parseVersion(bump) !== null) next = bump
  else throw new ReleaseError(`unknown bump "${bump}": use patch, minor, major or x.y.z`, 2)
  if (compareVersions(next, current) <= 0) {
    throw new ReleaseError(`${next} is not higher than the current version ${current}`)
  }
  const problem = versionProblem(next)
  if (problem !== null) throw new ReleaseError(problem)
  return next
}

// ── File edits (in place, keeping the formatting) ───────────────────────────────────────────

/**
 * `text` (a JSON object formatted with two-space indents, as Prettier writes it) with its
 * top-level `version` set to `version`. Throws when there is none.
 */
export function setJsonVersion(text, version) {
  const pattern = /^( {2}"version"\s*:\s*)"[^"]*"/m
  if (!pattern.test(text)) throw new ReleaseError('no top-level "version" field')
  const result = text.replace(pattern, `$1${JSON.stringify(version)}`)
  const expected = JSON.stringify({ ...JSON.parse(text), version })
  if (JSON.stringify(JSON.parse(result)) !== expected) {
    throw new ReleaseError('the "version" field is not where it was expected')
  }
  return result
}

/** The `[package]` table's `name` and `version` in a Cargo.toml. */
export function readCargoPackage(text) {
  const found = {}
  let table = ''
  for (const line of text.split('\n')) {
    const header = /^\s*\[([^\]]*)\]/.exec(line)
    if (header) table = header[1].trim()
    else if (table === 'package') {
      const field = /^\s*(name|version)\s*=\s*"([^"]*)"/.exec(line)
      if (field && found[field[1]] === undefined) found[field[1]] = field[2]
    }
  }
  if (found.name === undefined || found.version === undefined) {
    throw new ReleaseError('Cargo.toml has no [package] name and version')
  }
  return { name: found.name, version: found.version }
}

/** `text` (a Cargo.toml) with the `[package]` table's `version` set to `version`. */
export function setCargoTomlVersion(text, version) {
  let table = ''
  let done = false
  const lines = text.split('\n').map((line) => {
    const header = /^\s*\[([^\]]*)\]/.exec(line)
    if (header) table = header[1].trim()
    else if (table === 'package' && !done) {
      const field = /^(\s*version\s*=\s*)"[^"]*"/.exec(line)
      if (field) {
        done = true
        return `${field[1]}"${version}"${line.slice(field[0].length)}`
      }
    }
    return line
  })
  if (!done) throw new ReleaseError('Cargo.toml has no [package] version')
  return lines.join('\n')
}

/** The pattern of crate `name`'s own entry in a Cargo.lock. */
function lockEntry(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    String.raw`(\[\[package\]\]\r?\nname = "${escaped}"\r?\nversion = ")([^"]*)(")`,
    'g',
  )
}

/** Crate `name`'s version in a Cargo.lock. Throws unless it has exactly one entry. */
export function readCargoLockVersion(text, name) {
  const matches = [...text.matchAll(lockEntry(name))]
  if (matches.length !== 1) {
    throw new ReleaseError(`Cargo.lock has ${matches.length} entries for ${name}, not one`)
  }
  return matches[0][2]
}

/** `text` (a Cargo.lock) with crate `name`'s version set to `version`. */
export function setCargoLockVersion(text, name, version) {
  readCargoLockVersion(text, name)
  return text.replace(lockEntry(name), `$1${version}$3`)
}

// ── Changelog ───────────────────────────────────────────────────────────────────────────────

/** The `## Unreleased` heading (also `## [Unreleased]`), on a line of its own. */
const UNRELEASED = /^##[ \t]+\[?Unreleased\]?[ \t]*$/im

/** A changelog section's heading line for version `version` released on `date`. */
export function sectionHeading(version, date) {
  return `## v${version} - ${date}`
}

/**
 * The changelog section of a release: the heading, then `notes` (what was written under
 * Unreleased) when there are any, then the commits since the last release as `- subject (hash)`.
 */
export function changelogSection({ version, date, notes, commits }) {
  const list =
    commits.length > 0
      ? commits.map((commit) => `- ${commit.subject} (${commit.hash})`)
      : ['- No commits since the last release.']
  const body = notes.trim() === '' ? list : [notes.trim(), '', '### Commits', '', ...list]
  return [sectionHeading(version, date), '', ...body, ''].join('\n')
}

/**
 * Splits `text` (CHANGELOG.md) at `## Unreleased`: everything up to and including the heading,
 * the notes under it, and the rest from the next `## ` heading on. Null without that heading.
 */
function splitUnreleased(text) {
  const heading = UNRELEASED.exec(text)
  if (!heading) return null
  const start = heading.index + heading[0].length
  const rest = text.slice(start)
  const next = /^## /m.exec(rest)
  return {
    head: text.slice(0, start),
    notes: next ? rest.slice(0, next.index) : rest,
    after: next ? rest.slice(next.index) : '',
  }
}

/**
 * `text` (CHANGELOG.md, or null when there is none) with the release's section added: right under
 * `## Unreleased`, whose notes move into the section, or else before the first `## ` heading (at
 * the end when there is none). A new file gets a title and an empty Unreleased section.
 */
export function addChangelogSection(text, { version, date, commits }) {
  if (text === null) {
    const section = changelogSection({ version, date, notes: '', commits })
    return `# Changelog\n\n## Unreleased\n\n${section}`
  }
  const parts = splitUnreleased(text)
  if (parts !== null) {
    const section = changelogSection({ version, date, notes: parts.notes, commits })
    return `${parts.head}\n\n${section}${parts.after === '' ? '' : `\n${parts.after}`}`
  }
  const section = changelogSection({ version, date, notes: '', commits })
  const first = /^## /m.exec(text)
  if (first) return `${text.slice(0, first.index)}${section}\n${text.slice(first.index)}`
  return `${text.trimEnd()}\n\n${section}`
}

// ── The repository's release configuration ─────────────────────────────────────────────────

/** A content security policy as a map from directive name to its sources. */
export function parseCsp(csp) {
  const directives = new Map()
  for (const part of String(csp).split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) directives.set(name.toLowerCase(), sources)
  }
  return directives
}

/**
 * The production sync server's origin, as the desktop app's configuration allows it: the one
 * `https://` origin in the content security policy's `connect-src` (with `wss://` on the same
 * host, for the sync socket), whose `/device` page the main window's browser opener may open.
 * Throws a {@link ReleaseError} saying what disagrees.
 */
export function productionOrigin(tauriConfig, capability) {
  const connect = parseCsp(tauriConfig.app?.security?.csp ?? '').get('connect-src') ?? []
  const https = connect.filter((source) => source.startsWith('https://'))
  if (https.length !== 1) {
    throw new ReleaseError(
      `connect-src names ${https.length} https:// origins (${https.join(' ')}); it needs exactly ` +
        'one, the sync server',
    )
  }
  const origin = https[0]
  const url = new URL(origin)
  if (url.origin !== origin) throw new ReleaseError(`connect-src's ${origin} is not an origin`)
  if (!connect.includes(`wss://${url.host}`)) {
    throw new ReleaseError(
      `connect-src allows ${origin} but not its sync socket, wss://${url.host}`,
    )
  }
  const opener = capability.permissions?.find(
    (permission) => permission?.identifier === 'opener:allow-open-url',
  )
  const urls = (opener?.allow ?? []).map((entry) => entry.url)
  if (!urls.includes(`${origin}/device*`)) {
    throw new ReleaseError(`the browser opener may not open ${origin}/device* (the sign-in page)`)
  }
  return origin
}

/** Reads a file under `root`, or null when it does not exist. */
function read(root, file) {
  const full = path.join(root, file)
  return existsSync(full) ? readFileSync(full, 'utf8') : null
}

/** Reads a file under `root` that must exist. */
function readRequired(root, file) {
  const text = read(root, file)
  if (text === null) throw new ReleaseError(`${file} is missing`)
  return text
}

/** The version in each of {@link VERSIONED_FILES} under `root`, by file. */
export function readVersions(root) {
  const cargoToml = readRequired(root, FILES.cargoToml)
  const crate = readCargoPackage(cargoToml)
  return {
    [FILES.packageJson]: JSON.parse(readRequired(root, FILES.packageJson)).version,
    [FILES.tauriConfig]: JSON.parse(readRequired(root, FILES.tauriConfig)).version,
    [FILES.cargoToml]: crate.version,
    [FILES.cargoLock]: readCargoLockVersion(readRequired(root, FILES.cargoLock), crate.name),
  }
}

/** The one version `versions` (by file) agree on. Throws, listing each, when they differ. */
export function agreedVersion(versions) {
  const values = new Set(Object.values(versions))
  if (values.size !== 1) {
    const list = Object.entries(versions).map(([file, version]) => `  ${file}: ${version}`)
    throw new ReleaseError(`the versions differ:\n${list.join('\n')}`)
  }
  return [...values][0]
}

// ── Git ─────────────────────────────────────────────────────────────────────────────────────

/** Runs git in `root` and returns its output; throws when it fails. */
function runGit(root) {
  return (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
}

/** The newest `v*` tag reachable from HEAD, or null when there is none. */
export function lastTag(git) {
  try {
    const tag = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']).trim()
    return tag === '' ? null : tag
  } catch {
    return null
  }
}

/** The commits after tag `since` (null: all of them), newest first, without merges. */
export function commitsSince(git, since) {
  const range = since === null ? 'HEAD' : `${since}..HEAD`
  return git(['log', '--no-merges', '--format=%h%x09%s', range])
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const tab = line.indexOf('\t')
      return { hash: line.slice(0, tab), subject: line.slice(tab + 1).trim() }
    })
}

/** Whether tag `tag` exists. */
function tagExists(git, tag) {
  try {
    git(['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`])
    return true
  } catch {
    return false
  }
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────

/** `--check` with its options; returns what it verified, or throws what failed. */
function check(root, options) {
  const tauriConfig = JSON.parse(readRequired(root, FILES.tauriConfig))
  const version = agreedVersion(readVersions(root))
  const problem = versionProblem(version)
  if (problem !== null) throw new ReleaseError(`the app's version ${problem}`)
  const done = [`version ${version} in ${VERSIONED_FILES.join(', ')}`]
  if (options.tag !== undefined) {
    if (options.tag !== `v${version}`) {
      throw new ReleaseError(`tag ${options.tag} is not v${version}, the app's version`)
    }
    done.push(`tag ${options.tag}`)
  }
  if (options.origin !== undefined) {
    const wanted = URL.canParse(options.origin) ? new URL(options.origin) : null
    if (wanted?.protocol !== 'https:' || options.origin.replace(/\/$/, '') !== wanted.origin) {
      throw new ReleaseError(`--origin ${options.origin} is not an https:// origin`, 2)
    }
    const capability = JSON.parse(readRequired(root, FILES.capability))
    const origin = productionOrigin(tauriConfig, capability)
    if (origin !== wanted.origin) {
      throw new ReleaseError(
        `the app allows the sync server ${origin}, not ${wanted.origin}: change the CSP in ` +
          `${FILES.tauriConfig} and the opener scope in ${FILES.capability} together`,
      )
    }
    done.push(`sync server ${origin}`)
  }
  if (options['updater-key']) {
    const key = String(tauriConfig.plugins?.updater?.pubkey ?? '').trim()
    if (key === '' || key === PUBKEY_PLACEHOLDER) {
      throw new ReleaseError(`${FILES.tauriConfig} has no updater public key yet`)
    }
    done.push('updater public key')
  }
  return done
}

/** The edits a release to `bump` makes: per file its new text and a one-line description. */
function planRelease(root, bump, today, git) {
  const packageJson = readRequired(root, FILES.packageJson)
  const tauriConfig = readRequired(root, FILES.tauriConfig)
  const cargoToml = readRequired(root, FILES.cargoToml)
  const cargoLock = readRequired(root, FILES.cargoLock)
  const current = agreedVersion(readVersions(root))
  const version = nextVersion(current, bump)
  const crate = readCargoPackage(cargoToml).name
  const since = lastTag(git)
  const commits = commitsSince(git, since)
  const changelog = read(root, FILES.changelog)
  const bumped = `version ${current} → ${version}`
  const counted = `${commits.length} commit${commits.length === 1 ? '' : 's'}`
  const edits = [
    { file: FILES.packageJson, text: setJsonVersion(packageJson, version), change: bumped },
    { file: FILES.tauriConfig, text: setJsonVersion(tauriConfig, version), change: bumped },
    { file: FILES.cargoToml, text: setCargoTomlVersion(cargoToml, version), change: bumped },
    {
      file: FILES.cargoLock,
      text: setCargoLockVersion(cargoLock, crate, version),
      change: `${crate} ${current} → ${version}`,
    },
    {
      file: FILES.changelog,
      text: addChangelogSection(changelog, { version, date: today, commits }),
      change:
        `${changelog === null ? 'new file; ' : ''}"${sectionHeading(version, today)}" with ` +
        `${counted} since ${since ?? 'the first commit'}`,
    },
  ]
  const notes = changelog === null ? '' : (splitUnreleased(changelog)?.notes ?? '')
  const section = changelogSection({ version, date: today, notes, commits })
  return { current, version, edits, section }
}

/** An argument as a shell needs it written. */
function quote(arg) {
  return /^[\w./@:=+-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`
}

/**
 * Runs the script with arguments `argv` and returns its exit code. `context` replaces the
 * repository root, git (`(args) => stdout`, throwing on failure), today's date (`YYYY-MM-DD`,
 * UTC by default) and the output, for tests.
 */
export function main(argv, context = {}) {
  const root = context.root ?? ROOT
  const git = context.git ?? runGit(root)
  const today = context.today ?? new Date().toISOString().slice(0, 10)
  const out = context.out ?? ((line) => console.log(line))
  const err = context.err ?? ((line) => console.error(line))
  try {
    let parsed
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          check: { type: 'boolean', default: false },
          'dry-run': { type: 'boolean', default: false },
          commit: { type: 'boolean', default: false },
          tag: { type: 'string' },
          origin: { type: 'string' },
          'updater-key': { type: 'boolean', default: false },
          'print-origin': { type: 'boolean', default: false },
          help: { type: 'boolean', default: false },
        },
      })
    } catch (error) {
      throw new ReleaseError(
        `${error instanceof Error ? error.message : String(error)}\n${USAGE}`,
        2,
      )
    }
    const { values: options, positionals } = parsed
    if (options.help) {
      out(USAGE)
      return 0
    }
    const checkOptions =
      options.tag !== undefined || options.origin !== undefined || options['updater-key']
    if (options['print-origin']) {
      if (positionals.length > 0 || options.check || checkOptions) {
        throw new ReleaseError('--print-origin takes no other arguments', 2)
      }
      const tauriConfig = JSON.parse(readRequired(root, FILES.tauriConfig))
      const capability = JSON.parse(readRequired(root, FILES.capability))
      out(productionOrigin(tauriConfig, capability))
      return 0
    }
    if (options.check || checkOptions) {
      if (!options.check)
        throw new ReleaseError('--tag, --origin and --updater-key need --check', 2)
      if (positionals.length > 0 || options['dry-run'] || options.commit) {
        throw new ReleaseError('--check takes no version, --dry-run or --commit', 2)
      }
      out(`OK: ${check(root, options).join('; ')}`)
      return 0
    }
    if (positionals.length !== 1) throw new ReleaseError(USAGE, 2)

    const dryRun = options['dry-run']
    const plan = planRelease(root, positionals[0], today, git)
    const tag = `v${plan.version}`
    const productName = JSON.parse(readRequired(root, FILES.tauriConfig)).productName ?? 'Release'
    const files = plan.edits.map((edit) => edit.file)
    const gitSteps = [
      ['add', '--', ...files],
      ['commit', '--message', `Release ${tag}`],
      ['tag', '--annotate', tag, '--message', `${productName} ${tag}`],
    ]
    if (options.commit) {
      const dirty = git(['status', '--porcelain']).trim()
      if (dirty !== '') {
        throw new ReleaseError(`--commit needs a clean working tree; git status shows:\n${dirty}`)
      }
      if (tagExists(git, tag)) throw new ReleaseError(`tag ${tag} exists already`)
    }

    const width = Math.max(...files.map((file) => file.length))
    out(`Release ${tag} (from ${plan.current})${dryRun ? ', dry run: no file is changed' : ''}`)
    for (const edit of plan.edits) out(`  ${edit.file.padEnd(width)}  ${edit.change}`)
    if (dryRun) {
      out('')
      out(`The ${FILES.changelog} section:`)
      out('')
      for (const line of plan.section.trimEnd().split('\n')) out(line === '' ? '' : `  ${line}`)
      out('')
      out(options.commit ? 'Then:' : 'With --commit, then:')
      for (const step of gitSteps) out(`  git ${step.map(quote).join(' ')}`)
      return 0
    }

    for (const edit of plan.edits) writeFileSync(path.join(root, edit.file), edit.text)
    if (!options.commit) {
      out('')
      out(`Review the edits, then commit them as "Release ${tag}" and tag ${tag}, or run this`)
      out('again on a clean tree with --commit.')
      return 0
    }
    for (const step of gitSteps) git(step)
    out('')
    out(`Committed "Release ${tag}" and tagged ${tag}. Nothing was pushed; to release (both refs`)
    out('land, or neither does):')
    out(`  git push --atomic origin HEAD ${tag}`)
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
