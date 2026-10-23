#!/usr/bin/env bash
#
# scripts/verify-flow.sh — drives the spec's §17 test matrix against a running
# server, over HTTP, with real Google credentials.
#
# The unit suite (`npm test`) cannot reach Google, so it proves the sheet logic
# with a fake client. This script proves the other half: that the live app
# actually returns 401/403/429 where it must, and that a save round-trips
# through the real spreadsheet.
#
#   npm run dev                 # in one terminal
#   ./scripts/verify-flow.sh    # in another
#
# Configuration (all optional):
#   BASE_URL            default http://localhost:3000
#   VERIFY_DATE         date column the read-back assertions look at, DD/MM/YYYY.
#                       Defaults to today in IST, and you almost certainly want
#                       that: POST /api/attendance now takes the date from the
#                       server clock and rejects a different one in the body, so
#                       a TE cannot backfill a past day. Pointing this elsewhere
#                       makes the reads look somewhere the writes never land.
#
#                       Two consequences worth reading before you run this:
#                        - the write cases touch TODAY'S REAL COLUMN. Point
#                          BASE_URL at a server wired to a scratch spreadsheet.
#                        - they also need the 3-4 PM IST window open, or a Core
#                          Member's override running. Outside that, every save is
#                          a correct 403 and those cases will report failures.
#   CURATION_TE / CURATION_SE / CURATION_PASSWORD
#   MARKETING_TE / MARKETING_SE / MARKETING_PASSWORD
#                       Defaults track src/config/members.ts and
#                       src/config/auth.ts. Override them for any TE who has
#                       already changed their own password.
#
# Exit status is 0 only if every case passes.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
# Today in IST, matching the column the server will file a save under.
VERIFY_DATE="${VERIFY_DATE:-$(TZ=Asia/Kolkata date +%d/%m/%Y)}"

# Defaults track src/config/members.ts and src/config/auth.ts. Once a TE changes
# their own password the default stops working for them — override it here.
CURATION_TE="${CURATION_TE:-Curation TE 1}"
CURATION_SE="${CURATION_SE:-Curation SE 1}"
CURATION_PASSWORD="${CURATION_PASSWORD:-CHANGE_ME_Curation}"
MARKETING_TE="${MARKETING_TE:-Marketing TE 1}"
MARKETING_SE="${MARKETING_SE:-Marketing SE 1}"
MARKETING_PASSWORD="${MARKETING_PASSWORD:-CHANGE_ME_Marketing}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CURATION_JAR="$TMP/curation.cookies"
MARKETING_JAR="$TMP/marketing.cookies"

if [ -t 1 ]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
else
  GREEN=''; RED=''; DIM=''; BOLD=''; OFF=''
fi

passed=0
failed=0
STATUS=''
BODY=''

section() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }

ok()   { printf '  %sPASS%s  %s\n' "$GREEN" "$OFF" "$1"; passed=$((passed + 1)); }
bad()  { printf '  %sFAIL%s  %s\n        %s%s%s\n' "$RED" "$OFF" "$1" "$DIM" "$2" "$OFF"; failed=$((failed + 1)); }
skip() { printf '  %sSKIP  %s%s\n' "$DIM" "$1" "$OFF"; }

# JSON-quote a shell string so member names with punctuation stay valid JSON.
json_str() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

# call METHOD PATH JAR [BODY] -> sets STATUS, BODY; headers in $TMP/headers
call() {
  local method="$1" path="$2" jar="$3" data="${4-}"
  local args=(-s -S -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}'
              -X "$method" -H 'Content-Type: application/json')
  [ -n "$jar" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(--data-binary "$data")
  STATUS="$(curl "${args[@]}" "$BASE_URL$path" 2>"$TMP/curl.err")"
  BODY="$(cat "$TMP/body" 2>/dev/null)"
}

expect() {
  local label="$1" want="$2"
  if [ "$STATUS" = "$want" ]; then
    ok "$label ${DIM}($STATUS)${OFF}"
  else
    bad "$label" "got ${STATUS:-no response}, want $want — $BODY"
  fi
}

# Read a field out of the last JSON response. Node is already a project
# requirement, so this needs no extra tooling and no fragile grepping.
json() {
  node -e '
    const fs = require("node:fs");
    // With `node -e`, argv is [execPath, ...userArgs] — there is no script path.
    const [, file, mode, arg] = process.argv;
    let body;
    try { body = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { process.stdout.write("UNPARSEABLE"); process.exit(0); }
    if (mode === "state") {
      const r = (body.records || []).find((r) => r.memberName === arg);
      process.stdout.write(r ? r.state : "MISSING");
    } else if (mode === "domains") {
      const set = [...new Set((body.records || []).map((r) => r.domain))].sort();
      process.stdout.write(set.join(",") || "NONE");
    }
  ' "$TMP/body" "$@"
}

expect_value() {
  local label="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    ok "$label ${DIM}($got)${OFF}"
  else
    bad "$label" "got \"$got\", want \"$want\""
  fi
}

header_present() {
  grep -qi "^$1:" "$TMP/headers"
}

login() { # NAME PASSWORD JAR
  call POST /api/auth/login "$3" \
    "{\"username\":$(json_str "$1"),\"password\":$(json_str "$2")}"
}

mark() { # JAR MEMBER STATE [EXTRA_JSON]
  local extra="${4-}"
  call POST /api/attendance "$1" \
    "{${extra}\"changes\":[{\"memberName\":$(json_str "$2"),\"state\":$(json_str "$3")}]}"
}

read_date() { # JAR
  call GET "/api/attendance?date=$(printf '%s' "$VERIFY_DATE" | sed 's|/|%2F|g')" "$1"
}

# ---------------------------------------------------------------------------

printf '%sTEDxDYPDPU attendance — live flow verification%s\n' "$BOLD" "$OFF"
printf '%ssaves land in the %s column (today, chosen by the server)%s\n' \
  "$DIM" "$VERIFY_DATE" "$OFF"

if ! curl -s -o /dev/null --max-time 10 "$BASE_URL/login"; then
  printf '\n%sCannot reach %s.%s Start the server first: npm run dev\n' "$RED" "$BASE_URL" "$OFF"
  exit 1
fi

section '1. Unauthenticated requests are refused'
call GET /api/attendance ''
expect 'GET /api/attendance with no session' 401
mark '' "$CURATION_SE" Present
expect 'POST /api/attendance with no session' 401

section '2. Curation TE — own domain SUCCESS'
login "$CURATION_TE" "$CURATION_PASSWORD" "$CURATION_JAR"
expect "login as $CURATION_TE" 200
CURATION_OK=0
if [ "$STATUS" = 200 ]; then
  CURATION_OK=1
else
  # Not fatal: the payload-validation and brute-force sections need no session,
  # and they are exactly the ones worth running when Google is unreachable.
  printf '        %scheck CURATION_TE / CURATION_PASSWORD — session cases will be skipped%s\n' \
    "$DIM" "$OFF"
fi

if [ "$CURATION_OK" = 1 ]; then
  read_date "$CURATION_JAR"
  expect 'GET own-domain attendance' 200
  expect_value 'response contains only Curation rows' 'Curation' "$(json domains)"

  mark "$CURATION_JAR" "$CURATION_SE" Present
  expect "mark $CURATION_SE Present" 200
  read_date "$CURATION_JAR"
  expect_value 'the sheet reads back Present' 'Present' "$(json state "$CURATION_SE")"

  mark "$CURATION_JAR" "$CURATION_SE" Absent
  expect "mark $CURATION_SE Absent (reuses the same column)" 200
  read_date "$CURATION_JAR"
  expect_value 'the sheet reads back Absent' 'Absent' "$(json state "$CURATION_SE")"

  mark "$CURATION_JAR" "$CURATION_SE" Present '"domain":"Marketing",'
  expect 'a forged "domain" field from a TE is ignored' 200
  read_date "$CURATION_JAR"
  expect_value 'the write still landed in Curation' 'Present' "$(json state "$CURATION_SE")"
else
  skip 'own-domain read/write round-trip'
fi

section '3. Curation TE — another domain BLOCKED (spec §2, the headline rule)'
if [ "$CURATION_OK" = 1 ]; then
  mark "$CURATION_JAR" "$MARKETING_SE" Present
  expect "POST $MARKETING_SE as a Curation TE" 403

  call POST /api/attendance "$CURATION_JAR" \
    "{\"changes\":[{\"memberName\":$(json_str "$CURATION_SE"),\"state\":\"Absent\"},{\"memberName\":$(json_str "$MARKETING_SE"),\"state\":\"Present\"}]}"
  expect 'a batch mixing one foreign name is rejected whole' 403
  read_date "$CURATION_JAR"
  expect_value 'nothing half-applied — the own-domain mark is untouched' 'Present' "$(json state "$CURATION_SE")"
else
  skip 'cross-domain rejection (needs a session)'
fi

section '4. Marketing TE — the mirror image'
login "$MARKETING_TE" "$MARKETING_PASSWORD" "$MARKETING_JAR"
if [ "$STATUS" = 200 ]; then
  ok "login as $MARKETING_TE ${DIM}($STATUS)${OFF}"
  mark "$MARKETING_JAR" "$MARKETING_SE" Present
  expect "mark $MARKETING_SE Present" 200
  mark "$MARKETING_JAR" "$CURATION_SE" Present
  expect "POST $CURATION_SE as a Marketing TE" 403
  read_date "$MARKETING_JAR"
  expect_value 'response contains only Marketing rows' 'Marketing' "$(json domains)"
elif [ "$CURATION_OK" = 1 ]; then
  # Curation logged in, so this is a real Marketing credential problem.
  bad "login as $MARKETING_TE" "got $STATUS, want 200 — $BODY"
else
  skip 'Marketing mirror cases (no session)'
fi

section '5. Credential failures'
if [ "$CURATION_OK" = 1 ]; then
  # Reaches bcrypt, so it needs the Passwords worksheet to be readable.
  login "$CURATION_TE" 'definitely-the-wrong-password' "$TMP/throwaway.cookies"
  expect 'wrong password' 401
else
  skip 'wrong password (needs a readable password store)'
fi
call POST /api/auth/login '' "{\"username\":$(json_str "$CURATION_TE"),\"password\":\"\"}"
expect 'empty password' 400
call POST /api/auth/login '' '{"password":"whatever"}'
expect 'missing name' 400
login 'No Such Person' 'whatever' "$TMP/throwaway.cookies"
expect 'non-existent TE' 401
login "$CURATION_SE" "$CURATION_PASSWORD" "$TMP/throwaway.cookies"
expect 'an SE name (only TEs may log in)' 401
call POST /api/auth/login '' 'not json at all'
expect 'malformed JSON' 400

section '6. Brute-force protection (spec §12)'
# A unique username per run, so a locked-out key never leaks into the next run
# and no real TE is locked out by this test.
BRUTE="verify-flow probe $$-$(date +%s)"
blocked_at=0
for attempt in 1 2 3 4 5 6; do
  login "$BRUTE" "guess-$attempt" "$TMP/throwaway.cookies"
  if [ "$STATUS" = 429 ]; then
    [ "$blocked_at" -eq 0 ] && blocked_at=$attempt
  elif [ "$STATUS" != 401 ]; then
    bad "rapid bad login #$attempt" "got $STATUS, want 401 or 429 — $BODY"
  fi
done
if [ "$blocked_at" -gt 0 ] && [ "$blocked_at" -le 6 ]; then
  ok "repeated bad logins are blocked ${DIM}(429 from attempt #$blocked_at)${OFF}"
else
  bad 'repeated bad logins are blocked' 'never received a 429 in 6 attempts'
fi
if [ "$STATUS" = 429 ] && header_present 'Retry-After'; then
  ok "the 429 carries Retry-After ${DIM}($(grep -i '^Retry-After:' "$TMP/headers" | tr -d '\r'))${OFF}"
else
  bad 'the 429 carries Retry-After' 'header missing'
fi

section '7. Password change is guarded'
if [ "$CURATION_OK" = 1 ]; then
  call POST /api/auth/change-password "$CURATION_JAR" \
    '{"currentPassword":"definitely-the-wrong-password","newPassword":"a-new-password-123"}'
  expect 'wrong current password' 401
  call POST /api/auth/change-password "$CURATION_JAR" \
    "{\"currentPassword\":$(json_str "$CURATION_PASSWORD"),\"newPassword\":\"short\"}"
  expect 'too-short new password (nothing written)' 400
else
  skip 'change-password cases that need a session'
fi
call POST /api/auth/change-password '' \
  '{"currentPassword":"x","newPassword":"a-new-password-123"}'
expect 'change-password with no session' 401

section '8. Recovery and logout'
if [ "$CURATION_OK" = 1 ]; then
  login "$CURATION_TE" "$CURATION_PASSWORD" "$CURATION_JAR"
  expect 'a correct password still works after a failed attempt' 200
  call POST /api/auth/logout "$CURATION_JAR"
  expect 'logout' 200
  call GET /api/attendance "$CURATION_JAR"
  expect 'the session is gone after logout' 401
else
  skip 'logout (needs a session)'
fi

# ---------------------------------------------------------------------------

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$passed" "$failed" "$OFF"
if [ "$CURATION_OK" = 1 ]; then
  printf '%sRemember to delete the %s column from the Attendance worksheet.%s\n' \
    "$DIM" "$VERIFY_DATE" "$OFF"
else
  printf '%sNo session could be established, so nothing was written to the sheet.\n' "$DIM"
  printf 'A 503 on login means the Passwords worksheet was unreadable — that is the\n'
  printf 'intended fail-closed behaviour, not a bug. Check the GOOGLE_* variables,\n'
  printf 'that the sheet is shared with the service account, and that both worksheets\n'
  printf 'exist. See README §5 and §6.%s\n' "$OFF"
fi
printf '%sStill to check by hand: a real save on today'"'"'s date, a save on a fresh\n'
printf 'date creating a new column, two browsers editing different members, and a\n'
printf '375px viewport. See "Verifying the complete flow" in README.md.%s\n' "$OFF"

[ "$failed" -eq 0 ]
