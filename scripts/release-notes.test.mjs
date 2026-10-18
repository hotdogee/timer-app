import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { main, plainVersion, releaseNotes } from './release-notes.mjs'
import { ReleaseError, addChangelogSection, changelogSection } from './release.mjs'

const CHANGELOG = `# Changelog

## Unreleased

## v0.2.0 - 2026-11-02

Faster sync.

### Commits

- Speed up sync (abc1234)
- Fix a typo (def5678)

## v0.1.0 - 2026-10-20

- First release (0123abc)
`

describe('releaseNotes', () => {
  it('returns the lines between the heading and the next ## heading', () => {
    expect(releaseNotes(CHANGELOG, '0.2.0')).toEqual({
      date: '2026-11-02',
      body: 'Faster sync.\n\n### Commits\n\n- Speed up sync (abc1234)\n- Fix a typo (def5678)',
    })
  })

  it('runs to the end of the file for the last section', () => {
    expect(releaseNotes(CHANGELOG, '0.1.0').body).toBe('- First release (0123abc)')
  })

  it('matches the whole version, not a prefix of another', () => {
    const text =
      '## v0.1.10 - 2026-12-01\n\n- Later (1111111)\n\n## v0.1.1 - 2026-11-01\n\n- Fix (2222222)\n'
    expect(releaseNotes(text, '0.1.1').body).toBe('- Fix (2222222)')
    expect(() => releaseNotes(text, '0.1.0')).toThrow(/no "## v0\.1\.0 - <date>" section/)
  })

  it('reads Windows line endings', () => {
    expect(releaseNotes(CHANGELOG.replaceAll('\n', '\r\n'), '0.1.0').body).toBe(
      '- First release (0123abc)',
    )
  })

  it('fails on a missing, empty or repeated section, or a heading without a date', () => {
    expect(() => releaseNotes(CHANGELOG, '0.3.0')).toThrow(ReleaseError)
    expect(() =>
      releaseNotes('## v0.3.0 - 2026-12-01\n\n## v0.2.0 - 2026-11-02\n', '0.3.0'),
    ).toThrow(/empty/)
    expect(() =>
      releaseNotes('## v0.3.0 - 2026-12-01\n\n- a\n\n## v0.3.0 - 2026-12-02\n\n- b\n', '0.3.0'),
    ).toThrow(/2 sections/)
    expect(() => releaseNotes('## v0.3.0 - \n\n- a\n', '0.3.0')).toThrow(
      /no "## v0\.3\.0 - <date>"/,
    )
  })

  it('reads the sections pnpm release writes', () => {
    const commits = [
      { hash: 'aaaaaaa', subject: 'Add a thing' },
      { hash: 'bbbbbbb', subject: 'Fix a thing' },
    ]
    const notes = 'One paragraph.\n\nAnother.'
    const text = addChangelogSection(`# Changelog\n\n## Unreleased\n\n${notes}\n`, {
      version: '1.4.0',
      date: '2026-12-24',
      commits,
    })
    const section = changelogSection({ version: '1.4.0', date: '2026-12-24', notes, commits })
    expect(releaseNotes(text, '1.4.0')).toEqual({
      date: '2026-12-24',
      body: section.split('\n').slice(1).join('\n').trim(),
    })
    const first = addChangelogSection(null, { version: '0.1.0', date: '2026-10-20', commits: [] })
    expect(releaseNotes(first, '0.1.0').body).toBe('- No commits since the last release.')
  })
})

describe('plainVersion', () => {
  it('takes x.y.z or vX.Y.Z and nothing else', () => {
    expect(plainVersion('v1.2.3')).toBe('1.2.3')
    expect(plainVersion('1.2.3')).toBe('1.2.3')
    for (const text of ['1.2', 'vv1.2.3', '1.2.3-rc.1', 'latest', '']) {
      expect(() => plainVersion(text), text).toThrow(expect.objectContaining({ code: 2 }))
    }
  })
})

describe('the CLI', () => {
  /** @type {string[]} */
  const roots = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function run(argv, root) {
    const output = { out: '', err: [] }
    const code = main(argv, {
      root,
      out: (text) => (output.out += text),
      err: (line) => output.err.push(line),
    })
    return { code, ...output }
  }

  function repo(changelog = CHANGELOG) {
    const root = mkdtempSync(path.join(tmpdir(), 'release-notes-test-'))
    roots.push(root)
    writeFileSync(path.join(root, 'CHANGELOG.md'), changelog)
    return root
  }

  it("prints the version's notes from the repository's CHANGELOG.md", () => {
    const result = run(['v0.1.0'], repo())
    expect(result).toEqual({ code: 0, out: '- First release (0123abc)\n', err: [] })
  })

  it('reads --changelog and writes --out instead', () => {
    const root = repo('# Changelog\n')
    const changelog = path.join(root, 'other.md')
    const out = path.join(root, 'notes.md')
    writeFileSync(changelog, CHANGELOG)
    expect(run(['0.2.0', '--changelog', changelog, '--out', out], root)).toMatchObject({
      code: 0,
      out: '',
    })
    expect(readFileSync(out, 'utf8')).toBe(`${releaseNotes(CHANGELOG, '0.2.0').body}\n`)
  })

  it('fails with 1 without the section or the file, and 2 on a usage error', () => {
    const root = repo()
    expect(run(['0.9.0'], root)).toMatchObject({ code: 1, out: '' })
    expect(run(['0.1.0', '--changelog', path.join(root, 'missing.md')], root).code).toBe(1)
    expect(run([], root).code).toBe(2)
    expect(run(['0.1.0', '0.2.0'], root).code).toBe(2)
    expect(run(['0.1'], root).code).toBe(2)
    expect(run(['0.1.0', '--bogus'], root).code).toBe(2)
  })
})
