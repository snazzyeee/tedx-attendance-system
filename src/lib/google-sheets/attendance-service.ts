/**
 * Attendance operations against a `SheetsClient`.
 *
 * The client is an explicit parameter rather than a module import so these
 * functions can be driven by a fake in tests — which is how the "one API call
 * per save" guarantee (spec §7) is actually asserted rather than assumed.
 *
 * Relative imports carry the `.ts` extension so the same files run unchanged
 * under `node --test` (Node's ESM resolver needs the extension) and under
 * Turbopack.
 */
import type { SheetsClient } from "./client.ts";
import { SheetsError, isSheetsErrorKind } from "./errors.ts";
import {
  ATTENDANCE_SHEET,
  AUDIT_SHEET,
  PASSWORDS_SHEET,
  buildWritePlan,
  cellRange,
  computeAnalytics,
  findDateColumn,
  findPasswordRow,
  OVERRIDE_KEY,
  parseOverrideEnd,
  parsePasswordRows,
  projectAttendance,
  readAttendance,
} from "./sheet-model.ts";
import type { SheetRows } from "./sheet-model.ts";
import type {
  AttendanceChange,
  AttendanceRecord,
  Domain,
  DomainAnalytics,
  Member,
} from "@/types";

/** Whole grid. `A:ZZ` comfortably covers name + domain + years of dates. */
const FULL_RANGE = (sheet: string) => `'${sheet}'!A:ZZ`;

/**
 * Current date in IST as DD/MM/YYYY (spec §6: Asia/Kolkata is operational).
 *
 * Re-exported rather than reimplemented: `lib/time/ist.ts` owns every
 * IST question the app asks, so the date a save is filed under and the window
 * that save is allowed in can never be computed from different clocks.
 */
export { getTodayDateIST } from "../time/ist.ts";

export function getSheetData(
  client: SheetsClient,
  sheetName: string = ATTENDANCE_SHEET,
): Promise<SheetRows> {
  return client.getValues(FULL_RANGE(sheetName));
}

/** Today's date column index, or -1 if it does not exist yet (spec §13). */
export async function getTodayColumn(
  client: SheetsClient,
  dateStr: string,
): Promise<number> {
  return findDateColumn(await getSheetData(client), dateStr);
}

/**
 * Add a date column header if absent (spec §13 `createDateColumn`).
 * Returns the column index either way, and never creates a duplicate (spec §6).
 */
export async function createDateColumn(
  client: SheetsClient,
  dateStr: string,
): Promise<number> {
  const rows = await getSheetData(client);
  const plan = buildWritePlan({
    rows,
    roster: [],
    dateStr,
    changes: [],
    domain: "Curation",
  });
  if (plan.createdDateColumn) {
    await client.batchUpdate([
      { range: cellRange(ATTENDANCE_SHEET, plan.dateColumnIndex, 0), values: [[dateStr]] },
    ]);
  }
  return plan.dateColumnIndex;
}

/** Live attendance for one domain on one date. One read, no writes. */
export async function getAttendance(
  client: SheetsClient,
  members: Member[],
  dateStr: string,
): Promise<AttendanceRecord[]> {
  return readAttendance(await getSheetData(client), members, dateStr);
}

export interface SaveResult {
  written: number;
  createdDateColumn: boolean;
  appendedMembers: string[];
  auditFailed: boolean;
  /** Sheets requests this save actually issued, for the server log. */
  apiCalls: number;
  /**
   * The domain's attendance as it now reads, derived from the grid this save
   * already fetched. Lets the browser replace its optimistic guess with the
   * truth — including another TE's concurrent marks — for free.
   */
  records: AttendanceRecord[];
}

/**
 * Persist a set of attendance marks.
 *
 * Exactly two Sheets requests regardless of how many members changed: one read
 * to locate rows/columns, one `values.batchUpdate` to write them (spec §7).
 * Cells for members not named in `changes` are never included, so a concurrent
 * TE's marks survive (spec §15).
 */
export async function updateAttendance(
  client: SheetsClient,
  params: {
    roster: Member[];
    domain: Domain;
    dateStr: string;
    changes: AttendanceChange[];
    teName?: string;
  },
): Promise<SaveResult> {
  const rows = await getSheetData(client);
  const plan = buildWritePlan({ rows, ...params });
  let apiCalls = 1;

  if (plan.data.length > 0) {
    await client.batchUpdate(plan.data);
    apiCalls += 1;
  }

  // Audit trail. Appended after the save so a missing tab can never cost the
  // attendance write itself — the mark is the product, the log is the receipt.
  let auditFailed = false;
  if (params.teName && params.changes.length > 0) {
    const timestamp = new Date().toISOString();
    const auditRows = params.changes.map((c) => [
      timestamp,
      params.teName ?? "Unknown",
      c.memberName,
      c.state,
      params.dateStr,
    ]);

    try {
      await client.appendValues(`'${AUDIT_SHEET}'!A:E`, auditRows);
      apiCalls += 1;
    } catch (error) {
      console.warn(
        `Failed to write to the "${AUDIT_SHEET}" tab. Does it exist?`,
        error,
      );
      auditFailed = true;
    }
  }

  return {
    written: plan.data.length,
    createdDateColumn: plan.createdDateColumn,
    appendedMembers: plan.appendedMembers,
    auditFailed,
    apiCalls,
    records: projectAttendance(rows, params.roster, params.dateStr, params.changes),
  };
}

/** Domain-scoped analytics (spec §10). `members` must already be filtered. */
export async function getDomainAnalytics(
  client: SheetsClient,
  members: Member[],
  domain: Domain,
  todayStr: string,
): Promise<DomainAnalytics> {
  const rows = await getSheetData(client);
  return computeAnalytics(rows, members, domain, todayStr);
}

/**
 * Changed passwords, as `username -> bcrypt hash`.
 *
 * Deliberately does NOT swallow errors: a caller that treats an outage as "no
 * overrides" would accept the superseded config password. Only a genuinely
 * absent tab yields an empty map, and that is decided by the caller.
 */
export async function getPasswordOverrides(
  client: SheetsClient,
): Promise<Record<string, string>> {
  return parsePasswordRows(await getSheetData(client, PASSWORDS_SHEET));
}

/** Expiry of the Core Members' override window, in epoch ms; 0 when inactive. */
export async function getOverrideEndMs(client: SheetsClient): Promise<number> {
  return parseOverrideEnd(await getSheetData(client, PASSWORDS_SHEET));
}

/** Open the override window until `endMs`, or close it with 0. */
export function setOverrideEndMs(
  client: SheetsClient,
  endMs: number,
): Promise<void> {
  return updatePassword(client, OVERRIDE_KEY, String(endMs));
}

/** Upsert one user's password hash on the Passwords tab. */
export async function updatePassword(
  client: SheetsClient,
  username: string,
  hashedPassword: string,
): Promise<void> {
  let rows: SheetRows;
  try {
    rows = await getSheetData(client, PASSWORDS_SHEET);
  } catch (error) {
    if (!isSheetsErrorKind(error, "missing-tab")) throw error;
    // `values.batchUpdate` can write into a tab but cannot create one, so a
    // missing tab needs an operator rather than a silent retry.
    throw new SheetsError(
      "config",
      `The "${PASSWORDS_SHEET}" worksheet does not exist. Add a tab named "${PASSWORDS_SHEET}" with columns Username and HashedPassword.`,
      { cause: error },
    );
  }

  const existing = findPasswordRow(rows, username);
  if (existing !== -1) {
    await client.batchUpdate([
      { range: cellRange(PASSWORDS_SHEET, 1, existing), values: [[hashedPassword]] },
    ]);
    return;
  }

  const writes = [];
  if (rows.length === 0) {
    writes.push({
      range: `'${PASSWORDS_SHEET}'!A1:B1`,
      values: [["Username", "HashedPassword"]],
    });
  }
  const rowIndex = Math.max(rows.length, 1);
  writes.push({
    range: `'${PASSWORDS_SHEET}'!A${rowIndex + 1}:B${rowIndex + 1}`,
    values: [[username, hashedPassword]],
  });
  await client.batchUpdate(writes);
}
