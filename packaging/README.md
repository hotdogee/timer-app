# Packaging: winget and Homebrew

Templates for the two package managers that install Timer App from its GitHub releases, and the
scripts that fill them in. Neither package exists yet: until the first release, everything here
is a template, and the winget package and the Homebrew tap are created as described below.

| Path                                            | What                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `winget/Hotdogee.TimerApp/*.yaml.tmpl`          | The winget manifest: version, default locale (en-US) and installer |
| `homebrew/timer-app.rb.tmpl`                    | The Homebrew cask                                                  |
| `scripts/winget-manifest.mjs` (repository root) | Renders the winget manifests for a version                         |
| `scripts/update-cask.mjs` (repository root)     | Renders the cask for a version and commits it to the tap           |

Both scripts read the app's name, publisher, descriptions, homepage, bundle id and minimum macOS
version from `src-tauri/tauri.conf.json`, and the license from `package.json`, so the packages say
what the installers say. The winget manifests' `PrivacyUrl` is the privacy policy's page on the
production site, `/privacy` on the origin `node scripts/release.mjs --print-origin` prints. The
version is the app's (`pnpm version:check`), or `--version`.

## What a release must contain

With `--release`, the scripts find the files in the GitHub release `v<version>` by kind and
architecture:

- winget: one NSIS installer (`…-setup.exe` or `…_setup.exe`) each for `x64` and `arm64`;
- Homebrew: one DMG (`….dmg`) each for `aarch64` (Apple Silicon) and `x64` (Intel), whose names
  differ only in that word.

The architecture is a word between `.`, `_` or `-` (`x64`, `x86_64` or `amd64`; `arm64` or
`aarch64`), so any `releaseAssetNamePattern` works. A missing file, or two candidates for one,
fails with the list of assets. Checksums are the SHA-256 GitHub records for each asset; an asset
without one is downloaded and hashed. `GITHUB_TOKEN` or `GH_TOKEN`, when set, authenticates these
reads (and finds a draft release). Placeholder and local output names the files as the release
workflow uploads them (`timer-app_<version>_windows_x64-setup.exe`,
`timer-app_<version>_darwin_aarch64.dmg`: `ASSET_NAME_PATTERN` in `scripts/check-latest-json.mjs`).

## winget

The package id is `Hotdogee.TimerApp`. It must never change once the package is in the winget
repository: another id is another package. winget matches an installed copy by its Add/Remove
Programs entry, which Tauri's NSIS installer writes from `productName` (`Timer App`, also the
entry's key, used as `ProductCode`) and `bundle.publisher` (`Han Lin`); the manifest takes both
from the same place. The installer is per user (`Scope: user`, `%LocalAppData%\Timer App`), and
winget runs it silently with `/S`.

```sh
node scripts/winget-manifest.mjs --placeholder --out <dir> --validate   # before any release
node scripts/winget-manifest.mjs --release --out <dir> --validate       # from the release
node scripts/winget-manifest.mjs --release --print-urls                 # "<url>|<arch>" lines
node scripts/winget-manifest.mjs --installer x64=<setup.exe> --out <dir>  # a local build
```

`--validate` runs `winget validate --manifest <dir>` (Windows) and fails on its warnings too.
Placeholder and local output says so in its first lines and must never be submitted. Options:
`--version x.y.z`, `--release-date YYYY-MM-DD` (default: the release's date), `--repo owner/name`.

### First submission (once, after the first release is published)

```sh
node scripts/winget-manifest.mjs --release --out <dir> --validate
winget settings --enable LocalManifestFiles     # optional, as administrator, on a test machine:
winget install --manifest <dir>                 # installs from the rendered manifests
wingetcreate token --store                      # signs in to GitHub (or a classic token, below)
wingetcreate submit --prtitle "New package: Hotdogee.TimerApp version <version>" <dir>
```

`wingetcreate submit` opens a pull request to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), which moderators review; the
package exists once it is merged.

### Later versions

Once the package exists, each release updates it from the `<url>|<arch>` lines of `--print-urls`:

```sh
wingetcreate update Hotdogee.TimerApp --version <version> --urls "<url>|x64" "<url>|arm64" --submit
```

wingetcreate needs a classic personal access token with the `public_repo` scope (fine-grained
tokens are not supported); in CI give it as the `WINGET_CREATE_GITHUB_TOKEN` environment variable
rather than `--token`, which may end up in logs. Create it on a separate bot GitHub account that
owns the winget-pkgs fork and has no write access to hotdogee's repositories: `public_repo` can
push to every public repository its account can write to, which on the owner's account includes
this repository (its `main`, and the `v*` tags that start a signed release) and the tap.

## Homebrew

Timer App is offered from its own tap, `hotdogee/homebrew-tap`, as the cask `timer-app`. Homebrew's
main cask repository takes only apps that pass Gatekeeper (signed and notarized) from projects that
meet its notability rules, so it is not the first step.

```sh
node scripts/update-cask.mjs --placeholder                     # before any release, to stdout
node scripts/update-cask.mjs --release --out timer-app.rb      # from the release
HOMEBREW_TAP_TOKEN=… node scripts/update-cask.mjs --release --push
node scripts/update-cask.mjs --dmg arm=<a.dmg> --dmg intel=<b.dmg>   # local disk images
```

The cask's `url` uses `#{version}` and `#{arch}` (built from the release's DMG names and checked
against both), `livecheck` follows the latest GitHub release, `depends_on` is `:macos` unless
`bundle.macOS.minimumSystemVersion` is newer than Big Sur (the oldest macOS Homebrew runs on), and
`auto_updates true` appears once the updater has its public key. `zap` removes the app's data under
`~/Library` (named after the bundle id; WebKit keeps the cards there) and the launch-at-login agent;
the sign-in token in the login keychain (`Timer App`) stays. Add `--not-notarized` for a release
built without the Apple secrets: the cask then tells people how to open an app Apple has not
notarized.

`--push` commits `Casks/timer-app.rb` to the tap through the GitHub API, only from a release and
only when the file changed. `HOMEBREW_TAP_TOKEN` is a fine-grained personal access token for the
tap repository alone, with Contents: Read and write. `--tap owner/homebrew-name` picks another tap.

### Creating the tap (once)

```sh
brew tap-new hotdogee/homebrew-tap
gh repo create hotdogee/homebrew-tap --push --public --source "$(brew --repository hotdogee/homebrew-tap)"
```

The first `--push` adds `Casks/timer-app.rb`; the template's `Formula/` folder can stay empty.

After a release has been pushed, on a Mac:

```sh
brew install --cask hotdogee/tap/timer-app
brew audit --cask --online hotdogee/tap/timer-app
brew style --cask hotdogee/tap/timer-app
```

`brew audit` takes casks by name, not by path, so a rendered cask that is not in the tap yet is
audited from a local tap:

```sh
brew tap-new --no-git local/test
mkdir -p "$(brew --repository local/test)/Casks"
cp timer-app.rb "$(brew --repository local/test)/Casks/"
brew audit --cask --online local/test/timer-app
brew untap local/test
```

Renaming the app (spec Q13) renames the cask token; a tap keeps users on the old token only through
a `cask_renames.json` entry, so rename before the first release.
