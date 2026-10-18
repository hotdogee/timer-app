# Privacy policy

**Draft**, last updated 2026-10-18. Not yet in force: before the first public release, fill in the
operator and contact placeholders (`[…]`), have it reviewed, and publish it on the app's own site.
Settings › About and Settings › Account link to this file.

Timer App is a timer and stopwatch. It is built to need as little of your data as possible: you
can use all of it without an account, and nothing leaves your device unless you sign in to sync.

## Without an account

Everything stays on your device, in your browser's storage (or the desktop app's):

- your cards (timers and stopwatches, their names, durations and whether they are running), your
  presets and your settings;
- your appearance settings and language.

We receive none of it. There are no analytics, no ads and no trackers. Loading the app fetches it
from our server like any website, and the hosting provider sees the request (see
[Logs](#logs)).

## With an account

Signing in turns on sync: your devices exchange your data through our server so they all show the
same cards. Signing in is optional, and you can sign out or delete the account at any time.

### What we store

**Your account**

- Your email address.
- Your name and profile picture address, if you sign in with Google, GitHub or Apple and that
  service shares them. Signing in with an emailed code stores no name or picture.
- Which sign-in services you used, with the identifier and access tokens that service gave us for
  you.
- Your sessions: one per signed-in device, with when it started and expires, and the IP address
  and browser description (user agent) it signed in from, so the sessions can be checked.

**Your synced data**

- Your cards, including their names, durations, state and timestamps.
- Your presets.
- Your behavior settings (time format, sounds, alarms, shortcuts and the like).

Appearance settings and the language stay on each device and are never uploaded.

**Short-lived records**

- Sign-in codes: each code encrypted, with the email address it was sent to. A code works for
  10 minutes and is removed once used.
- How many sign-in codes were sent to an address in the last hour, kept under a one-way hash of
  the address (not the address itself), so nobody can flood an inbox with codes. Removed after
  two days, or with the account.
- Desktop sign-in requests (the code you approve on the device page), which work for 15 minutes.
- Rate-limit counters, which stop anyone from guessing codes or flooding the server: per IP
  address and kind of request, the number of recent requests and the time of the last one. A
  count of all code emails sent each day, which holds no personal data.

We do not store passwords: there are none.

### Where it is stored and who processes it

- **Cloudflare** runs our server (Cloudflare Workers) and stores your account (Cloudflare D1) and
  your synced data (a Cloudflare Durable Object that only your account can reach). Cloudflare
  may store and process it in data centers in several countries.
- **Resend** sends the emails with your sign-in codes, so it receives your email address and the
  code.
- **Google, GitHub and Apple**, if you choose to sign in with one of them: you sign in on their
  site, and they learn that you signed in to Timer App. Their own privacy policies apply there.

Nobody else receives your data. We do not sell it, share it for advertising or use it for anything
but running the app.

### Cookies and local storage

- With an account, the browser keeps a session cookie for our site (first-party, HTTP-only, so
  page scripts cannot read it) and a short-lived copy of the session (at most 5 minutes) to save
  a server check on every request. They exist only to keep you signed in.
- Your device settings and the account you last signed in with are kept in the browser's local
  storage, so the app starts in the right theme and language and shows your account offline.

There are no tracking or third-party cookies.

## How long we keep it

- Your account and synced data: until you delete the account.
- Sessions: a session ends when you sign out, or after 30 days without using the app on that
  device.
- Sign-in codes and desktop sign-in requests stop working after minutes, as above; leftover
  records are removed with the account.
- Rate-limit counters hold no account data and only count the last minutes' requests; the
  code-email counters are removed after two days.

## Deleting your data

**Settings › Account › Delete account** deletes, at once and for good, your account, its sessions
and sign-in methods, its sign-in codes, code-email counter and desktop sign-in requests, and the server's copy of your
cards, presets and settings. For your security, deleting needs a recent sign-in: if you signed in
more than a day ago, sign out and in again first. Your other devices
stop syncing. The cards on each of your devices stay there, and the app keeps working without an
account; remove them from a device by deleting the cards or clearing the site's data.

The database keeps a rolling point-in-time backup for disaster recovery, so deleted account
records can remain in that backup for up to 30 days before they are gone everywhere.

## Getting a copy of your data

- **Settings › Data › Export** saves your cards, presets and settings from this device as a JSON
  file.
- **Settings › Account › Download server copy** saves your synced data exactly as the server
  stores it.

To see what your account record holds, or to have it corrected or deleted without signing in,
write to us (below).

## Logs

Like any website, our hosting provider records requests to the server for a short time (which
page or endpoint, when, from which IP address and browser) to keep the service running and
secure. Sign-in tokens and codes are never written to these logs: the app never sends a token
in a web address, and the server never logs a code.

## Security

All traffic is encrypted (HTTPS). Sessions are random tokens in HTTP-only cookies; signing out
on a device, or ending a session, disconnects that device from sync at once. Sign-in codes expire
quickly, allow few attempts and are stored encrypted; each account's synced data lives in its
own store that only that account's sessions can open.

## Children

Timer App is not directed at children under 13, and we do not knowingly create accounts for them.

## Changes

We will update this page when what we collect or how we use it changes, and say so in the app's
release notes. The date at the top shows the last change.

## Contact

[Operator name], [postal address]
[contact email]
