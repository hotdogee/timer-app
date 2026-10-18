# Timer App server

A Cloudflare Worker that serves the web app (`../dist`) and its API at one origin: Better Auth on
D1 (email codes, Google, GitHub, Apple, bearer tokens, device sign-in) and TinyBase sync relayed
through one Durable Object per user. Everything runs locally with `wrangler dev`; no Cloudflare
account is needed until you deploy (see `docs/deploy.md`).

## Local development

```sh
cp server/.dev.vars.example server/.dev.vars   # optional: local settings (gitignored)
pnpm build                                     # wrangler dev serves ../dist, so it must exist
pnpm server:migrate                            # apply migrations/ to the local D1
pnpm server:dev                                # http://127.0.0.1:8787
pnpm dev                                       # the app at http://localhost:5173 (proxies /api, /__dev)
```

Without `.dev.vars`, start it with the example's values:
`pnpm --filter @timer-app/server exec wrangler dev --port 8787 --env-file .dev.vars.example`
(`--var BETTER_AUTH_URL:http://localhost:8787` when you open wrangler's own port instead of Vite).
Local D1 and Durable Object data live in `server/.wrangler/state`; delete it for a fresh start.

| Command (from the repo root)  | What it does                                                           |
| ----------------------------- | ---------------------------------------------------------------------- |
| `pnpm server:dev`             | `wrangler dev --port 8787`                                             |
| `pnpm server:migrate`         | Apply `migrations/` to the local D1 (`server:migrate:remote`: prod.)   |
| `pnpm test:server`            | Worker tests in workerd (Vitest + `@cloudflare/vitest-plugin`)         |
| `pnpm server:types`           | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |
| `pnpm server:deploy`          | `wrangler deploy` (see `docs/deploy.md`)                               |
| `pnpm --filter … auth:schema` | Regenerate `migrations/0001_auth.sql` with the Better Auth CLI         |

## Source

| File                  | Role                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `src/index.ts`        | Worker entry and routing; re-exports `SyncObject`                                  |
| `src/auth.ts`         | `createAuth(env)` (cached per `env`), `authenticate(request, env)`, provider setup |
| `src/auth-options.ts` | The Better Auth options, shared by the Worker and the schema generator             |
| `src/auth-schema.ts`  | Config for `auth generate` (same options on an in-memory SQLite); never imported   |
| `src/sync-object.ts`  | `SyncObject` Durable Object (TinyBase `WsServerDurableObject`), its name and stub  |
| `src/mail.ts`         | The sign-in code mailer (Resend, or the console plus the development code store)   |
| `src/send-limit.ts`   | Limits on code emails per address and per day, on D1 (`sendLimit`)                 |
| `src/apple.ts`        | Signs Apple's client secret (ES256 JWT) with `jose`                                |
| `src/config.ts`       | Reading settings: optional values, `APP_ENV`, trusted origins                      |
| `src/http.ts`         | JSON and error responses, API security headers                                     |
| `src/protocol.ts`     | The client contract; byte-for-byte copy of `src/sync/protocol.ts` (a test checks)  |
| `src/env.d.ts`        | Types for the optional settings (`wrangler types` only sees the uncommented ones)  |
| `migrations/`         | D1 migrations: `0001_auth.sql` (Better Auth CLI output), `0002_send_limits.sql`    |
| `test/`               | Worker tests: real D1 with migrations, real Durable Objects, real Better Auth      |

## Settings

Locally in `.dev.vars` (copy `.dev.vars.example`), in production as Worker secrets
(`wrangler secret put NAME`). A missing or blank optional value means "not configured".

| Name                                                                    | Required | Meaning                                                                                                     |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                               | no       | `development` turns on `/__dev/otp` and the in-memory code store; anything else (the default) is production |
| `BETTER_AUTH_SECRET`                                                    | yes      | Signing secret, 32+ random characters                                                                       |
| `BETTER_AUTH_URL`                                                       | yes      | The public origin the browser uses (`http://localhost:5173` with Vite); OAuth callbacks hang off it         |
| `TRUSTED_ORIGINS`                                                       | no       | More exact origins allowed to use the session cookie, comma-separated                                       |
| `RESEND_API_KEY`, `EMAIL_FROM`                                          | no       | Mail codes through Resend. Without a key: in development the code is logged; in production requests get 503 |
| `EMAIL_DAILY_LIMIT`                                                     | no       | Most code emails a day (UTC) with Resend; 100 (the free plan) by default                                    |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                              | no       | Google sign-in, both needed                                                                                 |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                              | no       | GitHub sign-in, both needed                                                                                 |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | no       | Apple sign-in, all four; the key may be one line with `\n`. An unusable key turns Apple off (logged)        |

Bindings (`wrangler.jsonc`): `DB` (D1 `timer-app-auth`), `SYNC` (Durable Object `SyncObject`),
`ASSETS` (`../dist`, SPA fallback; only `/api/*` and `/__dev/*` run the Worker).

## API

Paths and JSON types are in `src/protocol.ts`. Every response of ours is JSON with
`Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`
(Better Auth's responses get the last two). Errors are `{ "error": code }` with code
`unauthorized` (401), `upgrade-required` (426), `not-found` (404) or `bad-request` (400, and 405
with `Allow: GET` for a wrong method). Unknown `/api/*` and `/__dev/*` paths are a JSON 404; other
paths go to the static assets.

| Route                   | Answer                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/*`           | Better Auth (below)                                                                                                               |
| `GET /api/time`         | `200 { now }`: server epoch ms                                                                                                    |
| `GET /api/config`       | `200 { providers, appEnv }`: the usable OAuth providers in `google, github, apple` order                                          |
| `GET /api/sync`         | WebSocket (below): `101`, or `426` without `Upgrade: websocket`, `400` if subprotocols lack `timer-sync`; no session: closes 4401 |
| `GET /api/export`       | `200` `ServerExport` (`{ app, kind: 'server-copy', format: 1, exportedAt, tables, values }`) as an attachment, or `401`           |
| `GET /__dev/otp?email=` | Development only: `200 { otp }` (last code for that address), `400` without `email`, `404` if none; `404` outside development     |

Sessions: the web app uses the `timer.session_token` cookie (HttpOnly, SameSite=Lax, 30 days,
refreshed daily; `__Secure-` prefixed on HTTPS); every successful sign-in also returns the token in
the `set-auth-token` header for clients that send `Authorization: Bearer <token>` (the desktop
app). `/api/sync` and `/api/export` always read the session from D1, so sign-out and account
deletion take effect at once.

Better Auth endpoints the app uses, with the `better-auth/client` call in brackets (client:
`createAuthClient` with the `emailOTPClient()` and `deviceAuthorizationClient()` plugins):

- `POST /api/auth/email-otp/send-verification-otp` with `{ email, type: 'sign-in' }` gives
  `{ success: true }` (`emailOtp.sendVerificationOtp`). It succeeds for any valid address, so it
  reveals nothing about accounts. A code waiting to be used is mailed again (not replaced), with
  its wrong-attempt count, so nobody can kill another person's code by asking for a new one; D1
  keeps it encrypted with the auth secret. Limits (`429` with `X-Retry-After`): 3 per minute per
  client IP; 5 per hour per address, whoever asks (code `TOO_MANY_CODE_EMAILS`). With Resend, at
  most `EMAIL_DAILY_LIMIT` a day for the whole server, then `503` with `EMAIL_UNAVAILABLE`, which
  a production server without a mailer answers at once.
- `POST /api/auth/sign-in/email-otp` with `{ email, otp }` gives `{ token, user }` and the cookies
  (`signIn.emailOtp`); the first sign-in creates the account. Errors: `400` with code
  `INVALID_OTP` (wrong code), `403` with `TOO_MANY_ATTEMPTS` (after 5 wrong codes the code is
  dead; request a new one), `400` with `OTP_EXPIRED` (after 10 minutes). At most 10 per minute
  per client IP.
- `POST /api/auth/sign-in/social` with `{ provider, callbackURL }` gives `{ url, redirect }`
  (`signIn.social`); the provider calls back at `/api/auth/callback/<provider>`. A callback that
  cannot be matched to a sign-in (an expired or unknown state) goes to `<BETTER_AUTH_URL>/?error=…`,
  where the app shows its own message, not to Better Auth's error page.
- `GET /api/auth/get-session` (`getSession`) and `POST /api/auth/sign-out` (`signOut`).
- `POST /api/auth/delete-user` with `{}` gives `{ success: true, message: 'User deleted' }`
  (`deleteUser`). It wipes the user's Durable Object (closing every sync socket with code 4401,
  reason `account deleted`), then deletes the user, sessions, accounts, device codes, pending
  codes and the address's code-email counter. The session must be less than a day old, else `400` with `SESSION_EXPIRED`: sign in
  again first.
- Device sign-in for the desktop app:
  1. The app calls `POST /api/auth/device/code` with `{ client_id: 'timer-app-desktop' }` and
     gets `device_code`, `user_code`, `verification_uri` (`<BETTER_AUTH_URL>/device`),
     `verification_uri_complete` (the same with `?user_code=`), `expires_in` (900 s) and
     `interval` (5 s). Other client ids get `400 invalid_client`. At most 5 a minute per
     client IP.
  2. It opens the page in the browser and polls `POST /api/auth/device/token` with
     `{ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code, client_id }`.
     Until approval that is `400` with `error` set to `authorization_pending` (or `slow_down`,
     `expired_token`, `access_denied`); then `{ access_token, token_type: 'Bearer' }`.
  3. The `/device` page, signed in, first opens the code with
     `GET /api/auth/device?user_code=…` (`device({ query: { user_code } })`), which claims it for
     the user, then calls `POST /api/auth/device/approve` or `/device/deny` with `{ userCode }`
     (`device.approve`, `device.deny`). Approving an unclaimed code fails with `400`. Claims
     are limited to 10 a minute per client IP (the plugin alone would allow 5 per 15 minutes).

Every other auth endpoint allows 60 requests a minute per client IP and path. Each allowed
request writes a D1 row (the limits are kept in D1, shared by every isolate), so a deployment on
the free plan adds a Cloudflare rate-limiting rule in front (`docs/deploy.md`).

Cookie-carrying POSTs must come from a trusted origin (`BETTER_AUTH_URL`'s, `TRUSTED_ORIGINS`, and
`https://appleid.apple.com` when Apple is on), else `403`. Password, password-reset and
email-change endpoints are off.

### Connecting the sync socket

1. URL: `ws(s)://<api origin>/api/sync` (on the web, the page's own origin; Vite proxies it in
   development). Nothing else in the path; the server picks the object from the session.
2. Subprotocols: `syncSubprotocols(token)` from `protocol.ts`, that is `['timer-sync']` for the
   web app (the session cookie goes along by itself), or `['timer-sync', 'timer-auth.<token>']`
   with the token percent-encoded, for a client with a bearer token. The server answers
   `Sec-WebSocket-Protocol: timer-sync` (never the token). The token is never read from the URL:
   Workers Logs record every URL. An explicit token wins over a cookie.
3. Credentials: the cookie only counts when the handshake's `Origin` is trusted (or absent, for
   non-browser clients), which blocks cross-site WebSocket hijacking.
4. Run TinyBase's `createWsSynchronizer(mergeableStore, socket, SYNC_REQUEST_TIMEOUT_SECONDS)`
   and `startSync()`. Reconnect with backoff on close; the synchronizer re-syncs everything after
   reconnecting.
5. A socket closed with `SYNC_CLOSE_UNAUTHORIZED` (4401) had no valid session: none was sent,
   it was signed out or revoked, it expired, or the account was deleted (the reason says which).
   Browsers hide an HTTP status on a failed handshake, so an upgrade without a session is
   accepted and closed at once with this code. Check the session (`get-session` with
   `disableCookieCache=true`, since the session cookie's 5-minute cache would still vouch for a
   deleted session) and sign out if it is gone.
6. Heartbeat: send the text `ping` (every 30 s, and when the page becomes visible or the network
   comes back); the server answers `pong` without waking the object. No answer within 10 s means
   the connection is dead although the socket reads open: reconnect.

The server never closes idle sockets (they hibernate). It closes a socket with 4401 when its
session is deleted (sign-out, `revoke-other-sessions` and the like), when the session has
expired (checked at its next message), and when the account is deleted. Both ends wait
`SYNC_REQUEST_TIMEOUT_SECONDS` (10 s) for an answer to each request, so a slow link still
uploads a device's offline changes. An object started without any socket (by an RPC call) waits
that long for peers before it takes in changes, which only delays them.

## The sync Durable Object

`SyncObject` (named `user:<userId>`, reached at path `/user/<userId>`) extends TinyBase's
`WsServerDurableObject`: sockets use the Hibernation API, and the server's `MergeableStore` is
persisted to the object's SQLite storage (table `timer_app`, JSON mode) on every change. RPC
methods, called by the Worker only:

- `exportContent(): { tables, values }`: the store as `store.getContent()` returns it.
- `closeSession(sessionId): void`: closes the sockets opened with that session (4401).
- `wipe(): void`: stops saving, closes every socket, empties the store and deletes all storage.

The Worker forwards each upgrade with the session's id and expiry in headers it sets itself
(`X-Timer-Session-Id`, `X-Timer-Session-Expires`); the object keeps them on the socket with
`serializeAttachment`, which survives hibernation.

## Tests

`pnpm test:server` runs `test/**/*.test.ts` inside workerd with the bindings from
`wrangler.jsonc`, the migrations applied by `test/apply-migrations.ts`, and the settings pinned in
`vitest.config.ts` (a developer's `.dev.vars` never leaks in). Storage persists between tests of a
file and is isolated between files. `test/helpers.ts` signs in through the real email-code flow
(`/__dev/otp`) and syncs real TinyBase stores over the socket.

The tests did not reproduce a hang that `wrangler dev` showed: work one request leaves pending
(a cached promise doing D1 I/O) and a later request awaits. Run `wrangler dev` and use the API with curl or the app after
changing how anything is cached per isolate (see `validateSchema: false` in `auth-options.ts`).

## Schema changes

The schema is whatever the options in `auth-options.ts` imply. After changing plugins or options,
run `pnpm --filter @timer-app/server auth:schema` and diff `migrations/0001_auth.sql`: the CLI
writes the full schema for an empty database, so turn the difference into a new numbered
migration (`0003_….sql`) instead of editing `0001`. `0002_send_limits.sql` is the app's own
table, not Better Auth's, so the CLI's output never contains it.
