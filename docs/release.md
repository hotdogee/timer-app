# Releasing

How a version of Timer App goes from `main` to its users. One command sets the version and tags it; pushing the tag runs the release workflow (`.github/workflows/release.yml`), which tests the tagged commit, builds the desktop apps on GitHub's runners, publishes the GitHub Release with the in-app updater's manifest, deploys the web app and the sync server, and updates winget and the Homebrew tap.

Nothing in it needs a credential to stay green. Each secret turns on one thing (code signing, updates, a package manager, the deploy); a release made without it skips or degrades only that, as [Secrets](#secrets) lists. Before the first public release, the owner settles the items in [Before the first release](#before-the-first-release). Local development needs none of this; see the [README](../README.md).

## What a release publishes

| Channel | What | Needs |
|---|---|---|
| GitHub Release `vX.Y.Z` | The installers below; with the updater key also `latest.json` and a `.sig` beside each bundle the updater can install. Title `Timer App vX.Y.Z`, notes from the version's section of `CHANGELOG.md`. | nothing |
| In-app updater | `latest.json`, read from `https://github.com/hotdogee/timer-app/releases/latest/download/latest.json` (the endpoint in `src-tauri/tauri.conf.json`) | the updater key |
| Web app and sync server | The Worker with `dist/`, deployed by `deploy.yml` ([deploy.md](deploy.md)) | `CLOUDFLARE_API_TOKEN` or the variable `DEPLOY_ON_RELEASE` |
| winget | A pull request to `microsoft/winget-pkgs` for `Hotdogee.TimerApp` | the first submission by hand, then `WINGET_TOKEN` |
| Homebrew | `Casks/timer-app.rb` in the tap `hotdogee/homebrew-tap` | the tap repository and `HOMEBREW_TAP_TOKEN` |
| Microsoft Store | An installer with WebView2 inside, submitted by hand | see [Microsoft Store](#microsoft-store) |

The release assets are named `timer-app_<version>_<platform>_<arch>…` (tauri-action's `releaseAssetNamePattern`, `timer-app_[version]_[platform]_[arch][setup][ext]`, which `scripts/check-latest-json.mjs` shares). The names have no spaces, so GitHub keeps them as they are, and each format keeps its own spelling of the architecture:

| Platform | Installers (version 0.1.0 as the example) |
|---|---|
| Windows x64 | `timer-app_0.1.0_windows_x64-setup.exe` (NSIS: installs for the current user, no administrator rights), `timer-app_0.1.0_windows_x64.msi` (installs for every user) |
| Windows Arm64 | `timer-app_0.1.0_windows_arm64-setup.exe`, `timer-app_0.1.0_windows_arm64.msi` |
| macOS Apple Silicon | `timer-app_0.1.0_darwin_aarch64.dmg`; the updater's `timer-app_0.1.0_darwin_aarch64.app.tar.gz` |
| macOS Intel | `timer-app_0.1.0_darwin_x64.dmg`; `timer-app_0.1.0_darwin_x64.app.tar.gz` |
| Linux x64 | `timer-app_0.1.0_linux_amd64.AppImage`, `timer-app_0.1.0_linux_amd64.deb`, `timer-app_0.1.0_linux_x86_64.rpm` |
| Linux Arm64 | `timer-app_0.1.0_linux_aarch64.AppImage`, `timer-app_0.1.0_linux_arm64.deb`, `timer-app_0.1.0_linux_aarch64.rpm` |

They are built on pinned runner images: `windows-2025` for both Windows targets (Arm64 cross-compiled), `macos-15` (Apple Silicon) for both macOS targets (Intel cross-compiled), `ubuntu-22.04` and `ubuntu-22.04-arm` for Linux. Ubuntu 22.04's older glibc (2.35) lets the Linux builds run on older distributions; GitHub retires those images on 2027-04-17, so move to 24.04 before then.

## The pieces

- `pnpm release <patch|minor|major|x.y.z>` (`scripts/release.mjs`) writes the next version into `package.json` (the source), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the crate's entry in `src-tauri/Cargo.lock`, and adds `## vX.Y.Z - YYYY-MM-DD` (UTC) to `CHANGELOG.md` under `## Unreleased`: the notes written under Unreleased move into it, followed by `### Commits`, the subjects of the commits since the last `v*` tag. Versions are plain `x.y.z` and at most `255.255.65535`, the largest an MSI accepts. `--dry-run` prints the plan and changes nothing; `--commit` (clean tree only) also commits `Release vX.Y.Z` and creates the annotated tag `vX.Y.Z`. It never pushes.
- `pnpm version:check` fails unless the four files carry one version, and one a release can build: plain `x.y.z` within the MSI limits, the rule `pnpm release` applies (a hand-edited `1.0.0-beta.1` or `300.0.0` would otherwise pass every check and fail only in the Windows jobs, after the whole build). CI runs it on every push; the release workflow adds `--tag vX.Y.Z` (the tag must be `v` plus that version), `--origin` (the content security policy and the browser opener must allow exactly the production sync server) and, with the updater key, `--updater-key` (the public key in `tauri.conf.json` must be real). `node scripts/release.mjs --print-origin` prints the production sync server, which release builds get as `TIMER_SERVER_ORIGIN`.
- `scripts/release-notes.mjs` prints a version's `CHANGELOG.md` section for the GitHub Release; a tag without a section fails before anything is built.
- `scripts/check-latest-json.mjs` writes the draft release's `latest.json` from its signatures before the release goes public, then checks it: every platform built, every signature made with the app's key and for this version. tauri-action uploads the bundles and their `.sig` files but not `latest.json` (`uploadUpdaterJson: false`), since its six jobs would race to rewrite the one file.
- `scripts/winget-manifest.mjs` and `scripts/update-cask.mjs` render the winget manifests and the Homebrew cask from `packaging/` (see [packaging/README.md](../packaging/README.md)).
- Overlays in `src-tauri/`, merged with `--config` (paths from the repository root) only in the matching case, so a plain `pnpm tauri build` stays unsigned and needs no key:
  - `tauri.updater.json` turns on `bundle.createUpdaterArtifacts` (the `.sig` files and `latest.json`): when `TAURI_SIGNING_PRIVATE_KEY` exists.
  - `tauri.release.windows.json` signs every Windows binary and installer through Azure Artifact Signing (`signCommand`): on Windows, when all five `AZURE_*` secrets exist (verify stops a run that has only some of them).
  - `tauri.release.macos-adhoc.json` signs the macOS app ad hoc (`signingIdentity: "-"`): on macOS, when `APPLE_CERTIFICATE` is absent. Apple Silicon runs nothing unsigned.
  - `tauri.microsoftstore.conf.json` makes the Microsoft Store's installer (below). Not part of a normal release.
  - `tauri.local-server.json` adds the local `wrangler dev` to the content security policy for local test builds. Never in CI or a release.
- `.github/workflows/release.yml` runs on a pushed `v*` tag, or by hand (Actions › Release › Run workflow) with two inputs: `dry_run` (on by default) and `tag`. Its jobs, in order:
  1. **Verify**: the tag is `vX.Y.Z`, names the app's version and is on `main`; `CHANGELOG.md` has its section; the sync server in the content security policy is not a placeholder domain (`timer.example.com` stops a real release, spec Q13; a dry run only warns); with the updater key, the public key is real, and without it, the public key is still the placeholder (a real key without its private half would ship a release installed apps cannot update to); the five Azure secrets are all set or none is. Then CI's checks: `check`, `lint`, `test`, `test:server`, `build` and the end-to-end tests. Its summary lists which credentials exist.
  2. **Create the draft release** `Timer App vX.Y.Z` with the notes from `CHANGELOG.md` (an earlier run's draft of the same tag is reused; a published release never is).
  3. **Desktop**, six jobs, one per platform in the table above: tauri-action builds with the overlays that apply and uploads the installers and their `.sig` files to the draft. On dry runs it gets no release and no token, and keeps the installers as workflow artifacts instead.
  4. **Publish the release**: with the updater key, writes `latest.json` from the signatures and checks it; then makes the release public and the latest, and starts `deploy.yml` for the tag.
  5. **winget** and **Homebrew**, in parallel: render the manifests and the cask from the published release (kept as the artifacts `winget-manifests` and `homebrew-cask`), validate them, and submit them when their tokens exist.
  6. **Store installer** (x64 and Arm64), on runs started by hand only: the Microsoft Store's installer, as a workflow artifact.
- Every `uses:` in the workflows names a commit, with its version in a comment (`uses: actions/checkout@<sha> # v7.0.1`), so a tag moved upstream cannot change the code that runs beside the signing keys; `.github/dependabot.yml` proposes the bumps weekly, and a test fails on an unpinned action. The tools the release downloads are pinned too: `artifact-signing-cli` and `wingetcreate` by version and SHA-256, the `Microsoft.WinGet.Client` module by version.

## Cut a release

Before you start: you are on `main`, level with `origin/main`, the working tree is clean and CI is green on that commit. For the first release, also: the [QA checklist](#qa-checklist-for-the-owner) is done, and a dry run with the secrets you set is green ([Checking a dry run](#checking-a-dry-run)).

1. **Notes.** Under `## Unreleased` in `CHANGELOG.md`, write what changed for users, one line per paragraph (GitHub shows the line breaks of release notes as they are). Commit.
2. **Preview.** `pnpm release minor --dry-run` (or `patch`, `major`, `x.y.z`). It prints the five edits, the changelog section and the git commands, and changes nothing.
3. **Cut.** `pnpm release minor --commit`. It edits the five files, commits them as `Release vX.Y.Z` and tags `vX.Y.Z`. Check with `git show --stat HEAD` and `pnpm version:check --tag vX.Y.Z`. (Without `--commit` it only edits the files, for you to review and commit yourself.)
4. **Push.** `git push --atomic origin HEAD vX.Y.Z`, as the script prints. `--atomic` pushes both or neither: if `main` refuses the release commit (a ruleset, or your `main` is behind), the tag stays local instead of starting a release that verify would stop. The tag starts Actions › Release.
5. **Watch.** `gh run watch` (or the Actions tab). Verify runs first, then the six desktop builds in parallel; the draft release fills up as each platform finishes, and the publish job makes it public by itself once all six are in. If anything fails before that, the release stays a draft ([When something goes wrong](#when-something-goes-wrong)).
6. **Check the release.** On the release page: every installer in the table above; with the updater key, `latest.json` and the `.sig` files. `latest.json` names each of `windows-x86_64`, `windows-aarch64`, `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64` and `linux-aarch64` (plus a key per bundle, such as `windows-x86_64-msi`), each with a `signature` and a `url` of the form `https://github.com/hotdogee/timer-app/releases/download/vX.Y.Z/<asset>`. The workflow checked this before publishing; a look costs a minute.
7. **Updater.** On a machine with the previous version installed: Settings › About › Check for updates offers the new version; Install and restart; About shows it afterwards. (The first release has nothing to update from: do this on the second.)
8. **Web.** Actions › Deploy shows the run the release started (approve it if the `production` environment asks; without a deploy secret, the publish job's notice says to run it by hand with `ref` = the tag); then [deploy.md › Smoke checks](deploy.md#7-smoke-checks).
9. **winget.** The winget job's log links the pull request in `microsoft/winget-pkgs`. Its validation pipeline and a moderator review it, which takes hours to days; then `winget show Hotdogee.TimerApp` lists the version. First release: the job stops with a notice instead; submit the `winget-manifests` artifact by hand ([winget](#winget) step 1).
10. **Homebrew.** `hotdogee/homebrew-tap` has a commit for the version; `brew update && brew upgrade --cask timer-app` installs it. First release: create the tap first ([Homebrew tap](#homebrew-tap)), then check with `brew install --cask hotdogee/tap/timer-app`.
11. **Microsoft Store.** Build and submit the Store's installer for the version ([Microsoft Store](#microsoft-store)), if the app is listed there.

## Dry run

A dry run builds everything a release would and publishes nothing, so the workflow, the signing and the installers can be tried at any time:

```sh
gh workflow run release.yml --ref main -f dry_run=true                # the branch's current commit
gh workflow run release.yml --ref main -f dry_run=true -f tag=v0.1.0  # an existing tag
```

(or Actions › Release › Run workflow, with "Dry run" ticked). Verify, the six desktop builds and the two Store installers run, and winget and Homebrew render and check placeholder manifests; the draft release, publish, the deploy and every submission are skipped, and tauri-action gets no token, so nothing can reach a release. A placeholder sync server or a missing updater key is a warning instead of an error. Afterwards: the verify job's summary shows which credentials the run had, and the run's artifacts hold every installer, one artifact per platform, architecture and bundle (`windows-x64-nsis`, `darwin-aarch64-dmg`, …), plus `microsoft-store-windows-x64-nsis`, `microsoft-store-windows-arm64-nsis`, `winget-manifests` and `homebrew-cask`. [Checking a dry run](#checking-a-dry-run) lists all 18 and what a good run shows.

The same form with "Dry run" unticked and a tag releases that tag: the way to finish a release whose run failed before it was published (it reuses the draft).

## Secrets

The names must be exactly these; values never appear in logs. The release workflow has no `pull_request` trigger, so pull requests and forks never see them, and each reaches only the steps that use it.

Keep the signing secrets (`TAURI_SIGNING_PRIVATE_KEY` and its password, the five `AZURE_*` and the `APPLE_*` ones) in an environment named `release`, not as repository secrets: Settings › Environments › New environment `release` (the first run creates it, empty, if you have not), then Deployment branches and tags › Selected branches and tags › add the branch `main` and the tag `v*`, then its Environment secrets. The jobs that use them (verify, the six desktop builds and the Store installers) run in that environment, so a run started from any other branch stops at verify instead of building unreviewed code with the keys. Required reviewers are not needed (they would hold up each of those jobs). Dry runs from `main` sign their builds like a release, and since the repository is public, anyone signed in to GitHub can download their artifacts for 90 days; that is why they run from `main` only. `WINGET_TOKEN` and `HOMEBREW_TAP_TOKEN` stay repository secrets (Settings › Secrets and variables › Actions), since the jobs that use them do not run in `release`; the deploy secrets go where [Cloudflare](#cloudflare) says.

Linux has no signing secret: the AppImage, `.deb` and `.rpm` ship unsigned, and the updater still checks every update against the updater key. Tauri can sign the AppImage with GPG (`SIGN=1`, `SIGN_KEY`, `APPIMAGETOOL_SIGN_PASSPHRASE`, `APPIMAGETOOL_FORCE_SIGN`), and the packages could be served from a signed apt or rpm repository; neither is wired into `release.yml`.

| Secret | Turns on | Without it |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The updater: `.sig` files and `latest.json` | No updater files: installed apps never learn about the release (users update by hand, winget or Homebrew) |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_ARTIFACT_SIGNING_ACCOUNT`, `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` (all five or none: verify stops a run that has only some) | Authenticode signing of the Windows app, installers and uninstaller | Unsigned Windows builds: SmartScreen warns on download and first run ("More info › Run anyway"); winget accepts them; the Microsoft Store does not |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`; optionally `APPLE_SIGNING_IDENTITY` | Developer ID signing of the macOS app | Ad-hoc signing: the app runs, but macOS blocks the first open until System Settings › Privacy & Security › Open Anyway |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_PRIVATE_KEY`; or `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Notarization (with the certificate) | Signed but not notarized: Gatekeeper blocks the first open as for an ad-hoc app |
| `WINGET_TOKEN` | The winget pull request for each release | The job validates the manifests, keeps them as an artifact and prints the `wingetcreate` command to run by hand |
| `HOMEBREW_TAP_TOKEN` | Pushing the cask to `hotdogee/homebrew-tap` | The job renders the cask (and audits it, once the tap exists), keeps it as an artifact and stops; copy it to the tap by hand |
| `CLOUDFLARE_API_TOKEN` (or the repository **variable** `DEPLOY_ON_RELEASE` = `true`), with `CLOUDFLARE_ACCOUNT_ID` | Deploying the web app and the server after the release | Nothing is deployed: run Actions › Deploy with `ref` = the tag, or `pnpm server:deploy`, yourself |

`GITHUB_TOKEN` is GitHub's own, per run: `contents: write` only in the jobs that write the release, plus `actions: write` in publish, to start the deploy. Dry runs give tauri-action no token at all.

The deploy secrets usually live in the `production` environment ([deploy.md](deploy.md#deploying-from-github-actions)), which the release workflow cannot read; then set the repository variable `DEPLOY_ON_RELEASE` to `true` (Settings › Secrets and variables › Actions › Variables) so it starts the deploy anyway, and the environment's reviewers approve it.

### Updater key

The updater installs only updates signed with this key; the app carries the public half.

1. Generate it once, on your own machine (never in the repository):

   ```sh
   pnpm tauri signer generate -w ~/.tauri/timer-app.key
   ```

   It asks for a password (choose one) and writes the private key to `~/.tauri/timer-app.key` and the public key to `~/.tauri/timer-app.key.pub`.
2. Put the content of `timer-app.key.pub` in `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` (done on 2026-10-18 for the current key). The test `this_repository_config_has_an_updater_key` in `src-tauri/src/updater.rs` asserts a real key, and `pnpm version:check --updater-key` checks the config. If the key is ever regenerated, replace the public key and commit.
3. Secrets: `TAURI_SIGNING_PRIVATE_KEY` = the content of `timer-app.key`; `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password.
4. Keep the key file and its password in a password manager as well. **If the key is lost, the installed apps can never update again**: a new key means a new public key, which only a manual reinstall brings to them.

### Windows code signing (Azure Artifact Signing)

Microsoft's managed signing service, about $10 a month (Basic). The certificate is short-lived and stays in Azure; `artifact-signing-cli` signs each file through `signtool`, which the overlay's `signCommand` runs for the app, the installers and the uninstaller.

Public certificates are issued to organizations in the US, Canada, the EU, the UK, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway and Israel, but to **individual developers only in the US and Canada**. Elsewhere, an individual needs another route (see [the QA checklist](#before-the-first-release)); any tool that signs one file can replace the overlay's `signCommand`.

1. An Azure subscription. In it, Resource providers › register `Microsoft.CodeSigning`. For an individual, the validation in step 3 takes your details from the subscription's billing account, so check it first ([Manage billing accounts](https://learn.microsoft.com/microsoft-365/commerce/manage-billing-accounts)): its Account Type must be Individual, and its legal name and sold-to address must be exactly as on the government ID you will show.
2. Create an Artifact Signing account (portal: Artifact Signing Accounts › Create; a region near you, pricing Basic). Note the account name and the region's endpoint (for example `https://wus2.codesigning.azure.net` for West US 2, `https://weu.codesigning.azure.net` for West Europe; the [quickstart](https://learn.microsoft.com/azure/artifact-signing/quickstart) lists all).
3. Give yourself the **Artifact Signing Identity Verifier** role on the account (Access control (IAM)), then Identity validations › New identity › Public, and complete the verification (an ID check for individuals; 1 to 20 business days for organizations). An individual first switches the page's **Organization** dropdown to **Individual**, then New identity › Public, and picks the billing account; the form fills in from it and cannot be edited there.
4. Certificate profiles › Create › Public Trust, with that identity. Note the profile name.
5. Microsoft Entra ID › App registrations › New registration (for example `timer-app-signing`). Note its Application (client) ID and Directory (tenant) ID; Certificates & secrets › New client secret, and note the value (shown once; set a reminder before it expires).
6. On the certificate profile (or the account), assign the app registration the **Artifact Signing Certificate Profile Signer** role.
7. Put the endpoint in `src-tauri/tauri.release.windows.json` (`-e`; it says West US 2 until then) and commit.
8. Secrets (in the `release` environment, all five together): `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_ARTIFACT_SIGNING_ACCOUNT` (the account name) and `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` (the profile name). With only some of them set, verify stops the run and names the missing ones.

The `windows-2025` runner image has .NET 8, the Azure CLI and signtool from the Windows SDK 10.0.26100; when the five secrets exist, the Windows jobs download the prebuilt `artifact-signing-cli.exe` of [artifact-signing-cli](https://github.com/Levminer/artifact-signing-cli) 0.11.0 from its GitHub release and check it against the SHA-256 pinned in `release.yml` (`ARTIFACT_SIGNING_CLI_URL` and `ARTIFACT_SIGNING_CLI_SHA256`; change both to move to another version). To sign locally, install those tools and `artifact-signing-cli` (that exe, or `cargo install artifact-signing-cli --version 0.11.0 --locked`), set the five variables and add `--config src-tauri/tauri.release.windows.json` to `pnpm tauri build` (`SIGNTOOL_PATH` and `AZURE_CLI_PATH` override where it looks for those tools). Tauri runs the command for each file it ships: the app, the NSIS plugins, the uninstaller, the installer, the WiX extensions and the MSI. Without `artifact-signing-cli` on the `PATH` the build stops at the first one with ``failed to bundle project: `program not found` ``. The certificate's subject (your validated name) is what Windows shows as the publisher.

### macOS signing and notarization

Needs the Apple Developer Program ($99 a year) and a Mac for the first steps.

1. Certificates, Identifiers & Profiles › Certificates › Create › **Developer ID Application** (only the account holder can create it), with a certificate signing request made in Keychain Access (Certificate Assistant › Request a Certificate From a Certificate Authority, saved to disk). Download the `.cer` and open it, so it lands in the login keychain.
2. Keychain Access › My Certificates › the certificate's key › Export, as `.p12` with a password, to a folder outside the repository. There, `openssl base64 -A -in certificate.p12 -out certificate-base64.txt`; delete `certificate-base64.txt` once its content is in the secret, and keep the `.p12` in your password manager. (`.gitignore` leaves out `*.p12`, `*.p8`, `*.key` and the like, but none of these files belongs in a clone.)
3. Secrets: `APPLE_CERTIFICATE` = the content of `certificate-base64.txt`; `APPLE_CERTIFICATE_PASSWORD` = the export password (required: the workflow refuses a certificate without one). Tauri imports the certificate into a temporary keychain and finds its identity itself; set `APPLE_SIGNING_IDENTITY` (as `security find-identity -v -p codesigning` prints it: `Developer ID Application: Your Name (TEAMID)`) only to choose one.
4. Notarization, one of:
   - an App Store Connect API key (preferred): App Store Connect › Users and Access › Integrations › App Store Connect API › Team Keys › add a key with **Developer** access. Secrets: `APPLE_API_ISSUER` = the Issuer ID above the keys table; `APPLE_API_KEY` = the key's Key ID; `APPLE_API_PRIVATE_KEY` = the content of the downloaded `AuthKey_<Key ID>.p8` (it can be downloaded only once). The workflow writes it to a file for Tauri's `APPLE_API_KEY_PATH`.
   - an Apple ID: `APPLE_ID` = its email; `APPLE_PASSWORD` = an app-specific password (account.apple.com › Sign-In and Security › App-Specific Passwords); `APPLE_TEAM_ID` = the Team ID from the developer account's Membership details.

With `APPLE_CERTIFICATE` set, the ad-hoc overlay is no longer applied; without a notarization secret, the build is signed but the workflow warns that Gatekeeper will block it. The first notarization of a new account can take hours.

### winget

The package `Hotdogee.TimerApp` lives in [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). Its `Publisher` and `PackageName` must match what the installer writes to Add/Remove Programs (`bundle.publisher` "Han Lin" and the product name), which `scripts/winget-manifest.mjs` takes from `tauri.conf.json`.

1. First version, by hand (`wingetcreate update` needs a package that exists): the first release's winget job renders and validates the three manifests from the published installers, keeps them as the artifact `winget-manifests` and stops with a notice. Download it (or render them yourself with `node scripts/winget-manifest.mjs --release --out <dir> --validate`) and submit it with `wingetcreate submit <dir>`, which signs you in to GitHub and opens the pull request; [packaging/README.md › First submission](../packaging/README.md#first-submission-once-after-the-first-release-is-published) has the commands.
2. `WINGET_TOKEN`: a GitHub **classic** personal access token (fine-grained tokens are not supported by `wingetcreate`) with the `public_repo` scope, created on a **separate bot GitHub account** that owns the fork of winget-pkgs and has no write access to hotdogee's repositories. `public_repo` can push to every public repository its account can write to, so on your own account it could push to `main` here, push a `v*` tag (which starts a signed release) or change the tap; on the bot account it reaches only the bot's own fork. Set an expiry and a reminder.
3. Later releases: once the package is in winget-pkgs, the winget job runs `wingetcreate update Hotdogee.TimerApp --version X.Y.Z --urls <x64 and arm64 setup.exe> --submit` (the token reaches it as `WINGET_CREATE_GITHUB_TOKEN`, never on a command line), which forks winget-pkgs into the token's account and opens the pull request.

### Homebrew tap

1. Create the public repository `hotdogee/homebrew-tap`, on a Mac with `brew tap-new` as in [packaging/README.md › Creating the tap](../packaging/README.md#creating-the-tap-once). Users then install with `brew install --cask hotdogee/tap/timer-app`.
2. `HOMEBREW_TAP_TOKEN`: a fine-grained personal access token with access to that repository only and the permission Contents: Read and write. Set an expiry and a reminder.
3. Each release, the Homebrew job renders `Casks/timer-app.rb` (the version and the two DMGs' SHA-256; with a caveat on how to open the app while it is not notarized), runs `brew style` and `brew audit --cask --online` on it and commits it to the tap.

Homebrew's own repository (`homebrew/cask`) needs a notarized app and a notable project; the tap needs neither. Without notarization users still allow the app once in Privacy & Security.

### Cloudflare

The deploy itself is [deploy.md](deploy.md): do its one-time setup first (database, address, Worker secrets), then put `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` where [deploy.md › Deploying from GitHub Actions](deploy.md#deploying-from-github-actions) says. The release starts `deploy.yml` for the tag once the desktop builds are published, so the web app, the server and the desktop apps ship the same version.

## The updater

- The desktop app checks `latest.json` 10 seconds after launch and every 6 hours (and from Settings › About), compares the version with its own (only a newer one is offered), downloads the bundle for its platform and verifies its signature against `plugins.updater.pubkey` before installing. It installs the kind of bundle the app came from (each build records it): on Windows the NSIS or MSI installer, in passive mode (a progress bar, no questions); on macOS the `.app`; on Linux the AppImage, `.deb` or `.rpm`.
- The app reads `latest.json` at `https://github.com/hotdogee/timer-app/releases/latest/download/latest.json`, which GitHub serves from the newest published release, so a draft or a pre-release is never offered. The publish job writes the file from the release's signatures (`scripts/check-latest-json.mjs --download-urls`), with each bundle's download URL, `https://github.com/hotdogee/timer-app/releases/download/vX.Y.Z/<asset>`. Those URLs work from the moment the release is public (before that, `releases/latest` does not point at it anyway) and have no hourly limit, unlike the API's asset URLs that tauri-action would write (`https://api.github.com/repos/…/releases/assets/<id>`: 60 unauthenticated requests an hour per IP address).
- A build whose `pubkey` is still the placeholder says updates aren't set up and never checks; so every release before the key existed must be updated by hand once.
- `requireSignedVersion` (`plugins.updater` in `tauri.conf.json`) is off. Every signature made by the Tauri CLI 2.12 that builds the releases records its version, and the updater (tauri-plugin-updater 2.14) refuses one whose version differs from `latest.json`'s even with the flag off, so a forged `latest.json` cannot pair a newer version number with an older bundle that records its own. `requireSignedVersion` also refuses signatures that record no version (made by older CLIs), which closes the downgrade to such bundles. Turn it on before the first release, while none exist: it costs nothing then. It is in the checklist below.

## Microsoft Store

Tauri makes EXE and MSI installers, not MSIX, so the Store lists the app as an "EXE or MSI app": its listing points at an installer we host, and our own updater keeps installed copies current. Microsoft's requirements: an HTTPS, versioned URL whose file never changes; an installer that installs silently and downloads nothing while it runs; every binary signed by a CA in the Microsoft Trusted Root Program (so [Windows code signing](#windows-code-signing-azure-artifact-signing) comes first); and a publisher name that differs from the product name ("Han Lin" and "Timer App").

`src-tauri/tauri.microsoftstore.conf.json` builds only the NSIS installer, with the WebView2 runtime inside (`offlineInstaller`) instead of downloading it. That runtime makes the installer about 210 MB (the October 2026 WebView2 installer is 204 MiB). It keeps the release's install mode (current user, no administrator rights), so the in-app updater, which installs the regular NSIS installer from GitHub, updates a Store install in place; a per-machine or "both" mode would make the first update a second copy beside it.

1. **Account.** Register as an individual developer at [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com) (free for individuals; an ID check). The Store shows the developer name you register.
2. **Build.** A dry run of the release's tag builds it, signed when the Azure secrets exist: `gh workflow run release.yml --ref main -f dry_run=true -f tag=vX.Y.Z`; the run's artifacts `microsoft-store-windows-x64-nsis` and `microsoft-store-windows-arm64-nsis` hold the installers. Or locally on Windows, with the five signing variables set:

   ```sh
   TIMER_SERVER_ORIGIN=$(node scripts/release.mjs --print-origin) pnpm tauri build --config src-tauri/tauri.microsoftstore.conf.json --config src-tauri/tauri.release.windows.json
   ```

   The installer is `src-tauri/target/release/bundle/nsis/Timer App_X.Y.Z_x64-setup.exe` (add `--target aarch64-pc-windows-msvc` for Arm64; then it is under `target/aarch64-pc-windows-msvc/release/`).
3. **Host it.** Rename it so it cannot be mistaken for the regular installer, and attach it to the version's GitHub Release: `gh release upload vX.Y.Z timer-app_X.Y.Z_windows_x64_store.exe`. Its URL, `https://github.com/hotdogee/timer-app/releases/download/vX.Y.Z/timer-app_X.Y.Z_windows_x64_store.exe`, is versioned and never changes. (Not `-setup.exe`: the winget renderer picks the release's `*-setup.exe` files.)
4. **Partner Center** › Apps and games › New product › EXE or MSI app. Reserve the name (it must be free in the Store). Then fill in the submission:
   - Packages: the URL, architecture x64 (and Arm64 if built), the languages (English, Traditional Chinese, Japanese), installer parameters: silent `/S`.
   - Properties: category Productivity (or Utilities & tools); the privacy policy URL `https://timer.hanlin.uk/privacy` (required, since the app has accounts; spec Q23).
   - Age ratings questionnaire, Store listing (description, at least one screenshot, the logo), pricing Free.
   - Submit. Certification takes a few days.
5. **Each release** that should reach new Store users: build the Store installer for the version, upload it, and submit an update with the new package URL. Existing Store installs update themselves through the app's updater either way.

## When something goes wrong

- **A job failed before the release went public.** It is still a draft, invisible to users and to the updater. If the cause is outside the code (a flaky runner, a missing or expired secret, a certificate), fix it and use Re-run failed jobs, or run the workflow by hand with the tag and "Dry run" unticked (it reuses the draft). If the code must change, delete the draft and its tag (`gh release delete vX.Y.Z --cleanup-tag --yes`, then `git tag -d vX.Y.Z` locally). The pushed `Release vX.Y.Z` commit has already moved the notes out of `## Unreleased`, so on `main`, first: in `CHANGELOG.md`, move the notes of the abandoned `## vX.Y.Z` section back under `## Unreleased`, delete that section (its heading and its commit list) and commit. Then fix, and cut the next patch version: it gets the notes, and the CHANGELOG keeps no section for a version that never shipped. (Or, since vX.Y.Z was never published, keep its section and tag the fixed commit by hand: `git tag --annotate vX.Y.Z --message "Timer App vX.Y.Z"` on `main`, then `git push --atomic origin HEAD vX.Y.Z`; the version files already say X.Y.Z.)
- **A published release is broken.** Never delete or replace it: installed apps may have updated to it already, and winget and Homebrew point at its files. Cut a fixed patch release; the updater moves everyone forward.
- **`latest.json` is wrong or missing.** The publish job writes it from the signatures on the draft (a re-run rewrites only what differs); if a platform was not built at all, or a signature does not match the app's key or the version, it fails and the release stays a draft. Re-run the failed platform's job, then the publish job.
- **The winget or Homebrew job failed** (an expired token, a moderator's request): the release itself is fine. Renew the token and re-run that job, or follow its printed command by hand.
- **Verify fails on the updater key** (`pnpm version:check --updater-key`): `TAURI_SIGNING_PRIVATE_KEY` is set but `plugins.updater.pubkey` is still the placeholder. Finish [Updater key](#updater-key) step 2, or delete the two secrets to release without updates; the build would stop anyway, after bundling, with `failed to decode pubkey`.
- **The updater key is lost.** Generate a new one, put its public key in `tauri.conf.json`, update both secrets, and say in the next release's notes that this version must be downloaded and installed by hand: the installed apps cannot verify it.

## Before the first release

The pieces below are placeholders or decisions only the owner can make. Several of them are written into installed systems by the first public release (registry keys, data folders, the keychain, package ids) and must not change afterwards; settle them first.

### QA checklist for the owner

- [ ] **Final name, domain and bundle identifier (spec Q13).** Today: "Timer App", `timer-app`, `uk.hanlin.timer`, and the sync server `https://timer.hanlin.uk` (set on 2026-10-18; a placeholder domain such as `timer.example.com` stops every real release). **The bundle identifier must not change after the first public release**: it names the app's data folders (the cards and settings live in `%LOCALAPPDATA%\uk.hanlin.timer\EBWebView` on Windows, and in like places elsewhere; see README › Desktop), and to macOS, the updater and the package managers an app with another identifier is another app. The product name is in the Windows uninstall registry key, the install folder and the MSI's upgrade code, so a later rename leaves a second copy beside the first. See [Renaming](#renaming).
- [ ] **Publisher name** "Han Lin" (`bundle.publisher`, also `bundle.copyright` and `LICENSE`): Windows writes it to `HKCU\Software\Han Lin\Timer App` and Add/Remove Programs, winget's manifest repeats it, and the Store requires it to differ from the product name. It must not change after the first release either.
- [ ] **Windows signing route.** Azure Artifact Signing (about $10 a month) if you are an individual in the US or Canada, or an organization in a listed country; otherwise another certificate: for example SignPath's free signing for open-source projects (the publisher then shows as SignPath Foundation), or an OV certificate kept in a cloud HSM (SSL.com eSigner and others) whose tool replaces `signCommand`. Unsigned works, with SmartScreen warnings, and rules out the Microsoft Store. If Azure: its region, for the endpoint in `tauri.release.windows.json` (West US 2 is a placeholder).
- [ ] **Apple Developer Program** ($99 a year) for Developer ID signing and notarization, or ship ad-hoc signed builds that users allow once in Privacy & Security.
- [ ] **Linux signing**: none. The AppImage, `.deb` and `.rpm` are unsigned; updates are still checked against the updater key. AppImage GPG signing (Tauri's `SIGN` and `SIGN_KEY`) is optional and not wired into `release.yml`.
- [ ] **Protect `main`, the tags and the keys** (Settings › Rules › Rulesets, and Settings › Environments): a branch ruleset on `main` that requires a pull request and blocks force pushes, with Repository admin in its bypass list ("Always"), so your own `git push --atomic` of the release commit still goes through; a tag ruleset on `v*` that restricts creations, updates and deletions, with the same bypass, so only you can start or move a release. The desktop job's `contents: write` token reaches every npm and cargo build script, and these rules keep a compromised dependency from pushing to `main` or moving a tag with it. Then the `release` environment, limited to the branch `main` and the tag `v*`, with the signing secrets in it ([Secrets](#secrets)).
- [ ] **Updater key**: generate it, back it up, set the two secrets, put the public key in `tauri.conf.json` and update the `updater.rs` test, in one go ([Updater key](#updater-key)): the workflow stops a release that has the public key but not the private one. Without any of it the first release ships with no updates at all, and its users must reinstall by hand once. Decide on `requireSignedVersion` (recommended on; [The updater](#the-updater)).
- [ ] **winget**: the publisher and package id `Hotdogee.TimerApp` (permanent once merged), a separate bot account for `WINGET_TOKEN` ([winget](#winget) step 2), and the first submission by hand.
- [ ] **Homebrew tap**: create `hotdogee/homebrew-tap` and `HOMEBREW_TAP_TOKEN`; the cask is `timer-app` (permanent: users type it).
- [ ] **Microsoft Store**: a Partner Center account, whether to list the app at all, and the name reservation (the name must be free in the Store).
- [ ] **Cloudflare**: the account, the domain on it, the plan (Workers Free to start), the one-time setup in [deploy.md](deploy.md), the two deploy secrets (in the `production` environment, then also the variable `DEPLOY_ON_RELEASE` = `true`), and whether deploys need an approval.
- [x] **Privacy policy (spec Q23)**: done 2026-10-18. The operator (Han Lin) and the contact (hotdogee@gmail.com) are filled in, and the policy is public at `https://timer.hanlin.uk/privacy`, which every build renders from `docs/privacy.md` ([deploy.md › Privacy](deploy.md#privacy)). Give that address in the Store listing and on the Google consent screen.
- [ ] **First version number**: `pnpm release minor` makes 0.1.0 from today's 0.0.0; `pnpm release 1.0.0` is the other choice.
- [ ] **Icons (spec Q22)**: the placeholder ships in every installer, the PWA and the favicon; `pnpm icons` regenerates all of them from `public/icon.svg`. The macOS icon has no Apple-style margin yet.
- [ ] **macOS minimum** 11.0 (`bundle.macOS.minimumSystemVersion`). The web code needs Safari 16's engine (the app's webview is the system WebKit), which macOS 11 and 12 have only after a Safari update; macOS 13 ships with it, so 13.0 is the floor that cannot meet an older engine.
- [ ] **Installer details**: both Windows installers show the MIT license page; NSIS takes its language from Windows (English, Traditional Chinese or Japanese) without a selector.
- [ ] **Security reports**: Settings › Advanced Security › enable private vulnerability reporting, which the issue form's "Report a security vulnerability" link opens.
- [ ] **README**: remove "The first release is not out yet" from README › Install.

### Renaming

One commit, before the first release. `git grep -n -I -e "Timer App" -e timer-app -e timerapp -e timer.example.com` lists every place; most are text. The ones that matter:

- `src-tauri/tauri.conf.json`: `productName`, `identifier`, the main window's `title`, `bundle.shortDescription` and `longDescription`, the content security policy's `https://` and `wss://` origin, `bundle.homepage` and the updater endpoint (if the repository moves). Also `tauri.local-server.json` (the same policy) and the `-d` description in `tauri.release.windows.json`.
- `src-tauri/capabilities/default.json`: the opener's `https://<domain>/device*` and `https://<domain>/privacy*` entries (`pnpm test` fails until both match the policy), and the opener tests in `src-tauri/src/lib.rs`.
- The name the user sees: `messages/*.json` (`app_name`, the tray and hotkey labels), `index.html`'s title, the web app manifest in `vite.config.ts`, the mini window's title in `src-tauri/src/mini.rs`, the tray tooltip in `src-tauri/src/tray.rs`.
- The credential store's service name in `src-tauri/src/token_store.rs` (a rename signs desktop users out once).
- `server/wrangler.jsonc` (the route), the Worker secrets `BETTER_AUTH_URL` and `EMAIL_FROM`, and each sign-in provider's callback URLs ([deploy.md](deploy.md)).
- `packaging/` (the winget id and the cask), README and `docs/`.
- After the rename, pin the MSI's upgrade code: `pnpm tauri inspect wix-upgrade-code` prints it; put it in `bundle.windows.wix.upgradeCode`, so a later product name change cannot break MSI upgrades.

Keep the storage names (`timer-app` for IndexedDB, `timer-app-device` and the other localStorage keys, `EXPORT_APP` in `src/core/export.ts`, which marks export files): they are internal, and renaming them loses every user's data.

## Checking a dry run

The first dry run is the first time the app is built for macOS and Linux (CI builds Windows only), so it is the test of the whole matrix. These are the commands to start one from a clone and follow it, with `gh` signed in to an account that may run workflows in `hotdogee/timer-app`, and what a good run shows. Do not push a tag to try the workflow: a pushed `v*` tag is a real release.

1. **The workflow must be on `main`**: GitHub starts `workflow_dispatch` runs only for workflows on the default branch. Commit and push `release.yml` with the files it uses, let CI on that push finish green, and check that `gh workflow list --repo hotdogee/timer-app` lists Release.
2. **Start it, follow it, read it:**

   ```sh
   gh workflow run release.yml --repo hotdogee/timer-app --ref main -f dry_run=true
   sleep 15  # the new run takes a few seconds to be listed
   run=$(gh run list --repo hotdogee/timer-app --workflow release.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run watch --repo hotdogee/timer-app "$run" --exit-status
   gh run view --repo hotdogee/timer-app "$run" --verbose
   gh run view --repo hotdogee/timer-app "$run" --log-failed  # only when a job failed
   gh api "repos/hotdogee/timer-app/actions/runs/$run/artifacts" --paginate --jq '.artifacts[] | "\(.name)\t\(.size_in_bytes)"'
   gh run download --repo hotdogee/timer-app "$run" --dir ~/timer-app-dry-run --name windows-x64-nsis --name winget-manifests --name homebrew-cask
   gh release list --repo hotdogee/timer-app  # prints nothing: no release
   git ls-remote --tags origin                # prints nothing: no tag
   ```

3. **What each job should show** (the run is named `Release main (dry run)`):

   | Job | A good dry run |
   |---|---|
   | Verify | Green, with no warning once the sync server is a real domain (a placeholder such as `timer.example.com` warns on a dry run and stops a release). The summary "Release of main (dry run: nothing is published)" names the sync server and answers "no: …" for every credential not yet set. |
   | Create the draft release, Publish the release | Skipped. |
   | Desktop (×6) | Green. "Choose the build configuration" prints `tauri build --target <triple>`, plus `--config src-tauri/tauri.release.macos-adhoc.json` on macOS (and the updater and Windows signing overlays once their secrets exist). tauri-action's log lists "Found artifacts:" (the MSI and NSIS installers on Windows; the DMG and the `.app` on macOS; the `.deb`, `.rpm` and AppImage on Linux), then "uploadWorkflowArtifacts enabled" and "No releaseId or tagName provided, skipping all uploads...". |
   | Store installer (×2) | Green, each installer about 210 MB. |
   | winget | Green. "Render and validate the manifests" ends with "Manifest validation succeeded."; if "Install winget" failed instead (it may; it does not stop the job), a warning says the manifests were not validated. "Submit to winget-pkgs" is skipped. |
   | Homebrew | Green: `brew style` accepts the placeholder cask, a notice says `hotdogee/homebrew-tap` does not exist yet, and the audit and the push are skipped. |

4. **The 18 artifacts**, kept for 90 days (winget and Homebrew for 30):
   - Windows: `windows-x64-nsis`, `windows-x64-msi`, `windows-arm64-nsis`, `windows-arm64-msi`.
   - macOS: `darwin-aarch64-dmg`, `darwin-aarch64-app`, `darwin-x64-dmg`, `darwin-x64-app`.
   - Linux: `linux-amd64-deb`, `linux-x86_64-rpm`, `linux-amd64-appimage`, `linux-arm64-deb`, `linux-aarch64-rpm`, `linux-aarch64-appimage`.
   - `microsoft-store-windows-x64-nsis` and `microsoft-store-windows-arm64-nsis`.
   - `winget-manifests` (the three manifests) and `homebrew-cask` (`timer-app.rb`), both marked PLACEHOLDER, with checksums that are not real.

   Inside them the files keep Tauri's own names, with `main`'s version (0.0.0 until the first `pnpm release`): `Timer App_0.0.0_x64-setup.exe`, `Timer App_0.0.0_x64_en-US.msi`, `Timer App_0.0.0_aarch64.dmg`, `Timer App_0.0.0_amd64.AppImage`, `Timer App-0.0.0-1.x86_64.rpm` and so on. Only a real release renames them, to the `timer-app_…` names in [What a release publishes](#what-a-release-publishes). tauri-action looks for each file under the name it expects from the product name, the version and the architecture; an artifact missing from the list above means that platform's file is named otherwise, and a real release would lack the asset (and its `latest.json` entry). A local release build of Windows x64 makes a 4 MB NSIS installer and a 6 MB MSI; the AppImages are larger, since they carry GStreamer for the alarm sounds.

5. **Afterwards:** `gh release list` and `git ls-remote --tags origin` print nothing, and Actions › Deploy has no new run: nothing was published. (The repository's Deployments list shows the verify, desktop and Store jobs under `release`: that is the environment the signing secrets live in, not a deploy. The first run creates it, empty, if it does not exist yet: give it its rule and secrets as [Secrets](#secrets) says.) The run saved a Rust cache per target (keys with `release-<target>`, under Actions › Caches), which the tag's real run restores, so later builds are faster. With secrets set, repeat the dry run: the summary turns those rows to "yes", the desktop jobs pass the matching overlays, and signing problems (an expired Azure secret, a certificate without its password) show up here rather than in a release.
