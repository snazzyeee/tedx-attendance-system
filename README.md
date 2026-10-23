# TEDxDYPDPU Attendance Management System

A Next.js 16 + TypeScript app for marking TEDxDYPDPU team attendance, with Google
Sheets as the database.

The whole system is built around two rules:

> **Every TE can manage attendance — but only for their own domain,**
> **and only between 3 PM and 4 PM IST.**

Both are enforced in the backend, on the session's identity and the *server's*
clock — never as a UI restriction. A Curation TE who forges a request naming a
Marketing member gets a `403` and the sheet is not touched; so does one who tries
to file marks under yesterday's date, or to save at 9 PM. Core Members are exempt
from the clock and can open a 15-minute override for everyone else.

- **Stack:** Next.js 16.3.4 (App Router, Turbopack), React 19, TypeScript, vanilla
  CSS + CSS Modules (no Tailwind), `googleapis`, `jose`, `bcryptjs`.
- **Routes:** `/login`, `/` (attendance), `/analytics`, `/change-password`.

This is the public copy of the project: the committee's own code, shipping a
**placeholder roster** in `src/config/members.ts` and `CHANGE_ME_*` bootstrap
passwords in `src/config/auth.ts` in place of the deployed values. Put your own
in and it runs — §7 and §8 cover both.

This file is the manual: install, configure, deploy, and how each rule is
enforced. Two companion documents cover the rest — [ABOUT.md](ABOUT.md) for what
problem this solves and why it is built this way, and
[handover.md](handover.md) for the engineering log: judgement calls, what the
review pass found, and what to pick up next.

---

## 1. How to install

Requires **Node 20.9+** (Next 16's own floor). **Node 23.6+** additionally lets
`npm test` run the TypeScript test files directly, with no build step and no test
dependency — on an older Node the app still builds and runs, but the test command
will not.

```bash
git clone <repository-url>
cd ted-attendance
npm install
```

Then create `.env.local` (see §2) and run:

```bash
npm run dev
```

Open <http://localhost:3000>. You will be redirected to `/login`.

Available scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build, including a full TypeScript check |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (`eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Offline unit tests — no credentials, no network |

## 2. Environment variables

Create `.env.local` in the project root:

```env
GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_CLIENT_EMAIL=your_service_account_email@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour_private_key...\n-----END PRIVATE KEY-----\n"
SESSION_SECRET=a_secure_random_string_at_least_32_characters_long
```

| Variable | Notes |
|---|---|
| `GOOGLE_SHEET_ID` | The `/d/<THIS_PART>/edit` segment of the sheet URL. |
| `GOOGLE_CLIENT_EMAIL` | Service-account email from the downloaded JSON key. |
| `GOOGLE_PRIVATE_KEY` | The `private_key` field, **in double quotes with `\n` escapes kept literal**. The app converts `\n` back to real newlines at startup. |
| `SESSION_SECRET` | HMAC key for the session JWT. Generate with `openssl rand -base64 32`. |

`SESSION_SECRET` is **required in production**: the app throws at startup if it
is missing when `NODE_ENV=production`, because a predictable fallback would let
anyone forge a session cookie for any domain. In development it falls back to a
clearly-labelled insecure constant so a fresh clone runs without setup.

A missing `GOOGLE_*` variable produces a clear `503` with an actionable message
rather than an opaque crash.

Never commit `.env.local` — it is already in `.gitignore`.

## 3. Google Cloud setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (e.g. *TEDx Attendance*).
3. Note the project name — you will create the service account inside it.

No billing account is needed; the Sheets API free quota is far above this app's
usage (see §12).

## 4. Google Sheets API setup

1. In your project, go to **APIs & Services → Library**.
2. Search for **Google Sheets API** and click **Enable**.

Only the Sheets API is required. The app does not use Drive, OAuth consent
screens, or any interactive Google sign-in.

## 5. Service account / permissions

1. **APIs & Services → Credentials → Create credentials → Service account**.
2. Name it (e.g. `sheets-editor`). No project roles are needed — access is granted
   per-sheet in step 5.
3. Open the service account → **Keys → Add key → Create new key → JSON**, and
   download it.
4. Copy `client_email` into `GOOGLE_CLIENT_EMAIL` and `private_key` into
   `GOOGLE_PRIVATE_KEY`.
5. Open your Google Sheet, click **Share**, paste the `client_email`, and grant
   **Editor**. This step is the one most often missed: without it every request
   fails and the app reports that Google rejected the service account, telling you
   to confirm the sheet is shared with `GOOGLE_CLIENT_EMAIL` as Editor.

Keep the JSON key out of the repository. Treat it as a password.

## 6. Sheet format

The app uses two worksheets in the spreadsheet named by `GOOGLE_SHEET_ID`.
**Create both tabs manually before first use** — the Sheets values API can write
*into* a tab but cannot create one, so a missing tab is reported as a
configuration error rather than silently fixed.

**`Attendance`**

| | A | B | C | D | … |
|---|---|---|---|---|---|
| **1** | Member Name | Domain | `01/09/2026` | `02/09/2026` | … |
| **2** | Curation TE 1 | Curation | Present | Absent | |
| **3** | Curation SE 1 | Curation | Absent | Present | |

- Column **A** = member name, column **B** = domain, column **C onwards** = one
  column per date, `DD/MM/YYYY`, in **IST** (`Asia/Kolkata`).
- The header row and the member rows are seeded automatically, in the order
  configured in `src/config/members.ts`, the first time attendance is saved into
  an empty sheet.
- A new date column is appended automatically on the first save of a new day, and
  reused for every later save that day — never duplicated.
- Only the exact text `Present` counts as present (casing and surrounding spaces
  are tolerated). Empty, missing, or unrecognised cells read as `Absent`, so a
  brand-new column shows everyone absent rather than blank.

**`Passwords`**

| | A | B |
|---|---|---|
| **1** | Username | HashedPassword |
| **2** | Curation TE 1 | `$2b$10$…` |
| **3** | `__override_end__` | `1789199838554` |

- Written by `/change-password`. Column B holds a bcrypt hash, never a plaintext
  password.
- To reset someone to their domain's initial password, delete their row.
- The reserved row `__override_end__` is **not** a credential: it is when the
  Core Members' override window expires, in epoch milliseconds (`0` = closed). It
  shares this tab because the tab already exists and already has a write path.
  The password parser filters the row out, so it can never be read as somebody's
  hash. Leave it alone unless you want to force the window shut, which you can
  also do from the dashboard.

**`Audit Log`** — optional.

| | A | B | C | D | E |
|---|---|---|---|---|---|
| **1** | Timestamp (ISO) | Marked by | Member | State | Date |

- Appended to after every save, one row per mark.
- **Optional by design**: if the tab does not exist, the attendance write still
  succeeds and the UI says the save was not logged. The mark is the product; the
  log is the receipt, and losing the receipt must not lose the mark.

You may add extra tabs of your own; the app reads only these three.

## 7. How to configure TE/SE members

The roster shipped here is a sample — `Curation TE 1`, `Marketing SE 2` and so
on — with the same shape as the committee's real one, so the app, the tests and
analytics all behave as they do in production.

Edit **`src/config/members.ts`** — the single source of truth for who exists. The
login dropdown, attendance list, analytics, and the backend authorization check
all read from it. Nothing reads member names out of the sheet, and no component
hardcodes them.

```ts
export const MEMBERS: Member[] = [
  { name: "Curation TE 1", domain: "Curation", role: "TE" },
  { name: "Curation SE 1", domain: "Curation", role: "SE" },
  // …
  { name: "Core Member 1", domain: "Core", role: "Core Member" },
];
```

Rules, all documented in the file itself:

- **At least one `role: "TE"` per domain.** Only TEs and Core Members can log in,
  so a domain with no TE has no way in. Several TEs per domain is fine and is
  what the committee's own roster does — but see the caveat below.
- **`domain` must be one of the values in `src/config/domains.ts`**, or `Core`.
  The `Domain` type turns a typo into a compile error rather than a member who
  never appears.
- **Order matters** (TEs first, then SEs, domains in `DOMAINS` order): it is the
  order rows are seeded in and the order every screen renders in.
- **`Core` is deliberately absent from `DOMAINS`.** Core Members administer the
  other domains and have no attendance of their own to mark, so `Core` never
  appears in a domain picker and cannot be written to.

> **Caveat — a shared bootstrap password.** `INITIAL_PASSWORDS` is keyed by
> *domain*, not by person, so every TE in a domain starts with the same password
> and any of them can sign in as any other until each sets their own at
> `/change-password`. With one TE per domain that was invisible; with six, it is
> worth doing on day one.

## 8. How to configure initial passwords

Edit **`src/config/auth.ts`**:

```ts
export const INITIAL_PASSWORDS: Record<Domain, string> = {
  Curation: "CHANGE_ME_Curation",
  // …
};
```

One bootstrap password per domain — shared by every TE in that domain, which is
why each of them should set their own on day one. They are plaintext by design:
first-login credentials, not stored secrets. As soon as a TE changes their
password at `/change-password`, a bcrypt hash is written to the `Passwords`
worksheet under their name and takes precedence; the value in this file stops
working for them.

**Change these from the defaults before deploying**, and ask every TE to set
their own password on day one. Editing a value here does not revoke a password
already changed in the sheet — delete that row to reset someone.

This repository is public, so whatever sits in `auth.ts` is readable by anyone:
treat the committed values as a template, not as credentials, and pick your own
before the first deploy. Nothing that is actually a secret belongs in this file —
the Google service-account key and `SESSION_SECRET` are environment variables
(§2) and are not tracked.

## 9. How authentication works

**Login** (`POST /api/auth/login`)

1. The payload is shape-validated (`src/lib/validation/`).
2. The rate limiter is consulted (§12 below).
3. The member is looked up **by name only** in `MEMBERS`; their **domain and role
   come from that roster entry**, never from the request body. A client cannot
   pair a real name with someone else's domain.
4. A non-TE name is treated as a failed credential, not a `403`, so the response
   cannot be used to confirm which names exist.
5. `verifyPassword` reads the `Passwords` worksheet. If the user has a hash, only
   `bcrypt.compare` against it can succeed. Otherwise the domain's initial
   password is compared in constant time. Either way a bcrypt comparison runs, so
   response timing does not reveal whether a user has changed their password.
6. On success a JWT (HS256, 24h expiry, `jose`) is set as an **`HttpOnly`,
   `SameSite=Lax`, `Secure`-in-production** cookie named `session`, carrying only
   `{ username, domain, role }`.

Every credential failure returns the same message — *"Invalid name or
password."* — with `401`, and the attempt that trips the rate limiter returns
`429` on both paths alike, so no response can be used to tell a real name from
an unknown one.

**Fail-closed password reads.** If the `Passwords` worksheet cannot be read, login
returns `503`. It does **not** fall back to the config password, which would let
a user whose password was changed log back in with the superseded one. Only a
genuinely absent `Passwords` tab is treated as "no overrides yet".

**Session checks.** `src/proxy.ts` (Next 16's replacement for `middleware.ts`) is
an *optimistic* gate: it redirects cookie-less browsers to `/login` and answers
`401` for API calls, and clears a tampered or expired cookie so the user is not
stuck in a redirect loop. It is deliberately **not** the authorization layer —
every route handler and page re-reads the session with `getSession()` and
re-checks the domain itself, per the Next.js proxy documentation.

**Logout** (`POST /api/auth/logout`) clears the cookie. Changing a password also
clears it, since the old session was issued against the old credential.

## 10. How to deploy to Vercel

1. Push to GitHub.
2. On [Vercel](https://vercel.com/), **Add New → Project** and import the repo.
   Next.js 16 is detected automatically; no build-command override is needed.
3. Add all four environment variables from §2 under **Settings → Environment
   Variables**, for Production *and* Preview. For `GOOGLE_PRIVATE_KEY`, paste the
   value including its `\n` escapes.

   > **`SESSION_SECRET` is required at build time, not just at runtime.**
   > `src/lib/auth/session.ts` throws on import if it is missing in production,
   > so the *build* fails rather than deploying an app that signs sessions with a
   > public fallback secret — which would let anyone forge a cookie for any
   > domain. If a Vercel build dies with *"SESSION_SECRET must be set in
   > production"*, that is this check doing its job. Generate one with
   > `openssl rand -base64 32`.

4. **Deploy.**
5. Verify: open the deployment, log in as one TE, save attendance **during the
   3–4 PM IST window** (or have a Core Member open the override first), and
   confirm the row appears in the sheet. Outside the window a save is *supposed*
   to be refused, so a `403` there is a pass, not a failure.

Read §12 before rolling out. Two limitations matter on serverless in particular:
the rate-limit counters are per-instance, so an attacker hitting several
instances gets a multiple of the login budget; and two TEs toggling the *same*
member at the same moment is last-write-wins.

## 11. How to add/remove members

Edit `src/config/members.ts`, commit, and deploy. Roster changes are code, not
sheet data, on purpose: a stray edit in the spreadsheet must not be able to grant
someone access.

- **Adding** a member: their row is appended to the `Attendance` worksheet the
  first time their attendance is saved. Until then they still appear in the UI, as
  `Absent`.
- **Removing** a member: they disappear from the UI and from analytics. Their
  historical row is left in the sheet untouched — delete it manually if you want
  it gone.
- **Renaming** a member: rows are matched on name, so a rename leaves the old row
  behind and appends a new one. To keep the history, edit column A of the
  `Attendance` worksheet to the new name in the same commit.
- A member who exists **in the sheet but not in config** is ignored by design —
  config is the source of truth.

## 12. Known limitations

- **Rate limiting is in-process, not distributed.** Failures are counted in a
  module-level `Map`, keyed by IP + username: **5 failed logins** inside a
  15-minute window blocks that key for 15 minutes, and **10 failed
  password-change attempts** blocks it for 5 minutes — both answered with `429`
  and a `Retry-After` header. Dependency-free by decision, which means the
  counters **reset on a cold start and are not shared between serverless
  instances** — on Vercel, an attacker hitting several instances effectively gets
  a multiple of the budget. It raises the cost of online guessing by orders of
  magnitude but is not a substitute for a shared store. Moving to Upstash/Redis
  means replacing `RateLimiter` in `src/lib/rate-limit/`; nothing else changes.
- **Same-cell concurrent edits are last-write-wins.** Google Sheets offers no row
  locking, and a domain now has several TEs who may all be marking at once. The
  app narrows the blast radius as far as it can: a save writes *only* the members
  whose toggles you actually changed, so two TEs editing different members never
  clobber each other, and every save response carries the domain's authoritative
  state — read from the same grid the save planned against — so each browser
  picks up the others' marks without an extra request. But if two people toggle
  the *same* member within the same second, the later write wins silently.
- **The audit trail is append-only and optional.** Every save appends one row per
  mark to an `Audit Log` tab (timestamp, who marked it, member, state, date). If
  that tab does not exist the save still succeeds and the UI says so — the log is
  never allowed to cost you a mark. The `Attendance` tab itself stores current
  state, not history, so the log is the only record of who set what.
- **Roster changes need a deploy** (see §11).
- **Sheet-only members are ignored** — a row in the sheet with no matching config
  entry never appears in the UI or analytics.
- **Worksheets must exist.** The values API cannot create a tab, so a missing
  `Attendance` or `Passwords` tab is a configuration error, not something the app
  can repair (see §6).
- **Google Sheets API quota** is 60 read and 60 write requests per minute per
  *user* — and every request here comes from the one service account, so that is
  the binding limit rather than the 300/min project cap. A save costs **three**
  requests regardless of how many members changed: one `values.get`, one
  `values.batchUpdate`, one audit append. The browser coalesces a burst of taps
  into a single save (see §12a), so a TE marking a fourteen-person roster spends
  3 requests, not 42. Every domain in the club marking at once still fits.
- **Analytics recomputes from the full sheet on each load.** Fine for a few dozen
  members over an event season; it would want caching at thousands of rows.
- **Sessions are stateless.** A JWT stays valid for its full 24 hours; there is no
  server-side revocation list, so logging out on one device does not invalidate a
  session already issued to another.

---

## 12a. How saving works

There is no Save button, and there was never meant to be one: a TE taps toggles
and the marks go to the sheet on their own. What changed is *when*.

- A tap updates the screen immediately and joins a pending batch.
- **700 ms after the last tap**, the whole batch goes up as one `POST`. Twenty
  taps in a row cost one request, not twenty.
- The batch is also flushed the moment the tab is hidden or navigated away from,
  so locking a phone mid-roll-call cannot lose the last mark.
- The response carries the domain's attendance as the server now sees it. The
  browser adopts that, which is how a second TE's concurrent marks appear without
  polling — and how an optimistic guess gets corrected if it was wrong.
- If a save fails, the screen re-reads the sheet rather than guessing which marks
  landed, and says so.

The indicator next to the running total shows `Saving…` / `Saved`, so "did that
register?" is answerable without opening the spreadsheet.

---

## Project structure

```
src/
  app/
    page.tsx                  attendance screen (authenticated shell)
    login/                    login screen
    analytics/                analytics dashboard
    change-password/          password change screen
    api/
      attendance/route.ts     GET today's attendance · POST changes
      override/route.ts       Core Members' 15-minute override switch
      auth/login/route.ts
      auth/logout/route.ts
      auth/change-password/route.ts
  components/                 Header, HamburgerMenu, DomainSelector,
                              AttendanceList, AttendanceToggle, WindowBanner,
                              OverridePanel, AnalyticsView, ChangePasswordForm
                              (+ CSS modules)
  config/
    domains.ts                the six markable domains (Core is not one)
    members.ts                the roster — single source of truth
    auth.ts                   initial per-domain passwords
  lib/
    google-sheets/
      client.ts               the only module that touches the network
      errors.ts               error taxonomy (missing-tab · config · unavailable)
      sheet-model.ts          pure sheet logic — parsing, write plans, analytics
      attendance-service.ts   operations against an injectable SheetsClient
      index.ts                the named service layer used by routes
    auth/
      session.ts              JWT encode/decode, cookie handling
      credentials.ts          bcrypt verification, timing-safe fallback
      authorize.ts            the cross-domain rule, as a pure function
      scope.ts                which domain a session may act on
    time/ist.ts               the attendance window — one definition, shared by
                              the route that enforces it and the UI that shows it
    validation/               request-payload validators
    rate-limit/               brute-force counter
    api/http.ts               shared JSON error responses
  types/index.ts              shared types
  proxy.ts                    optimistic auth gate (Next 16 `proxy`)
```

The separation that matters: **UI** (`components/`, `app/*/page.tsx`) → **API**
(`app/api/`) → **business logic** (`lib/validation`, `lib/auth`) → **Google
Sheets** (`lib/google-sheets`). Only `client.ts` performs I/O; everything
interesting is a pure function over data, which is why it can be tested without
credentials.

## API

| Endpoint | Success | Failure |
|---|---|---|
| `POST /api/auth/login` | `200 {success, username, domain}` + session cookie | `400` bad payload · `401` bad credentials · `429` rate-limited · `503` password store unreadable |
| `POST /api/auth/logout` | `200` | — |
| `POST /api/auth/change-password` | `200`, session cleared | `400` · `401` wrong current password · `429` · `503` |
| `GET /api/attendance` | `200 {date, domain, records, overrideEndMs, serverTimeMs}` | `401` · `503` |
| `POST /api/attendance` | `200 {success, date, domain, saved, records, …}` | `400` invalid payload · `401` · **`403`** member outside your domain, window closed, or a date that is not today · `503` |
| `POST /api/override` | `200 {success, overrideEndMs}` | `400` · `401` not a Core Member · `503` |

How the two request-supplied fields are treated:

- **`domain`** — a *request*, never a decision. `GET` reads it from the query
  string and `POST` from the body, and both hand it to `resolveDomain`: a TE
  always gets their own domain whatever they ask for, a Core Member gets the one
  they named if it is a real domain and `Curation` otherwise. `Core` is never a
  valid answer.
- **`date`** — accepted on `GET` (`?date=DD/MM/YYYY`) so you can read back an
  earlier day. **Not accepted on `POST`:** the save date comes from the server
  clock, and a body naming any other date is a `403`. Honouring it would let a TE
  quietly backfill last week, which is the thing a fixed window exists to stop.

Both `GET` and `POST` return `serverTimeMs`, which the browser uses to drive the
countdown — so a device with a wrong clock cannot be shown a window the API will
refuse to honour.

## Edge cases handled

The spec's §15 list, and where each is dealt with:

| Case | Behaviour |
|---|---|
| Wrong domain selected for a TE | Domain comes from the roster, not the form; the selector only filters the name list. |
| Wrong / empty password | `401` *"Invalid name or password."* / `400` *"Password is required."* |
| Non-existent TE, or an SE name | `401`, same message — no account enumeration. |
| Unauthorized API request | `401` from both `proxy.ts` and the handler. |
| **TE attempting another domain** | **`403`, nothing written** (`authorizeChanges`). |
| Sheets API unavailable / offline | `503` with a retry message; the UI shows an error and a working **Retry**. |
| Today's column already exists | Reused. |
| Today's column doesn't exist | Appended past the last used column, once. |
| Duplicate submission | Deduplicated per member inside one batch; last value wins. |
| Sheet rows missing / sheet empty | Header + full roster seeded in config order. |
| Member in config, not in sheet | Row appended on first save; shown as `Absent` before that. |
| Member in sheet, not in config | Ignored (config is the source of truth). |
| Invalid sheet format | Ragged rows, blank spacer columns, and duplicate date headers are all tolerated. |
| Multiple TEs editing at once | Only toggled members are written, and every save response carries the domain's current state so each browser adopts the others' marks — no extra request, no polling. |
| **Marking outside 3–4 PM IST** | **`403`**, decided on the server clock. Toggles are also disabled in the UI, but the UI is the courtesy, not the control. |
| **A save naming any date but today** | **`403`.** The save date comes from the server; a TE cannot backfill. |
| **A forged or unknown `domain`** | Resolved against the session — a TE gets their own, a Core Member gets a real domain or the default. Never `Core`. |
| Core Member override running | TEs may save until it expires; it lives in the sheet, so every serverless instance and every device agrees on when it ends. |
| `Audit Log` tab missing | The attendance write still succeeds; the UI reports that the save was not logged. |
| Session expiry | Redirect to `/login` (or `401` for API); the stale cookie is cleared. |
| Logout | Cookie cleared. |
| Password change failure | `401` / `503` with a specific message; nothing partially written. |
| Password confirmation mismatch | Caught client-side before the request. |
| Browser refresh after login | Session cookie survives; the page re-reads the sheet. |
| Mobile screen sizes | Fluid single-column layouts, 44px minimum tap targets, and narrow-screen breakpoints in the header, the toggles and the analytics grid. Verified at 375px; the analytics page widens to 940px on a laptop. |
| Device clock wrong | The countdown runs on the server's clock, taken from the API response, not the device's. |

## Tests

```bash
npm test
```

142 tests, no credentials and no network. Node's native TypeScript type-stripping
runs the `.ts` files directly, so there is **no test dependency** — nothing was
added to `package.json` for this.

Coverage focuses on the guarantees that are expensive to get wrong:

- **`sheet-model.test.ts`** — column-letter maths, date-column discovery, write
  plans, and analytics against hand-built grids, including ragged rows and
  duplicate headers.
- **`attendance-service.test.ts`** — a fake `SheetsClient` records every call, so
  the tests assert that a 10-member save issues **exactly one read and one
  `batchUpdate`** (**three** requests with the audit append, for any roster size),
  that untouched members appear in **no** write range, that today's column is
  created when absent and reused when present, that the save reports the
  post-write roster without a second read, that a missing `Audit Log` tab does
  not cost the attendance write, and that an outage propagates instead of
  reporting a false success.
- **`authorize.test.ts`** — the cross-domain rule: a foreign member name is
  rejected, one foreign name rejects the whole submission, and casing or padding
  cannot bypass it.
- **`validation/index.test.ts`** — payload shapes, the `DD/MM/YYYY` calendar check
  (including leap years), and bcrypt's 72-byte ceiling.
- **`rate-limit/index.test.ts`** — window and block behaviour against an injected
  clock, key isolation, and the stale-entry sweep.
- **`time/ist.test.ts`** — the attendance window: that it opens at exactly
  15:00:00 IST and shuts at exactly 16:00:00, that the date rolls at IST midnight
  rather than UTC midnight, and that the countdown never goes negative at any
  minute of the day.
- **`auth/scope.test.ts`** — which domain a session may act on: a TE is pinned to
  their own whatever they ask for, a Core Member may pick any real domain, and
  anything unknown — `Core` included — falls back rather than being trusted.

## Verifying the complete flow

The unit tests cannot reach Google, so the end-to-end matrix needs real
credentials. With `npm run dev` running and `.env.local` filled in:

```bash
./scripts/verify-flow.sh
```

The script drives the spec's minimum test cases over `curl` — including the two
that matter most, *Curation TE → Marketing attendance → BLOCKED* and *6 rapid bad
logins → 429* — and prints a pass/fail line per case.

Two things to know before running it, both consequences of closing the
backdating hole:

- **Its writes land in today's real column.** The script can no longer aim at a
  throwaway `01/01/2000` date, because the server now picks the save date itself.
  Point `BASE_URL` at a server wired to a scratch spreadsheet.
- **The write cases need the window open** — 3–4 PM IST, or a Core Member's
  override. Outside that, every save is a correct `403` and those cases report
  failures. The unauthenticated, validation, and brute-force sections need
  neither a session nor the window, and are skipped (not failed) when login
  doesn't succeed — which is what makes the script useful without credentials.

Member names and passwords default to `src/config/`; override any TE who has
already changed their own with
`CURATION_TE=… CURATION_PASSWORD=… MARKETING_TE=… MARKETING_PASSWORD=… ./scripts/verify-flow.sh`.
The exit status is 0 only if every case passed.

Then check by hand, in a browser:

| Case | Expect |
|---|---|
| Save, close the tab, reopen | Marks persist (read back from the sheet). |
| Tap six toggles quickly | **One** `POST` in the server log, not six. |
| Tap a toggle and lock the phone immediately | The mark still lands. |
| First save on a new day | A new date column appended; existing ones untouched. |
| Two browsers, same domain, different members | Neither clobbers the other, and each sees the other's marks after its own next save. |
| At 15:59, wait a minute | The banner flips to closed and the toggles disable themselves. |
| 375px viewport | Toggles stay tappable, nothing overflows. |

Watch the dev-server log during a save: it prints one line reporting the number
of Sheets calls the save actually made — **three** (read, write, audit append),
or two where the `Audit Log` tab is absent, whatever the member count. If that
number grows with the roster, something has regressed.

---

## License

[MIT](LICENSE). The code is free to reuse; the TEDx and TEDxDYPDPU names and
marks are not covered by it and remain subject to TED's own trademark and event
licensing rules.
