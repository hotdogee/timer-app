#!/usr/bin/env node
/**
 * Prints a release's notes: its section of `CHANGELOG.md`, for the GitHub Release body
 * (`.github/workflows/release.yml` › create-release).
 *
 *   node scripts/release-notes.mjs <x.y.z | vX.Y.Z> [--changelog CHANGELOG.md] [--out notes.md]
 *
 * `pnpm release` writes each section as `## vX.Y.Z - YYYY-MM-DD` (see `sectionHeading` in
 * `scripts/release.mjs`); the section runs from that line up to the next line that starts with
 * `## `, and the notes are what lies between, without the heading (the release's title names the
 * version). A missing or empty section fails, so a tag without notes is caught before anything
 * is built.
 *
 * Exit codes: 0 done, 1 no such section, 2 a usage error.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { FILES, ROOT, ReleaseError, parseVersion, sectionHeading } from './release.mjs'

const USAGE =
  'Usage: node scripts/release-notes.mjs <x.y.z | vX.Y.Z> [--changelog CHANGELOG.md] [--out notes.md]'

/** `version` without a leading `v`, or a {@link ReleaseError} (usage) when it is not `x.y.z`. */
export function plainVersion(version) {
  const plain = String(version).replace(/^v/, '')
  if (parseVersion(plain) === null) {
    throw new ReleaseError(`not a release version: ${version} (use x.y.z or vX.Y.Z)`, 2)
  }
  return plain
}

/**
 * The section of `changelog` (CHANGELOG.md's text) for `version` (`x.y.z`): its `date` and its
 * `body`, the trimmed lines between `## vX.Y.Z - <date>` and the next line that starts with `## `.
 * Throws a {@link ReleaseError} when the section is missing, repeated or empty.
 */
export function releaseNotes(changelog, version) {
  const prefix = sectionHeading(version, '')
  const lines = String(changelog).replace(/\r\n?/g, '\n').split('\n')
  const starts = lines.flatMap((line, index) =>
    line.startsWith(prefix) && line.slice(prefix.length).trim() !== '' ? [index] : [],
  )
  if (starts.length === 0) {
    throw new ReleaseError(
      `CHANGELOG.md has no "${prefix}<date>" section; pnpm release writes it, then tag that commit`,
    )
  }
  if (starts.length > 1) {
    throw new ReleaseError(`CHANGELOG.md has ${starts.length} sections for v${version}, not one`)
  }
  const start = starts[0]
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const body = lines
    .slice(start + 1, next === -1 ? lines.length : next)
    .join('\n')
    .trim()
  if (body === '') throw new ReleaseError(`CHANGELOG.md's section for v${version} is empty`)
  return { date: lines[start].slice(prefix.length).trim(), body }
}

/**
 * Runs the script with arguments `argv` and returns its exit code. `context` replaces the
 * repository root (where the default CHANGELOG.md is) and the output, for tests.
 */
export function main(argv, context = {}) {
  const root = context.root ?? ROOT
  const out = context.out ?? ((text) => process.stdout.write(text))
  const err = context.err ?? ((line) => console.error(line))
  try {
    let parsed
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          changelog: { type: 'string' },
          out: { type: 'string' },
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
      out(`${USAGE}\n`)
      return 0
    }
    if (positionals.length !== 1) throw new ReleaseError(USAGE, 2)
    const version = plainVersion(positionals[0])
    // Paths given on the command line are relative to the working directory.
    const file =
      options.changelog === undefined
        ? path.join(root, FILES.changelog)
        : path.resolve(options.changelog)
    let changelog
    try {
      changelog = readFileSync(file, 'utf8')
    } catch {
      throw new ReleaseError(`cannot read ${file}`)
    }
    const notes = `${releaseNotes(changelog, version).body}\n`
    if (options.out === undefined) out(notes)
    else writeFileSync(path.resolve(options.out), notes)
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
