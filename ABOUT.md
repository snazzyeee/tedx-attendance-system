# About this project

A small, real piece of software: the attendance system for the TEDxDYPDPU 2026
organising committee. [README.md](README.md) is the manual — how to install it,
configure it and run it. This file is the context the manual leaves out: what
problem it solves, and why it is built the way it is.

---

## The problem

TEDxDYPDPU is run by a student committee of roughly seventy people, split across
six domains (Curation, Marketing, EPM, PRxEditing, Design, Tech), each led by a
group of Team Executives (TEs) and staffed by Sub-Executives (SEs), with a small
set of Core Members above them.

Attendance was being taken the way it usually is in a student club: a WhatsApp
message, a roll call, somebody's notebook, a spreadsheet nobody trusted. The
failures were predictable — marks filed days later from memory, domains editing
each other's rows, no way to answer "who has actually been showing up?" without
re-reading a month of chat.

The committee wanted three things: a single sheet of record, attendance marked in
the hour it actually happens, and no one able to mark anyone outside their own
domain.

## The two rules

Everything else in the app is downstream of these:

> **Every TE can manage attendance — but only for their own domain, and only
> between 3 PM and 4 PM IST.**

Both are enforced on the server, against the session's identity and the server's
own clock — never as a disabled button. A Curation TE who hand-crafts a request
naming a Marketing member gets a `403` and the spreadsheet is not touched. So
does one who tries to file marks under yesterday's date, or to save at 9 PM. The
UI reflects the rules; it does not implement them.

Core Members are the one exception: they are exempt from the window and can open
a 15-minute override that lets everyone else mark late when a session genuinely
ran over.

## Why Google Sheets is the database

Because the committee already lived in a spreadsheet, and the system had to
survive being handed to next year's team. A Postgres instance is one unpaid bill
away from taking the data with it; a sheet in the club's Drive can be opened,
sorted, exported and understood by whoever inherits it, with or without this app
still running.

The cost of that choice is real and is documented honestly in the README's
limitations: no row locking (same-cell edits are last-write-wins), a 60
request-per-minute quota that shapes how saving works, and worksheets the app
cannot create for itself. Those were accepted deliberately, not discovered late.

## Decisions worth knowing about

- **The roster is code, not sheet data.** `src/config/members.ts` is the single
  source of truth for who exists, and every screen plus the backend's
  authorization check reads from it. A stray edit in the spreadsheet therefore
  cannot invent a member or grant anyone access. The price is that adding someone
  needs a deploy, which is the trade this system wanted.

- **There is no Save button.** A TE taps toggles; 700 ms after the last tap the
  whole batch goes up as one request. Twenty taps cost one write instead of
  twenty, which is what keeps a full roll call inside Google's quota. The batch
  also flushes when the tab is hidden, so locking a phone mid-roll-call cannot
  lose the last mark.

- **Passwords start shared and end personal.** Each domain has one bootstrap
  password in `src/config/auth.ts`; the moment a TE changes theirs, a bcrypt hash
  lands in the sheet and the config value stops working for them. Bootstrapping
  seventy people through an invite flow was never going to happen in a student
  club, so the system optimises for day one and then gets out of the way.

- **The audit log is append-only and never blocks a mark.** Every save appends a
  row — timestamp, who marked it, member, state, date — to an `Audit Log` tab.
  The attendance tab holds current state, so this log is the only record of who
  set what. If the tab is missing the save still succeeds and the UI says so: the
  log is not allowed to cost someone a mark.

- **No dependency was added for anything that could be written.** Rate limiting
  is an in-process map, not Redis. The tests run on Node's native TypeScript
  type-stripping, with no test framework. Both are stated limitations rather than
  claims — the rate limiter resets on a cold start and is not shared between
  serverless instances, and the README says so.

- **Time is a server concern.** IST handling is isolated in `src/lib/time/ist.ts`
  and unit-tested, because "is it 3 PM?" is a security question here, not a
  formatting one.

## What this is not

It is not a general-purpose attendance product. It hardcodes a TEDx committee's
shape — these domains, these roles, one daily window, Asia/Kolkata — and it is
better for it. If you want it for your own club, fork it and change
`src/config/`: the domains, the roster, the passwords, and the window in
`src/lib/time/ist.ts`. Section 11 of the README covers the roster part.

## Status

Built for the 2026 edition and deployed on Vercel against the committee's own
spreadsheet. `handover.md` is the engineering log — judgement calls, bugs found
in review, and what the next person should pick up first.

This is the public copy of the project. It is the same code the committee runs,
with two deliberate substitutions: `src/config/members.ts` ships a placeholder
roster of the right shape instead of the real one, and the bootstrap passwords in
`src/config/auth.ts` are `CHANGE_ME_*` rather than the deployed values. No real
names, contact details or credentials are in this repository or its history — the
members' information spreadsheet was never tracked, and the Google
service-account key and `SESSION_SECRET` are environment variables.

Clone it, put your own roster in `src/config/`, and it runs.
