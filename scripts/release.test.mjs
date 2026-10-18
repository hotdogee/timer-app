import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FILES,
  PUBKEY_PLACEHOLDER,
  ROOT,
  ReleaseError,
  addChangelogSection,
  agreedVersion,
  changelogSection,
  commitsSince,
  compareVersions,
  lastTag,
  main,
  nextVersion,
  parseCsp,
  parseVersion,
  productionOrigin,
  readCargoLockVersion,
  readCargoPackage,
  readVersions,
  setCargoLockVersion,
  setCargoTomlVersion,
  setJsonVersion,
  versionProblem,
} from './release.mjs'

describe('versions', () => {
  it('parses plain x.y.z only', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('0.0.0')).toEqual([0, 0, 0])
    for (const text of ['v1.2.3', '1.2', '1.2.3.4', '01.2.3', '1.2.3-beta.1', '1.2.3+5', '']) {
      expect(parseVersion(text), text).toBeNull()
    }
  })

  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2.3', '1.10.0')).toBeLessThan(0)
    expect(() => compareVersions('1.0', '1.0.0')).toThrow(ReleaseError)
  })

  it('bumps patch, minor and major', () => {
    expect(nextVersion('0.0.0', 'patch')).toBe('0.0.1')
    expect(nextVersion('0.1.9', 'minor')).toBe('0.2.0')
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0')
  })

  it('takes an explicit higher version', () => {
    expect(nextVersion('0.0.0', '0.1.0')).toBe('0.1.0')
    expect(() => nextVersion('0.2.0', '0.1.9')).toThrow(/not higher/)
    expect(() => nextVersion('0.2.0', '0.2.0')).toThrow(/not higher/)
  })

  it('refuses an unknown bump as a usage error', () => {
    for (const bump of ['v1.0.0', 'prerelease', '1.0.0-rc.1', 'PATCH']) {
      expect(() => nextVersion('0.0.0', bump)).toThrow(expect.objectContaining({ code: 2 }))
    }
  })

  it('refuses a version an MSI cannot carry', () => {
    expect(nextVersion('255.255.65534', 'patch')).toBe('255.255.65535')
    expect(() => nextVersion('255.255.65535', 'patch')).toThrow(/MSI/)
    expect(() => nextVersion('0.255.0', 'minor')).toThrow(/MSI/)
    expect(() => nextVersion('255.0.0', 'major')).toThrow(/MSI/)
  })

  it('says why a version cannot be released, by one rule for the bump and the check', () => {
    expect(versionProblem('0.1.0')).toBeNull()
    expect(versionProblem('255.255.65535')).toBeNull()
    for (const version of ['1.0.0-beta.1', 'v1.0.0', '1.0', '1.0.0+5']) {
      expect(versionProblem(version), version).toMatch(/is not x\.y\.z/)
    }
    for (const version of ['256.0.0', '300.0.0', '0.256.0', '0.0.65536']) {
      expect(versionProblem(version), version).toMatch(/does not fit an MSI version/)
    }
  })

  it('reports every file when the versions differ', () => {
    expect(agreedVersion({ a: '1.0.0', b: '1.0.0' })).toBe('1.0.0')
    expect(() => agreedVersion({ a: '1.0.0', b: '1.0.1' })).toThrow(/a: 1\.0\.0\n\s+b: 1\.0\.1/)
  })
})

describe('file edits', () => {
  it('sets the top-level JSON version and nothing else', () => {
    const text =
      '{\n  "name": "x",\n  "version": "0.0.0",\n  "deps": {\n    "version": "9"\n  }\n}\n'
    expect(setJsonVersion(text, '1.2.3')).toBe(text.replace('"0.0.0"', '"1.2.3"'))
  })

  it('refuses JSON without a top-level version', () => {
    expect(() => setJsonVersion('{\n  "name": "x"\n}\n', '1.0.0')).toThrow(ReleaseError)
    const nestedOnly = '{\n  "a": {\n  "version": "1"\n  }\n}\n'
    expect(() => setJsonVersion(nestedOnly, '1.0.0')).toThrow(ReleaseError)
  })

  const cargoToml = [
    '[package]',
    'name = "timer-app"',
    'version = "0.0.0" # the app',
    'edition = "2021"',
    '',
    '[dependencies]',
    'serde = { version = "1.0" }',
    '',
    '[dependencies.foo]',
    'version = "2"',
    '',
  ].join('\n')

  it('reads and sets the [package] version of Cargo.toml only', () => {
    expect(readCargoPackage(cargoToml)).toEqual({ name: 'timer-app', version: '0.0.0' })
    const next = setCargoTomlVersion(cargoToml, '0.1.0')
    expect(next).toBe(
      cargoToml.replace('version = "0.0.0" # the app', 'version = "0.1.0" # the app'),
    )
    expect(next).toContain('version = "2"')
  })

  it('refuses a Cargo.toml without a [package] version', () => {
    expect(() => setCargoTomlVersion('[dependencies]\nversion = "1"\n', '1.0.0')).toThrow(
      ReleaseError,
    )
    expect(() => readCargoPackage('[package]\nname = "x"\n')).toThrow(ReleaseError)
  })

  const cargoLock = [
    'version = 4',
    '',
    '[[package]]',
    'name = "timer"',
    'version = "0.0.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    '',
    '[[package]]',
    'name = "timer-app"',
    'version = "0.0.0"',
    'dependencies = [',
    ' "timer",',
    ']',
    '',
  ].join('\n')

  it("sets the crate's own Cargo.lock entry, not one with a similar name", () => {
    expect(readCargoLockVersion(cargoLock, 'timer-app')).toBe('0.0.0')
    const next = setCargoLockVersion(cargoLock, 'timer-app', '0.2.0')
    expect(readCargoLockVersion(next, 'timer-app')).toBe('0.2.0')
    expect(readCargoLockVersion(next, 'timer')).toBe('0.0.0')
    expect(next.split('\n').length).toBe(cargoLock.split('\n').length)
  })

  it('refuses a Cargo.lock without exactly one entry for the crate', () => {
    expect(() => readCargoLockVersion(cargoLock, 'other')).toThrow(/0 entries/)
    const twice = cargoLock + cargoLock.slice(cargoLock.indexOf('[[package]]\nname = "timer-app"'))
    expect(() => setCargoLockVersion(twice, 'timer-app', '1.0.0')).toThrow(/2 entries/)
  })
})

describe('changelog', () => {
  const commits = [
    { hash: 'abc1234', subject: 'Fix the thing' },
    { hash: 'def5678', subject: 'Add the other thing' },
  ]
  const release = { version: '0.1.0', date: '2026-10-20', commits }

  it('lists the commits under the heading', () => {
    expect(changelogSection({ ...release, notes: '' })).toBe(
      '## v0.1.0 - 2026-10-20\n\n- Fix the thing (abc1234)\n- Add the other thing (def5678)\n',
    )
  })

  it('puts the notes first and the commits under their own heading', () => {
    expect(changelogSection({ ...release, notes: '\nNotes.\n\n' })).toBe(
      '## v0.1.0 - 2026-10-20\n\nNotes.\n\n### Commits\n\n- Fix the thing (abc1234)\n' +
        '- Add the other thing (def5678)\n',
    )
  })

  it('says so when there are no commits', () => {
    expect(changelogSection({ ...release, commits: [], notes: '' })).toContain(
      '- No commits since the last release.',
    )
  })

  it('starts a new file with a title and an empty Unreleased section', () => {
    const text = addChangelogSection(null, release)
    expect(text).toBe(
      `# Changelog\n\n## Unreleased\n\n${changelogSection({ ...release, notes: '' })}`,
    )
  })

  it('moves the Unreleased notes into the release, above the older releases', () => {
    const before = [
      '# Changelog',
      '',
      'Intro.',
      '',
      '## Unreleased',
      '',
      'M1 paragraph.',
      '',
      'M2 paragraph.',
      '',
      '## v0.0.1 - 2026-10-01',
      '',
      '- Old (1111111)',
      '',
    ].join('\n')
    const after = addChangelogSection(before, release)
    expect(after).toBe(
      [
        '# Changelog',
        '',
        'Intro.',
        '',
        '## Unreleased',
        '',
        '## v0.1.0 - 2026-10-20',
        '',
        'M1 paragraph.',
        '',
        'M2 paragraph.',
        '',
        '### Commits',
        '',
        '- Fix the thing (abc1234)',
        '- Add the other thing (def5678)',
        '',
        '## v0.0.1 - 2026-10-01',
        '',
        '- Old (1111111)',
        '',
      ].join('\n'),
    )
  })

  it('handles an empty Unreleased section at the end and the [Unreleased] spelling', () => {
    expect(addChangelogSection('# Changelog\n\n## [Unreleased]\n', release)).toBe(
      `# Changelog\n\n## [Unreleased]\n\n${changelogSection({ ...release, notes: '' })}`,
    )
  })

  it('inserts before the first release when there is no Unreleased section', () => {
    const before = '# Changelog\n\n## v0.0.1 - 2026-10-01\n\n- Old (1111111)\n'
    expect(addChangelogSection(before, release)).toBe(
      `# Changelog\n\n${changelogSection({ ...release, notes: '' })}\n## v0.0.1 - 2026-10-01\n\n- Old (1111111)\n`,
    )
    expect(addChangelogSection('# Changelog\n', release)).toBe(
      `# Changelog\n\n${changelogSection({ ...release, notes: '' })}`,
    )
  })
})

describe('git', () => {
  it('finds the last v* tag, or none', () => {
    const calls = []
    const tagged = (args) => {
      calls.push(args)
      return 'v0.1.0\n'
    }
    expect(lastTag(tagged)).toBe('v0.1.0')
    expect(calls[0]).toEqual(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'])
    expect(
      lastTag(() => {
        throw new Error('fatal: No names found')
      }),
    ).toBeNull()
  })

  it('lists the commits since the tag, or all of them', () => {
    const calls = []
    const git = (args) => {
      calls.push(args)
      return 'abc1234\tFix: a\ttab\ndef5678\tAdd b\n\n'
    }
    expect(commitsSince(git, 'v0.1.0')).toEqual([
      { hash: 'abc1234', subject: 'Fix: a\ttab' },
      { hash: 'def5678', subject: 'Add b' },
    ])
    expect(calls[0]).toEqual(['log', '--no-merges', '--format=%h%x09%s', 'v0.1.0..HEAD'])
    commitsSince(git, null)
    expect(calls[1].at(-1)).toBe('HEAD')
  })
})

describe('the CLI', () => {
  /** @type {string[]} */
  const roots = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  const tauriConfig = (version, csp, pubkey = PUBKEY_PLACEHOLDER) =>
    JSON.stringify(
      {
        productName: 'Timer App',
        version,
        identifier: 'com.timerapp.dev',
        app: { security: { csp } },
        plugins: { updater: { pubkey } },
      },
      null,
      2,
    ) + '\n'
  const CSP =
    "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost https://sync.example.org wss://sync.example.org"

  /** A repository with the versioned files at `versions` (one value, or one per file). */
  function fixture({
    version = '0.3.0',
    lockVersion = version,
    changelog,
    pubkey,
    opener = ['https://sync.example.org/device*', 'https://sync.example.org/privacy*'],
  } = {}) {
    const root = mkdtempSync(path.join(tmpdir(), 'release-test-'))
    roots.push(root)
    mkdirSync(path.join(root, 'src-tauri', 'capabilities'), { recursive: true })
    const files = {
      [FILES.packageJson]: `{\n  "name": "timer-app",\n  "version": "${version}",\n  "private": true\n}\n`,
      [FILES.tauriConfig]: tauriConfig(version, CSP, pubkey),
      [FILES.cargoToml]: `[package]\nname = "timer-app"\nversion = "${version}"\n\n[dependencies]\nserde = { version = "1" }\n`,
      [FILES.cargoLock]: `version = 4\n\n[[package]]\nname = "timer-app"\nversion = "${lockVersion}"\n`,
      [FILES.capability]: JSON.stringify({
        permissions: [
          {
            identifier: 'opener:allow-open-url',
            allow: opener.map((url) => ({ url })),
          },
        ],
      }),
      ...(changelog === undefined ? {} : { [FILES.changelog]: changelog }),
    }
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(root, file), text)
    return { root, files }
  }

  /** A fake git: answers by command, records every call. */
  function fakeGit({ tag = 'v0.3.0', status = '', tags = [] } = {}) {
    const calls = []
    const git = (args) => {
      calls.push(args)
      switch (args[0]) {
        case 'describe':
          if (tag === null) throw new Error('fatal: No names found')
          return `${tag}\n`
        case 'log':
          return 'abc1234\tAdd the release script\n'
        case 'status':
          return status
        case 'rev-parse':
          if (tags.includes(args.at(-1).replace('refs/tags/', ''))) return 'deadbeef\n'
          throw new Error('not a tag')
        default:
          return ''
      }
    }
    return { git, calls }
  }

  function run(argv, root, git = fakeGit().git) {
    const out = []
    const err = []
    const code = main(argv, {
      root,
      git,
      today: '2026-10-20',
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }

  function snapshot(root) {
    return Object.fromEntries(
      [...Object.values(FILES)].map((file) => {
        try {
          return [file, readFileSync(path.join(root, file), 'utf8')]
        } catch {
          return [file, null]
        }
      }),
    )
  }

  it('--dry-run prints the plan and changes no file', () => {
    const { root } = fixture({ changelog: '# Changelog\n\n## Unreleased\n\nNotes.\n' })
    const before = snapshot(root)
    const { git, calls } = fakeGit()
    const result = run(['minor', '--dry-run'], root, git)
    expect(result.code).toBe(0)
    expect(result.out).toContain('Release v0.4.0 (from 0.3.0), dry run: no file is changed')
    expect(result.out).toMatch(/src-tauri\/Cargo\.lock\s+timer-app 0\.3\.0 → 0\.4\.0/)
    expect(result.out).toContain('## v0.4.0 - 2026-10-20')
    expect(result.out).toContain('Notes.')
    expect(result.out).toContain('- Add the release script (abc1234)')
    expect(result.out).toContain('git tag --annotate v0.4.0 --message "Timer App v0.4.0"')
    expect(snapshot(root)).toEqual(before)
    expect(calls.map((call) => call[0])).toEqual(['describe', 'log'])
  })

  it('edits every versioned file and the changelog', () => {
    const { root, files } = fixture()
    const result = run(['0.3.1'], root)
    expect(result.code).toBe(0)
    expect(readVersions(root)).toEqual({
      [FILES.packageJson]: '0.3.1',
      [FILES.tauriConfig]: '0.3.1',
      [FILES.cargoToml]: '0.3.1',
      [FILES.cargoLock]: '0.3.1',
    })
    const after = snapshot(root)
    expect(after[FILES.packageJson]).toBe(files[FILES.packageJson].replace('0.3.0', '0.3.1'))
    expect(after[FILES.cargoToml]).toContain('serde = { version = "1" }')
    expect(after[FILES.changelog]).toBe(
      '# Changelog\n\n## Unreleased\n\n## v0.3.1 - 2026-10-20\n\n- Add the release script (abc1234)\n',
    )
    expect(result.out).toContain('--commit')
  })

  it('--commit commits the edited files and tags the release, without pushing', () => {
    const { root } = fixture()
    const { git, calls } = fakeGit()
    const result = run(['patch', '--commit'], root, git)
    expect(result.code).toBe(0)
    expect(calls.slice(-3)).toEqual([
      [
        'add',
        '--',
        'package.json',
        'src-tauri/tauri.conf.json',
        'src-tauri/Cargo.toml',
        'src-tauri/Cargo.lock',
        'CHANGELOG.md',
      ],
      ['commit', '--message', 'Release v0.3.1'],
      ['tag', '--annotate', 'v0.3.1', '--message', 'Timer App v0.3.1'],
    ])
    expect(calls.some((call) => call[0] === 'push')).toBe(false)
    expect(result.out).toContain('git push --atomic origin HEAD v0.3.1')
  })

  it('--commit refuses a dirty tree or an existing tag before editing anything', () => {
    const { root } = fixture()
    const before = snapshot(root)
    const dirty = run(['patch', '--commit'], root, fakeGit({ status: ' M README.md\n' }).git)
    expect(dirty.code).toBe(1)
    expect(dirty.err).toContain('clean working tree')
    const tagged = run(['patch', '--commit'], root, fakeGit({ tags: ['v0.3.1'] }).git)
    expect(tagged.code).toBe(1)
    expect(tagged.err).toContain('v0.3.1 exists already')
    expect(snapshot(root)).toEqual(before)
  })

  it('refuses to release while the versions differ', () => {
    const { root } = fixture({ lockVersion: '0.2.0' })
    const result = run(['patch', '--dry-run'], root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('src-tauri/Cargo.lock: 0.2.0')
  })

  it('--check passes when the versions agree and fails, listing them, when not', () => {
    expect(run(['--check'], fixture().root)).toMatchObject({ code: 0 })
    const failed = run(['--check'], fixture({ lockVersion: '0.2.0' }).root)
    expect(failed.code).toBe(1)
    expect(failed.err).toMatch(/package\.json: 0\.3\.0[\s\S]*Cargo\.lock: 0\.2\.0/)
  })

  it('--check refuses a version the Windows MSI build would refuse', () => {
    for (const version of ['1.0.0-beta.1', '300.0.0', '0.256.0', '1.0.65536']) {
      const result = run(['--check'], fixture({ version }).root)
      expect(result.code, version).toBe(1)
      expect(result.err, version).toMatch(/MSI/)
      expect(run(['--check', '--tag', `v${version}`], fixture({ version }).root).code).toBe(1)
    }
  })

  it('--check --tag compares the tag with the version', () => {
    const { root } = fixture()
    expect(run(['--check', '--tag', 'v0.3.0'], root).code).toBe(0)
    expect(run(['--check', '--tag', 'v0.3.1'], root)).toMatchObject({ code: 1 })
    expect(run(['--check', '--tag', '0.3.0'], root)).toMatchObject({ code: 1 })
  })

  it('--check --origin compares the sync server the app allows', () => {
    const { root } = fixture()
    expect(run(['--check', '--origin', 'https://sync.example.org'], root).code).toBe(0)
    expect(run(['--check', '--origin', 'https://sync.example.org/'], root).code).toBe(0)
    expect(run(['--check', '--origin', 'https://other.example.org'], root)).toMatchObject({
      code: 1,
    })
    for (const bad of ['http://sync.example.org', 'https://sync.example.org/api', 'nope']) {
      expect(run(['--check', '--origin', bad], root), bad).toMatchObject({ code: 2 })
    }
  })

  it('--check --origin fails unless the browser opener may open its sign-in page and policy', () => {
    const check = (opener) =>
      run(['--check', '--origin', 'https://sync.example.org'], fixture({ opener }).root)
    expect(check(['https://sync.example.org/privacy*'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('https://sync.example.org/device* (the sign-in page)'),
    })
    // The desktop app's links to the privacy policy (Settings › About and Account).
    for (const opener of [
      ['https://sync.example.org/device*'],
      ['https://sync.example.org/device*', 'https://old.example.org/privacy*'],
    ]) {
      expect(check(opener), opener.join(' ')).toMatchObject({
        code: 1,
        err: expect.stringContaining('https://sync.example.org/privacy* (the privacy policy)'),
      })
    }
  })

  it('--check --updater-key fails while the public key is the placeholder', () => {
    expect(run(['--check', '--updater-key'], fixture().root)).toMatchObject({ code: 1 })
    expect(run(['--check', '--updater-key'], fixture({ pubkey: 'dW50cnVzdGVk' }).root).code).toBe(0)
  })

  it('--print-origin prints the production sync server', () => {
    const result = run(['--print-origin'], fixture().root)
    expect(result).toMatchObject({ code: 0, out: 'https://sync.example.org' })
  })

  it('answers usage errors with exit code 2', () => {
    const { root } = fixture()
    for (const argv of [
      [],
      ['patch', 'minor'],
      ['nonsense'],
      ['patch', '--push'],
      ['--tag', 'v0.3.0'],
      ['--check', 'patch'],
      ['--print-origin', '--check'],
    ]) {
      expect(run(argv, root).code, argv.join(' ')).toBe(2)
    }
  })
})

describe('this repository', () => {
  const readJson = (file) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))
  const config = readJson(FILES.tauriConfig)
  const csp = parseCsp(config.app.security.csp)

  it('has one version in package.json, tauri.conf.json, Cargo.toml and Cargo.lock', () => {
    const versions = readVersions(ROOT)
    expect(Object.keys(versions)).toHaveLength(4)
    expect(parseVersion(agreedVersion(versions))).not.toBeNull()
  })

  it('allows one production sync server in the CSP and the browser opener', () => {
    const origin = productionOrigin(config, readJson(FILES.capability))
    expect(origin).toMatch(/^https:\/\//)
  })

  it('has a CSP that loads nothing from outside the app but the sync server and avatars', () => {
    expect(csp.get('default-src')).toEqual(["'self'"])
    expect(csp.get('script-src')).toEqual(["'self'"])
    expect(csp.get('object-src')).toEqual(["'none'"])
    const sources = [...csp.values()].flat()
    expect(sources.filter((s) => s.includes('localhost') && s !== 'http://ipc.localhost')).toEqual(
      [],
    )
    expect(sources).not.toContain("'unsafe-eval'")
    // The profile pictures Google and GitHub sign-ins give (Settings › Account), as images only.
    expect(csp.get('img-src')).toEqual([
      "'self'",
      'https://avatars.githubusercontent.com',
      'https://*.googleusercontent.com',
    ])
    const others = [...csp].flatMap(([name, list]) => (name === 'img-src' ? [] : list))
    expect(others.filter((s) => /^(https?|wss?):\/\//.test(s))).toEqual([
      'http://ipc.localhost',
      productionOrigin(config, readJson(FILES.capability)),
      productionOrigin(config, readJson(FILES.capability)).replace('https://', 'wss://'),
    ])
    expect(config.app.security.dangerousDisableAssetCspModification).toBe(false)
  })

  it('pins every action in the workflows to a commit, with its version in a comment', () => {
    // A moved tag cannot then run new code next to the signing keys (Dependabot bumps the pins).
    const dir = path.join(ROOT, '.github', 'workflows')
    const files = readdirSync(dir).filter((name) => name.endsWith('.yml'))
    expect(files).toEqual(expect.arrayContaining(['ci.yml', 'deploy.yml', 'release.yml']))
    for (const file of files) {
      const text = readFileSync(path.join(dir, file), 'utf8')
      const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(.+)$/gm)].map((match) => match[1].trim())
      expect(uses.length, file).toBeGreaterThan(0)
      for (const use of uses) {
        expect(use, `${file}: ${use}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # \S+$/)
      }
    }
  })

  it('keeps <style> out of index.html, where Tauri would nonce it and void unsafe-inline', () => {
    // With a nonce in style-src, browsers ignore 'unsafe-inline', and the app's style attributes
    // and theme <style> element (added at runtime) would be blocked.
    expect(readFileSync(path.join(ROOT, 'index.html'), 'utf8')).not.toMatch(/<style[\s>]/i)
    expect(csp.get('style-src')).toContain("'unsafe-inline'")
  })

  it('has the local-server overlay add only the local sync server to connect-src', () => {
    const local = parseCsp(readJson('src-tauri/tauri.local-server.json').app.security.csp)
    expect([...local.keys()]).toEqual([...csp.keys()])
    for (const [name, sources] of csp) {
      const extra = name === 'connect-src' ? ['http://localhost:8787', 'ws://localhost:8787'] : []
      expect(local.get(name), name).toEqual([...sources, ...extra])
    }
  })

  it('has overlays that each set only their own setting', () => {
    const strip = ({ $schema, ...rest }) => {
      expect($schema).toBe('../node_modules/@tauri-apps/cli/config.schema.json')
      return rest
    }
    expect(strip(readJson('src-tauri/tauri.updater.json'))).toEqual({
      bundle: { createUpdaterArtifacts: true },
    })
    expect(strip(readJson('src-tauri/tauri.release.macos-adhoc.json'))).toEqual({
      bundle: { macOS: { signingIdentity: '-' } },
    })
    const windows = strip(readJson('src-tauri/tauri.release.windows.json'))
    expect(Object.keys(windows.bundle.windows)).toEqual(['signCommand'])
    expect(windows.bundle.windows.signCommand.cmd).toBe('artifact-signing-cli')
    expect(windows.bundle.windows.signCommand.args.at(-1)).toBe('%1')
    // The base config makes no updater artifacts: they need the signing key (the overlay's case).
    expect(config.bundle.createUpdaterArtifacts).toBeUndefined()
    expect(config.bundle.macOS.signingIdentity).toBeUndefined()
    expect(config.bundle.windows.signCommand).toBeUndefined()
  })
})
