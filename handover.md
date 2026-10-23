# Handover

State of the TEDxDYPDPU Attendance Management System, for whoever picks this up
next — human or agent.

**Status:** every numbered requirement in
`TEDxDYPDPU_Attendance_Management_System_Technical_Requirements-1.pdf` is
implemented, plus the Core Member role and override window added since.
`npm test` (142 tests), `npm run typecheck`, `npm run lint` and `npm run build`
are all clean, and the whole UI has been driven end-to-end against a stubbed
sheet. What is left is the live run against the **real** spreadsheet, which needs
credentials this environment does not have.

Read [README.md](README.md) first for setup and behaviour. This file covers only
what the README deliberately leaves out: history, judgement calls, and what to do
next.

---

## Where the work lives

`main`, deployed on Vercel. The committee's own deployment and its spreadsheet
live in a private repository; this is the public copy, with the roster replaced
by placeholders.

Files in the project directory deliberately **not** tracked:

- **The committee's member-information spreadsheet** — the sign-up form's
  responses: real names, contact details, year of study. PII in git history is
  hard to undo, so the file never enters the tree. Only what the app actually
  needs — a name, a domain, a role — is transcribed into `src/config/members.ts`,
  and in this public copy even those are placeholders. Covered by the `*.xlsx`
  rule in `.gitignore`.
- **`*.exe`** — a stray `Firefox Installer.exe` turned up in the tree once.
  Gitignored so it cannot happen again.

`.env.local` is covered by the `.env*` rule, so no credentials are tracked.

**On Vercel, set `SESSION_SECRET`, `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_EMAIL` and
`GOOGLE_PRIVATE_KEY`.** `session.ts` throws at boot if `SESSION_SECRET` is
missing in production — deliberately, because a predictable fallback secret would
let anyone forge a session cookie for any domain and defeat every authorization
check in the app.

---

## What changed in this pass (review + revamp)

The app was complete and working; this pass audited it, fixed what the audit
found, and rebuilt the interface. `npm test` (142), `npm run typecheck`,
`npm run lint` and `npm run build` are all clean.

### Security

| Was | Now |
|---|---|
| `POST /api/attendance` honoured a client-supplied `date`. A TE inside the 3 PM window could file marks under *any* valid date — including last week's. | The date comes from the server clock; a body naming another date is a `403`. This is the hole the whole fixed-window design exists to close, so it was the most serious finding. |
| `POST` took a Core Member's `domain` straight from the body, unvalidated, where `GET` checked it against `DOMAINS`. Nothing was exploitable — an unknown domain yields an empty roster and `authorizeChanges` then rejects every name — but the rule was being enforced by accident, two functions downstream. | Both verbs call `resolveDomain` (`src/lib/auth/scope.ts`), which is unit-tested and can only ever answer with a real domain the session may touch. `Core` is never one. |
| `POST /api/auth/login` returned Google's raw error text on a Sheets failure. That route is reachable by anyone, and those messages can name the spreadsheet ID and the service-account address. | Signed-in routes still get the exact message — "the Passwords worksheet does not exist" is fixable in a minute, where "try again later" has someone retrying forever. The unauthenticated one gets a generic line, detail to the server log. |
| The override expiry sat in the `Passwords` tab and came back out of `parsePasswordRows` as if it were somebody's bcrypt hash. | `OVERRIDE_KEY` is filtered out of the password map and read by its own `parseOverrideEnd`. |

### Correctness

- **The window was computed twice, two different ways.** The route did
  `new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }))` — a
  round-trip through a locale string Node is not required to parse back — and the
  client did its own offset arithmetic. `src/lib/time/ist.ts` is now the single
  definition, used by both, with tests pinning the 15:00:00 and 16:00:00
  boundaries and the IST date roll.
- **The countdown trusted the device clock.** A phone running fast was shown an
  open window the API would refuse. `GET` and `POST` now return `serverTimeMs`
  and the browser runs on that offset.
- **A save whose audit append failed reported "Not saved"** — even though the
  attendance had been written, which sends a TE back to re-tap a correct roster.
- **`GET /api/attendance` 503'd the entire roster** when the override lookup
  failed. It now degrades to "no override", which shows *less* access and never
  more; `POST` still fails closed, because there the answer authorises a write.
- **Six unit tests were failing** against behaviour that had deliberately changed
  (lower-cased password keys, the `domain` passthrough). Updated, not deleted.
- **`npm run lint` failed** on `Date.now()` during render in `page.tsx`.
- `src/config/*.ts` imported types with value syntax, which stopped anything
  importing them from loading under `node --test`.

### Efficiency

The important one. **Every toggle POSTed on its own**, and every POST costs three
Sheets requests (`values.get`, `values.batchUpdate`, audit append). One TE marking
the fourteen-person EPM roster spent ~42 of Google's 60-per-minute quota; two
domains marking at 3 PM could exhaust it during the only hour the app is usable.

- Taps are now coalesced: 700 ms after the last one, the whole batch goes as a
  single request. Fourteen marks cost 3 requests instead of 42. Same UX — no Save
  button appeared — and the batch is flushed on tab-hide, so locking a phone
  mid-roll-call cannot lose the last mark.
- **The save response carries the domain's post-write state**, computed from the
  grid the save had already read (`projectAttendance`). That costs nothing,
  replaces the browser's optimistic guess with the truth, and picks up a second
  TE's concurrent marks — which matters now that a domain has up to eight TEs.
  Previously nothing re-synced after a save at all.
- The override is only read from the sheet when the normal window is closed, so
  the common path saves a request.
- The `[POST /api/attendance]` log line claimed "2 Sheets calls" while making
  three. It reports the real count now.
- The once-a-second countdown re-rendered the entire roster. The rows are
  memoised; only the banner repaints.

### Interface

Rebuilt around a complete set of design tokens. The previous stylesheet was a
half-finished migration to dark mode: `#e0e0e0` card borders, `#ececec` bars,
`#d8d8d8` stacked-bar fills and `color: green` success text left over from a
light theme — glaring or invisible against `#121212` — plus `box-shadow`s at
`rgba(0,0,0,0.1)` that were invisible by construction. `AttendanceList` also
carried some sixty lines of inline styles with hard-coded hexes (`#66b3ff`,
`#66ff66`, `#cc0000`) that no token could reach.

- Every colour is a token in `globals.css`; nothing else hard-codes one.
- Contrast was the deciding constraint: `--tedx-red-deep` for filled buttons
  (white on it clears 5.2:1, where white on `#e62b1e` is 4.4:1 and misses AA),
  `--tedx-red-text` for red text on dark, and every semantic colour above 5:1.
- **Present is green, Absent is grey.** Present used to be TEDx red, which reads
  as an alarm on the one control a TE taps twenty times in a row. The brand red
  stays everywhere else — header rule, progress bars, analytics.
- Sticky header, card-based rows, a running total with a progress bar, an
  explicit `Saving… / Saved` indicator, and a permanent window banner with a live
  countdown — the rule the app exists to enforce now has a home on screen rather
  than surfacing only as a rejected save.
- `AttendanceList` was doing five jobs; `WindowBanner` and `OverridePanel` are
  their own files now.
- Accessibility: `:focus-visible` rings throughout, `aria-expanded` and
  Escape/outside-click on the menu (it could previously only be closed by hitting
  the button again), `aria-current` on the active link, labelled password
  toggles, 44px tap targets, `prefers-reduced-motion` honoured globally.
- The stylesheet asked for `'Inter'` and never loaded it, so every device was
  already falling back. The fallback stack is now the stated intent — which also
  means no webfont request on campus wifi.
- `viewport` and `themeColor` exports, per-page titles, `robots: noindex`.

### Housekeeping

- `scratch_members.txt` (a tracked duplicate of `members.ts`) deleted; `*.exe`
  gitignored after a stray `Firefox Installer.exe` turned up in the tree.
- `scripts/verify-flow.sh` updated for the server-derived date and pointed at the
  real roster. Read its header before running it: its writes now land in today's
  real column, and the write cases need the window open.

### Verified by hand

Driven end-to-end in a browser against a stubbed sheet (login as TE and as Core
Member, both dashboards, analytics, the menu, change-password, mobile at 375px
and desktop at 1280px), plus `curl` probes confirming: a TE out of hours → 403, a
TE backdating → 403, a TE naming another domain → 403, a TE reading another
domain → served their own, a Core Member naming `Core` or a junk domain → the
safe fallback, and 5 bad logins → 429 identically for a real and an invented
name. Six rapid toggles produced exactly **one** POST in the server log.

Still unverified: a run against the **real** spreadsheet. That has never
executed — this environment cannot reach `sheets.googleapis.com`.

---

## What the earlier pass changed

### Original implementation notes

An earlier session scaffolded the whole app — config, Sheets integration, JWT
sessions, middleware, all four routes — and it built successfully. Measuring it
against the spec, though, turned up hard violations rather than polish. All are
now fixed:

| § | Was | Now |
|---|---|---|
| 7 | `POST /api/attendance` looped a per-member update — ~30 Sheets calls for 10 members, over the 60/min quota | **Exactly 2 calls per save** (one `values.get`, one `values.batchUpdate`), independent of member count |
| 15 | The client POSTed *every* member, clobbering a concurrent TE's saves | Only changed members are sent, and only their cells are written |
| 7A | SSR-only page; a failure rendered a dead-end string | Client-owned data with explicit loading / error+**Retry** / loaded states |
| 7A | `useState(initialState)` never resynced, so the UI could drift from the sheet | Controlled toggles, and a re-fetch after every save |
| 12 | No brute-force protection at all | Sliding-window limiter on login (5 failures / 15 min) and change-password (10 / 15 min) → `429` + `Retry-After`. Both login failure paths — unknown name and wrong password — answer identically, so the limiter itself can't be used to tell real names from invented ones |
| 2, 12 | The domain check compared a *client-supplied* `record.domain`; a forged `{memberName:"Marketing SE 1", domain:"Curation"}` slipped through and died as a 500 | `authorizeChanges` checks every name against the session domain's roster → clean `403`, nothing written |
| — | `getPasswordOverrides` swallowed all errors and returned `{}`, so a Sheets outage let a changed password fall back to the config one | Fails closed: only a genuinely missing `Passwords` tab is "no overrides"; anything else is a `503` |
| 15 | "Member not found in sheet" threw a 500; rows were seeded only when the sheet was *completely* empty | Missing rows are appended in config order as part of the same batch |
| 10 | Four "today" cards | Member-wise %, date-wise trend, and overall % |
| 13 | Service functions did not exist under the names the spec lists | `getMembers`, `getDomainMembers`, `getTodayColumn`, `createDateColumn`, … all present |
| — | `next build` warned that `middleware` is deprecated | Migrated to `src/proxy.ts` (Next 16's rename); build is warning-free |
| — | `npm run lint` failed (3 errors, 9 warnings) | Clean |

Three scoping decisions, made with the user:

1. **The roster stays placeholder** (`Curation TE 1`, …). `src/config/members.ts`
   is documented so the real names can be pasted in — see README §7. **This is the
   one thing that must change before real use.**
2. **Rate limiting is in-memory, no new dependencies.** The cold-start /
   per-instance caveat is documented rather than engineered away (README §12).
3. **Analytics went full**, not just today's cards.

Nothing was added to `package.json`'s dependencies. The test suite runs on Node's
native TypeScript type-stripping.

## Architecture in one paragraph

`src/config/` is the source of truth for who exists. `src/lib/google-sheets/`
splits into `client.ts` (the *only* module that touches the network),
`sheet-model.ts` (pure functions over a `string[][]` grid — parsing, write plans,
analytics), `attendance-service.ts` (operations against an injectable
`SheetsClient`), and `index.ts` (the named service layer the spec asks for).
Routes are thin adapters: they read the session, resolve the domain
(`lib/auth/scope.ts`), validate the payload, call `authorizeChanges`, check the
clock (`lib/time/ist.ts`), and map errors to status codes. That split is why 142
tests run with no credentials and no network — everything interesting is a pure
function over data.

## Where the real decisions live

Worth reading before changing anything, because each encodes a constraint that
isn't obvious from the surrounding code:

- **`src/lib/auth/authorize.ts`** — the spec's headline rule ("only for their own
  domain"), extracted from the route specifically so it could be unit-tested. It
  validates *every* name before returning, so a batch with one foreign name is
  rejected whole and cannot half-apply.
- **`src/lib/google-sheets/sheet-model.ts`** — `buildWritePlan` is the load-bearing
  function. Everything the spec asks for about writes (batch once, touch only
  changed members, create-or-reuse today's column, append missing rows in config
  order) is decided here, as data, before any I/O happens.
- **`src/lib/auth/credentials.ts`** — always runs a bcrypt comparison, even when
  falling back to the config password, so response timing doesn't reveal whether a
  user has changed their password.
- **`src/proxy.ts`** — an *optimistic* gate only. Next's own proxy docs warn
  against using it as the authorization layer, so every route and page re-reads
  the session itself. Do not move authorization into it.
- **`src/lib/time/ist.ts`** — the attendance window, defined once. The route that
  refuses a late save and the countdown a TE reads are the same arithmetic. It
  was two implementations before, and two implementations of one rule is a bug
  waiting for a timezone to disagree.
- **`src/lib/auth/scope.ts`** — `resolveDomain` is the only thing that decides
  which domain a session may touch. Both verbs of the attendance route and both
  server pages go through it; do not re-derive it inline.
- **`src/config/members.ts` / `auth.ts`** — the doc comments explain how to reset
  a password. Note that `INITIAL_PASSWORDS` is per *domain*, so the several TEs a
  domain now has all start on the same bootstrap password and can sign in as one
  another until each sets their own. Per-person passwords would mean changing
  `Record<Domain, string>` to a per-member map; the `Passwords` worksheet is
  already keyed by username, so only the fallback is domain-scoped.

## Verification

```bash
npm test          # 142 tests, offline
npm run typecheck
npm run lint
npm run build
```

`scripts/verify-flow.sh` drives the spec's §17 matrix over `curl` against a
running dev server. Cases needing a session are skipped (not failed) when login
can't succeed, so the unauthenticated `401`s, payload validation and the whole
brute-force section still run without credentials.

**Read its header before running it.** Its writes now land in *today's real
column* — the server picks the save date, so the old throwaway `01/01/2000`
target is no longer reachable — and the write cases need the 3–4 PM IST window
open or a Core Member's override running. Point `BASE_URL` at a server wired to a
scratch spreadsheet.

## What is left to do

1. **Create the `Audit Log` tab** in the spreadsheet — columns Timestamp, Marked
   by, Member, State, Date. Without it every save shows "the Audit Log tab is
   missing, so this was not logged", which is accurate but is noise on every
   save, and it is the only record of *who* marked what.
2. **Ask every TE to change their password on day one** at `/change-password`.
   Until they do, all six PRxEditing TEs (say) share `CHANGE_ME_PRxEditing` and any
   of them can sign in as any other. See §7 of the README.
3. **Run the live matrix** with real credentials — `npm run dev`, then
   `./scripts/verify-flow.sh` during the window, then the by-hand checks at the
   end of the README. This is still the one thing that has never executed against
   a real spreadsheet: this environment cannot reach `sheets.googleapis.com`.
4. Watch the dev-server log during a save. It prints one line reporting the
   Sheets calls that save actually made — **three**, or two without the audit
   tab, whatever the member count. If that number starts scaling with the roster,
   the batching in `AttendanceList` has regressed and the budget guard in
   `attendance-service.test.ts` should have caught it — check why it didn't.

## If you extend it

- **Replacing the rate limiter with Redis/Upstash** is the highest-value hardening
  step. Swap the implementation in `src/lib/rate-limit/`; the interface
  (`check` / `recordFailure` / `reset`) and its injected clock are already shaped
  for it, and `index.test.ts` will keep passing if the semantics hold.
- **Per-person passwords** are the next most valuable change, now that a domain
  has up to eight TEs sharing one bootstrap password. Change `INITIAL_PASSWORDS`
  from `Record<Domain, string>` to a per-member map; the `Passwords` worksheet is
  already keyed by username, so only the fallback is domain-scoped.
- **The override window** is global — one switch opens the door for every domain
  at once. Per-domain overrides would mean keying `OVERRIDE_KEY` by domain in the
  `Passwords` tab and passing the domain through `getOverrideEndMs`.
- **Don't reintroduce per-toggle saving.** The debounce in `AttendanceList` is
  what keeps the app inside Google's quota; see §12a of the README before
  changing how saves are dispatched.
- **Adding a route:** keep authorization in the handler, not in `proxy.ts`, and
  put anything worth testing in `src/lib/` as a pure function rather than inline.
