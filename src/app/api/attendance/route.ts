import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeChanges } from "@/lib/auth/authorize";
import { canManageAttendance, isPrivileged, resolveDomain } from "@/lib/auth/scope";
import { getSession } from "@/lib/auth/session";
import {
  getAttendance,
  getDomainMembers,
  getOverrideEndMs,
  getTodayDateIST,
  updateAttendance,
} from "@/lib/google-sheets";
import { failure, forbidden, jsonError, unauthorized } from "@/lib/api/http";
import { isWindowOpen, WINDOW_CLOSED_MESSAGE } from "@/lib/time/ist";
import { parseAttendancePayload } from "@/lib/validation";
import type { AttendanceResponse } from "@/types";

const SAVE_FAILED = "Unable to save attendance. Please try again.";
const LOAD_FAILED = "Unable to load attendance. Please try again.";

/**
 * Attendance for the domain this session is allowed to see.
 *
 * The domain is resolved from the session by `resolveDomain`, so there is no
 * parameter a TE could set to read another domain's rows (spec §2).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !canManageAttendance(session)) return unauthorized();

  const domain = resolveDomain(session, request.nextUrl.searchParams.get("domain"));
  const requestedDate = request.nextUrl.searchParams.get("date");
  const dateStr = requestedDate?.trim() || getTodayDateIST();

  try {
    const [records, overrideEndMs] = await Promise.all([
      getAttendance(domain, dateStr),
      // Never let a missing override break the page it decorates: the roster is
      // what a TE came for, and `getOverrideEndMs` already degrades to "no
      // override" rather than throwing. The window itself still fails closed —
      // `POST` re-reads it before allowing an out-of-hours write.
      getOverrideEndMs(),
    ]);

    const body: AttendanceResponse = {
      date: dateStr,
      domain,
      records,
      overrideEndMs,
      // The countdown is driven by the server's clock, not the device's, so a
      // phone set five minutes fast cannot show a window that is really shut.
      serverTimeMs: Date.now(),
    };

    // Attendance changes through the hour, so a cached response would show a
    // stale roster after another TE saved.
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure("GET /api/attendance", error, LOAD_FAILED);
  }
}

/**
 * Save attendance marks.
 *
 * Three rules, every one of them decided from the session and the server clock
 * rather than from anything the client sent:
 *   1. The write domain comes from `resolveDomain` — a TE's own, or a real
 *      domain a Core Member selected. An arbitrary `domain` string cannot pass.
 *   2. Every `memberName` must belong to that domain's configured roster; one
 *      foreign name rejects the whole batch and writes nothing.
 *   3. The date is always today in IST, and (for TEs) the clock must be inside
 *      the 3–4 PM window or a Core Member's override. Honouring a client date
 *      here would let a TE quietly backfill last week — which is precisely what
 *      a fixed attendance window exists to prevent.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !canManageAttendance(session)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON.");
  }

  const parsed = parseAttendancePayload(body);
  if (!parsed.ok) return jsonError(400, parsed.error);

  const domain = resolveDomain(session, parsed.value.domain);
  const dateStr = getTodayDateIST();

  // A client that thinks it is saving a different day is out of sync with the
  // server; say so instead of silently filing the marks under today.
  if (parsed.value.date && parsed.value.date !== dateStr) {
    return forbidden(
      `Attendance can only be marked for today (${dateStr}). Reload the page.`,
    );
  }

  const authorized = authorizeChanges(
    domain,
    getDomainMembers(domain),
    parsed.value.changes,
  );
  if (!authorized.ok) return forbidden(authorized.error);

  if (!isPrivileged(session)) {
    // Inside the normal window there is nothing to look up, so the common path
    // costs no extra Sheets call — the override is only consulted when the
    // answer would otherwise be "no".
    if (!isWindowOpen(Date.now())) {
      let overrideEndMs: number;
      try {
        // Fail closed here, unlike `GET`: an unreadable override must not be
        // read as "the window is open".
        overrideEndMs = await getOverrideEndMs({ failClosed: true });
      } catch (error) {
        return failure("POST /api/attendance", error, SAVE_FAILED);
      }
      if (Date.now() > overrideEndMs) return forbidden(WINDOW_CLOSED_MESSAGE);
    }
  }

  const changes = authorized.changes;

  try {
    const result = await updateAttendance(domain, dateStr, changes, session.username);
    console.log(
      `[POST /api/attendance] ${domain} ${dateStr}: ${result.apiCalls} Sheets call(s), ` +
        `${changes.length} mark(s), ${result.written} cell range(s)`,
    );

    return NextResponse.json(
      {
        success: true,
        date: dateStr,
        domain,
        saved: changes.length,
        createdDateColumn: result.createdDateColumn,
        appendedMembers: result.appendedMembers,
        auditFailed: result.auditFailed,
        // Authoritative post-save state, computed from the grid this save
        // already read. The browser replaces its optimistic guess with this, so
        // a second TE's concurrent marks show up without another round trip.
        records: result.records,
        serverTimeMs: Date.now(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure("POST /api/attendance", error, SAVE_FAILED);
  }
}
