# Deploying

How to put the web app and its sync server on Cloudflare. Nothing in this repository deploys by itself: this guide is the one-time setup, and then a deploy per release (by hand, or started by the release workflow once the deploy secret or the variable `DEPLOY_ON_RELEASE` is set; see [release.md](release.md)). Local development needs none of it; see [README › Sync server](../README.md#sync-server).

What runs in production is one Worker, `timer-app` (`server/`, configured in `server/wrangler.jsonc`):

- it serves the built web app (`dist/`) as static assets, and the API at the same origin (`/api/*`);
- Better Auth keeps accounts and sessions in a D1 database, `timer-app-auth`;
- each user's synced data lives in their own Durable Object (`SyncObject`, SQLite storage).

The server's routes, settings and behavior are documented in [server/README.md](../server/README.md).

## Before you start

- A Cloudflare account. The Workers Free plan is enough to start (100,000 requests a day, sync messages included; D1 writes 100,000 rows a day); see [tech-stack.md › Server](tech-stack.md#server) and [Rate limits and the free plan](#rate-limits-and-the-free-plan).
- A domain whose DNS is on that Cloudflare account, for a custom address. Sign in with Apple needs one; everything else also works on the `workers.dev` address.
- Node.js 24, pnpm 12 and `pnpm install`, as for development.
- For email codes, a [Resend](https://resend.com) account and a domain you can add DNS records to. Optional: Google, GitHub and Apple developer accounts for those sign-in buttons.

wrangler is a dependency of the server package, so run its commands from `server/`:

```sh
cd server
pnpm exec wrangler login       # opens the browser; or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler whoami
```

The root scripts (`pnpm server:migrate:remote`, `pnpm server:deploy`) run from the repository root and call the same wrangler.

## 1. Create the database

```sh
cd server
pnpm exec wrangler d1 create timer-app-auth
```

Copy the `database_id` it prints into `server/wrangler.jsonc`, in place of `REPLACE_AFTER_D1_CREATE` in the existing `DB` binding. If wrangler offers to add a binding to the config, decline: the binding is there already, only its id is missing. The id is not a secret; commit it.

Then create Better Auth's tables (`server/migrations/`), from the repository root:

```sh
pnpm server:migrate:remote
```

## 2. Choose the address

The public address is `BETTER_AUTH_URL` below. Sign-in providers call back to it, and the session cookie belongs to it, so pick it before setting up the providers; changing it later means updating each provider.

- **Custom domain** (recommended, required for Apple): add a route to `server/wrangler.jsonc`, and Cloudflare creates the DNS record and the certificate on the next deploy:

  ```jsonc
  "routes": [{ "pattern": "timer.example.com", "custom_domain": true }],
  // Optional, once the domain works: stop serving the same app on the workers.dev address too.
  "workers_dev": false,
  ```

  (A custom domain added in the dashboard, Workers & Pages › timer-app › Settings › Domains & Routes, works too, but the config file keeps it with the code.)
- **workers.dev**: the Worker is also served at `https://timer-app.<your-subdomain>.workers.dev`, with no setup.

The examples below use `https://timer.example.com`.

## 3. Set the secrets

Production settings are Worker secrets. `APP_ENV` is the exception: `wrangler.jsonc` sets it to `production`, which keeps the development-only `/__dev/otp` endpoint off. Never set it to `development` in production.

From `server/`, set each one with `pnpm exec wrangler secret put <NAME>`, which prompts for the value. The first time, before anything is deployed, wrangler asks whether to create the `timer-app` Worker: answer yes. Each `secret put` makes a new version live at once.

| Name | Required | Value |
|---|---|---|
| `BETTER_AUTH_SECRET` | yes | 32 or more random characters, e.g. the output of `openssl rand -base64 32`. Changing it signs everyone out. |
| `BETTER_AUTH_URL` | yes | The public address, e.g. `https://timer.example.com` (no path). |
| `RESEND_API_KEY` | for email codes | A Resend API key with sending access (step 4). |
| `EMAIL_FROM` | for email codes | The sender, on your verified domain: `Timer App <sign-in@timer.example.com>`. |
| `EMAIL_DAILY_LIMIT` | no | Most code emails a day (UTC) for the whole server; 100 (Resend's free plan) when unset. Raise it with the Resend plan. |
| `TRUSTED_ORIGINS` | no | More exact origins allowed to use the session cookie, comma-separated (e.g. the `workers.dev` address if people use both). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Google sign-in (step 5). |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | no | GitHub sign-in (step 5). |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | no | Apple sign-in (step 5). |

```sh
cd server
openssl rand -base64 32 | pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put BETTER_AUTH_URL
pnpm exec wrangler secret list    # names only; values are never shown again
```

A provider whose settings are incomplete is left out, and the app hides its button; `GET /api/config` lists the providers the server uses.

Set the mailer before anyone signs in. Without `RESEND_API_KEY` a production server cannot send codes: it refuses code requests at once (`503`; the app says sign-in by email is not available) and logs one warning, never a code or an address (observability is on in `wrangler.jsonc`, so the logs are kept).

## 4. Email codes (Resend)

1. In Resend, Domains › Add domain: a domain or subdomain you control (e.g. `timer.example.com`). Add the DNS records Resend shows (SPF and DKIM) to the domain's DNS, then Verify.
2. API Keys › Create API key, with sending access, restricted to that domain. Store it as `RESEND_API_KEY`.
3. Set `EMAIL_FROM` to an address on the verified domain. Without a verified domain Resend only delivers to your own account's address, from `onboarding@resend.dev`.

The email is English only for now. A code is 6 digits and expires after 10 minutes. Asking again while a code is still waiting mails the same code again, so nobody can cancel another person's code. Code emails are limited per client IP (3 a minute), per address, whoever asks (5 an hour), and for the whole server per day (`EMAIL_DAILY_LIMIT`), so a flood cannot use up the Resend quota that everyone's sign-in depends on.

## 5. Sign-in providers (optional)

Each provider calls back to `<BETTER_AUTH_URL>/api/auth/callback/<provider>`.

### Google

1. [Google Cloud Console](https://console.cloud.google.com/): create or pick a project. Google Auth Platform › Branding: app name, support email, the domain under Authorized domains. Audience: External; publish the app when ready (in Testing only listed test users can sign in). Data access: the `openid`, `email` and `profile` scopes.
2. Clients › Create client › Web application. Authorized JavaScript origins: `https://timer.example.com`. Authorized redirect URIs: `https://timer.example.com/api/auth/callback/google`.
3. Store the client ID and secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### GitHub

1. GitHub › Settings › Developer settings › OAuth Apps › New OAuth App (an OAuth App, not a GitHub App). Homepage URL: `https://timer.example.com`. Authorization callback URL: `https://timer.example.com/api/auth/callback/github`.
2. Generate a client secret. Store the client ID and the secret as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

### Apple

Needs the Apple Developer Program and the HTTPS custom domain: Apple rejects `localhost` and plain HTTP return URLs.

1. Certificates, Identifiers & Profiles › Identifiers: an App ID with Sign in with Apple enabled, then a Services ID (e.g. `com.example.timer.web`). That Services ID is `APPLE_CLIENT_ID`.
2. Configure the Services ID's Sign in with Apple: the App ID as primary, `timer.example.com` as a domain, and `https://timer.example.com/api/auth/callback/apple` as a return URL.
3. Keys › create a key with Sign in with Apple, for that App ID. Download the `.p8` file (only once) and note the Key ID (`APPLE_KEY_ID`). Your Team ID (Membership details, or the top right of the developer site) is `APPLE_TEAM_ID`.
4. Store the key itself; piping the file keeps its line breaks:

   ```sh
   pnpm exec wrangler secret put APPLE_PRIVATE_KEY < AuthKey_ABC123DEFG.p8
   ```

The server signs Apple's client secret from these (ES256, valid 180 days, renewed as the Worker restarts) and trusts `https://appleid.apple.com` for Apple's callback. A key it cannot use turns Apple off with an error in the logs; the other sign-in methods keep working.

## 6. Build and deploy

From the repository root:

```sh
pnpm test:server                 # the Worker tests (local D1 and Durable Objects)
pnpm build                       # the web app, into dist/
pnpm server:deploy               # wrangler deploy: the Worker plus dist/ as its static assets
```

The first deploy also creates the `SyncObject` Durable Object class (migration `v1` in `wrangler.jsonc`). `pnpm --filter @timer-app/server exec wrangler deploy --dry-run --outdir ../.wrangler-dry` checks the bundle without uploading anything (delete `.wrangler-dry/` afterwards). The Worker is minified with source maps uploaded (`minify`, `upload_source_maps`), so stack traces in the logs stay readable: the dry run reports about 940 KiB (260 KiB gzip) to upload, against 2.2 MB unminified.

The static assets carry `public/_headers`: no page of the app may be framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), which keeps another site, or a sibling subdomain, from overlaying the device approval page to trick a click on Approve. Once the custom domain works on HTTPS, also turn on HSTS for it (SSL/TLS › Edge Certificates › HTTP Strict Transport Security).

## 7. Smoke checks

```sh
curl -i https://timer.example.com/api/time       # 200 {"now":…}, Cache-Control: no-store
curl https://timer.example.com/api/config        # {"providers":[…],"appEnv":"production"}
curl -i https://timer.example.com/__dev/otp      # 404: development only
curl -i https://timer.example.com/api/sync       # 426: needs a WebSocket upgrade
curl -i https://timer.example.com/api/export     # 401: needs a session
curl -I https://timer.example.com/device         # 200 with X-Frame-Options: DENY
```

Then in a browser:

1. Open the app. It works signed out, as before.
2. Settings › Account: sign in with an email code (the email arrives from `EMAIL_FROM`), and with each configured provider. The cloud next to ⚙ shows Synced.
3. Sign in on a second device or browser: the cards of both appear on both, and a timer started on one runs on the other within about a second. Let one ring and dismiss it on the other.
4. Settings › Account › Download server copy returns the synced data. Delete account removes it (the cards stay on the device).

`pnpm exec wrangler tail` (from `server/`) streams the Worker's logs; the dashboard keeps them too (observability).

## Rate limits and the free plan

Better Auth limits every auth endpoint per client IP (`CF-Connecting-IP`): 60 requests a minute per endpoint by default, less for the code, sign-in and device endpoints (see [server/README.md](../server/README.md)). It keeps those counters in D1, so every request it lets through writes a row, and one client hammering the API could use up the Workers Free plan's 100,000 rows written a day, after which sign-in fails for everyone until the next day. In front of that, add one Cloudflare rate-limiting rule (the Free plan includes one), which stops a flood before it reaches the Worker:

1. Dashboard › the domain › Security › WAF › Rate limiting rules › Create rule.
2. If incoming requests match: URI Path starts with `/api/auth/`.
3. Same characteristics: IP. When the rate exceeds 20 requests per 10 seconds (on the Free plan the period is 10 seconds), Block for 10 seconds.

The rule only applies to the custom domain, not to the `workers.dev` address: turn that off (`"workers_dev": false`) once the domain works. On the Workers Paid plan the D1 allowance is 50 million rows a month and the rule is a safety net rather than a necessity.

## Deploying from GitHub Actions

`.github/workflows/deploy.yml` runs on `main` only, started by hand (Actions › Deploy › Run workflow) or by the release workflow once it has published a release ([release.md](release.md)). Its input `ref` picks what to deploy: empty is the head of `main`; a release tag `vX.Y.Z` (the release passes its own) is checked out and must be on `main`. The release starts it when the repository secret `CLOUDFLARE_API_TOKEN` exists or the repository variable `DEPLOY_ON_RELEASE` is `true`, which is needed when the secrets live in the `production` environment below, since the release workflow cannot see those. It installs, runs the Worker tests, builds the web app, applies new D1 migrations (`pnpm server:migrate:remote`) and deploys (`pnpm server:deploy`). The Worker's secrets stay as set in step 3; the workflow does not touch them.

The job runs in the `production` environment (Settings › Environments, created on the first run). Put the two secrets there, rather than as repository secrets, and add a required reviewer to have every deploy approved. Only the migrate and deploy steps see them: installing, testing and building run without the token. The actions are pinned to commits.

It needs two secrets (the `production` environment's, or the repository's under Settings › Secrets and variables › Actions):

- `CLOUDFLARE_ACCOUNT_ID`: from the dashboard (Workers & Pages overview, or the URL).
- `CLOUDFLARE_API_TOKEN`: My Profile › API Tokens › Create Token › the "Edit Cloudflare Workers" template, plus Account › D1 › Edit (for the migrations). With a custom domain in `wrangler.jsonc`, include that domain's zone in the template's zone resources.

The workflow deploys the head of `main`, or the release tag given as `ref`, with the `database_id` and routes committed in `wrangler.jsonc`.

## Later releases

- Deploy with the workflow, or run step 6 again. A deploy closes every open sync connection; the apps reconnect by themselves (backoff from about a second up to 30 seconds).
- Database changes: add a numbered migration (`server/migrations/0003_….sql`; see [server/README.md › Schema changes](../server/README.md#schema-changes)) and apply it with `pnpm server:migrate:remote` before deploying the code that needs it. The workflow does both, in that order.
- Renaming or removing the Durable Object class needs a new migration entry (tag `v2`, …) in `wrangler.jsonc`; never edit `v1`.
- `compatibility_date` in `wrangler.jsonc` is pinned to the newest date the installed workerd runtime supports. After upgrading wrangler, move it forward and run `pnpm server:types` (and `pnpm check`).
- To go back: `pnpm exec wrangler rollback` (from `server/`) restores the previous Worker version. It does not undo D1 migrations, so keep migrations backward compatible.

## Privacy

[docs/privacy.md](privacy.md) is a draft. Before the first public release, fill in the operator and contact placeholders, have it reviewed, and publish it on the app's own site; Settings › About and Settings › Account link to it on GitHub until then. The server stores only what sync and sign-in need, and deleting an account deletes both; see the policy for the details, including what Better Auth keeps with each session.
