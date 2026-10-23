/**
 * Google Sheets service layer (spec §13).
 *
 * These are the functions the rest of the app calls. Each one binds the real
 * network client and the configured roster to the pure logic in
 * `sheet-model.ts`, so route handlers never see a range string or a column
 * index. The same functions with a fake client live in `attendance-service.ts`.
 */
import { MEMBERS } from "@/config/members";
import type {
  AttendanceChange,
  AttendanceRecord,
  Domain,
  DomainAnalytics,
  Member,
} from "@/types";
import { getSheetsClient } from "./client";
import { isSheetsErrorKind } from "./errors";
import * as service from "./attendance-service";
import type { SaveResult } from "./attendance-service";
import type { SheetRows } from "./sheet-model";

export { SheetsError, classifyError } from "./errors";
export type { SheetsErrorKind } from "./errors";
export type { SheetsClient } from "./client";
export { getTodayDateIST } from "./attendance-service";

/** Full configured roster, in the fixed display order (spec §4). */
export function getMembers(): Member[] {
  return MEMBERS;
}

/**
 * Members of one domain, in configured order.
 *
 * This is the single source of truth for "which members may this session
 * touch?" — the routes build their allow-list from it, which is what makes the
 * spec's headline rule (a TE manages only their own domain) an authorization
 * check rather than a UI restriction.
 */
export function getDomainMembers(domain: Domain): Member[] {
  return MEMBERS.filter((m) => m.domain === domain);
}

/** Raw grid, mostly useful for debugging and the analytics page. */
export function getSheetData(sheetName?: string): Promise<SheetRows> {
  return service.getSheetData(getSheetsClient(), sheetName);
}

/** Index of today's date column, or -1 if it has not been created yet. */
export function getTodayColumn(dateStr: string): Promise<number> {
  return service.getTodayColumn(getSheetsClient(), dateStr);
}

/** Create today's date column if missing; returns its index either way. */
export function createDateColumn(dateStr: string): Promise<number> {
  return service.createDateColumn(getSheetsClient(), dateStr);
}

/**
 * Attendance for one domain on one date.
 *
 * Every configured member of the domain appears, defaulting to Absent, so a
 * member who has no sheet row yet is still shown and can still be marked.
 */
export function getAttendance(
  domain: Domain,
  dateStr: string,
): Promise<AttendanceRecord[]> {
  return service.getAttendance(getSheetsClient(), getDomainMembers(domain), dateStr);
}

/**
 * Save attendance marks for one domain.
 *
 * Costs one `values.get` plus one `values.batchUpdate` no matter how many
 * members changed (spec §7), and writes cells only for the members named in
 * `changes` so a concurrent TE's marks survive (spec §15).
 *
 * `changes` must already be authorised against `domain` by the caller.
 */
export function updateAttendance(
  domain: Domain,
  dateStr: string,
  changes: AttendanceChange[],
  teName: string,
): Promise<SaveResult> {
  return service.updateAttendance(getSheetsClient(), {
    roster: getDomainMembers(domain),
    domain,
    dateStr,
    changes,
    teName,
  });
}

/** Analytics for one domain only — other domains' rows never leave the server. */
export function getDomainAnalytics(
  domain: Domain,
  todayStr: string,
): Promise<DomainAnalytics> {
  return service.getDomainAnalytics(
    getSheetsClient(),
    getDomainMembers(domain),
    domain,
    todayStr,
  );
}

/**
 * Changed passwords as `username -> bcrypt hash`.
 *
 * Returns `{}` **only** when the Passwords tab genuinely does not exist. Any
 * other failure rethrows, so login fails closed with a 503 instead of silently
 * accepting a password the user has already replaced.
 */
export async function getPasswordOverrides(): Promise<Record<string, string>> {
  try {
    return await service.getPasswordOverrides(getSheetsClient());
  } catch (error) {
    if (isSheetsErrorKind(error, "missing-tab")) return {};
    throw error;
  }
}

export function updatePassword(
  username: string,
  hashedPassword: string,
): Promise<void> {
  return service.updatePassword(getSheetsClient(), username, hashedPassword);
}

/**
 * When the Core Members' override window expires, in epoch ms. 0 means closed.
 *
 * Two callers with opposite needs, so the failure mode is a parameter:
 *  - `GET /api/attendance` only wants it to render a banner. A Sheets hiccup
 *    there should not take the whole roster down with it, so the default
 *    degrades to "no override" — which shows *less* access, never more.
 *  - `POST /api/attendance` uses it to decide an out-of-hours write. That one
 *    passes `failClosed` so an unreadable sheet is an error rather than a
 *    silently open door.
 *
 * A genuinely absent `Passwords` tab is "no override" either way: nobody has
 * ever started one.
 */
export async function getOverrideEndMs(
  options: { failClosed?: boolean } = {},
): Promise<number> {
  try {
    return await service.getOverrideEndMs(getSheetsClient());
  } catch (error) {
    if (isSheetsErrorKind(error, "missing-tab")) return 0;
    if (options.failClosed) throw error;
    console.error("[getOverrideEndMs] falling back to no override:", error);
    return 0;
  }
}

/** Open the override window until `endMs`, or close it with 0. */
export function setOverrideEndMs(endMs: number): Promise<void> {
  return service.setOverrideEndMs(getSheetsClient(), endMs);
}

export type { SaveResult };
