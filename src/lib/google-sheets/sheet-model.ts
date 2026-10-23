/**
 * Pure Google-Sheets logic. No network, no config imports, no framework.
 *
 * Everything this module needs is passed in as an argument, which keeps the
 * interesting decisions (where does today's column go? which cells does a save
 * actually touch?) unit-testable without credentials — see `sheet-model.test.ts`.
 *
 * Only `import type` is used, so Node's type-stripping erases every import and
 * the file runs directly under `node --test`.
 */
import type {
  AttendanceChange,
  AttendanceRecord,
  AttendanceState,
  DateStat,
  Domain,
  DomainAnalytics,
  Member,
  MemberStat,
} from "@/types";

export const ATTENDANCE_SHEET = "Attendance";
export const PASSWORDS_SHEET = "Passwords";
/** Optional append-only trail. A save succeeds whether or not this tab exists. */
export const AUDIT_SHEET = "Audit Log";

/** Unit separator; cannot occur in a member name or domain. */
const KEY_SEPARATOR = String.fromCharCode(31);

/** Column A = Member Name, Column B = Domain, C onwards = dates (spec §3). */
export const NAME_COL = 0;
export const DOMAIN_COL = 1;
export const FIRST_DATE_COL = 2;

export const HEADER_ROW = ["Member Name", "Domain"];

/**
 * `values.get` returns ragged rows of unknown cell types, so the model treats
 * the grid defensively rather than trusting a fixed width.
 */
export type SheetRows = unknown[][];

export interface WriteCell {
  range: string;
  values: string[][];
}

export interface WritePlan {
  /** Cells to send in a single `values.batchUpdate` call. */
  data: WriteCell[];
  dateColumnIndex: number;
  createdDateColumn: boolean;
  /** Config members that were missing from the sheet and got appended. */
  appendedMembers: string[];
  /** True when the sheet was empty and the plan seeds headers + roster. */
  seededSheet: boolean;
}

export interface ParsedSheet {
  headers: string[];
  /** Date header -> 0-based column index. */
  dateColumnIndex: Map<string, number>;
  /** Date headers in column order. */
  dateColumns: string[];
  /** `memberKey(name, domain)` -> 0-based row index into `rows`. */
  rowIndexByMember: Map<string, number>;
  /** Widest row (or header) seen, so new columns never land on used cells. */
  width: number;
}

/** Convert a 0-based column index to a sheet letter (0 -> A, 26 -> AA). */
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid column index: ${index}`);
  }
  let column = index;
  let letter = "";
  while (column >= 0) {
    const remainder = column % 26;
    letter = String.fromCharCode(remainder + 65) + letter;
    column = (column - remainder - 26) / 26;
  }
  return letter;
}

/** A1 notation for a single cell, quoted so sheet names with spaces work. */
export function cellRange(
  sheetName: string,
  columnIndex: number,
  rowIndex: number,
): string {
  return `'${sheetName}'!${columnLetter(columnIndex)}${rowIndex + 1}`;
}

/**
 * Identity of a sheet row.
 *
 * Uses a non-printable separator so a name that happens to end with a
 * domain-like word can never collide with a different name/domain pair.
 */
export function memberKey(name: string, domain: string): string {
  return normalise(name) + KEY_SEPARATOR + normalise(domain);
}

function normalise(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : String(value ?? "").trim().toLowerCase();
}

function cellText(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

/**
 * Read a cell as attendance state.
 *
 * Spec §7A: only an explicit "Present" counts as present. Empty, missing, and
 * anything unrecognised are Absent. Casing is tolerated so a mark typed by hand
 * into the sheet still reads correctly.
 */
export function parseState(value: unknown): AttendanceState {
  return normalise(value) === "present" ? "Present" : "Absent";
}

export function parseSheet(rows: SheetRows): ParsedSheet {
  const headers = (rows[0] ?? []).map(cellText);
  const dateColumnIndex = new Map<string, number>();
  const dateColumns: string[] = [];

  for (let col = FIRST_DATE_COL; col < headers.length; col++) {
    const header = headers[col];
    // Skip blank spacer columns; keep the first occurrence of a duplicate so a
    // pre-existing duplicate never causes us to add a third (spec §6).
    if (!header || dateColumnIndex.has(header)) continue;
    dateColumnIndex.set(header, col);
    dateColumns.push(header);
  }

  const rowIndexByMember = new Map<string, number>();
  let width = headers.length;

  for (let row = 1; row < rows.length; row++) {
    const cells = rows[row] ?? [];
    width = Math.max(width, cells.length);
    const name = cellText(cells[NAME_COL]);
    if (!name) continue;
    const key = memberKey(name, cellText(cells[DOMAIN_COL]));
    if (!rowIndexByMember.has(key)) rowIndexByMember.set(key, row);
  }

  return {
    headers,
    dateColumnIndex,
    dateColumns,
    rowIndexByMember,
    width: Math.max(width, FIRST_DATE_COL),
  };
}

/**
 * Resolve today's date column (spec §6/§13 `getTodayColumn`).
 * Returns -1 when the column does not exist yet.
 */
export function findDateColumn(rows: SheetRows, dateStr: string): number {
  const parsed = parseSheet(rows);
  return parsed.dateColumnIndex.get(dateStr.trim()) ?? -1;
}

/**
 * Build the attendance list for a set of members on one date.
 *
 * Members drive the output, so ordering follows configuration (spec §4) and a
 * member absent from the sheet still renders — as Absent — instead of vanishing.
 */
export function readAttendance(
  rows: SheetRows,
  members: Member[],
  dateStr: string,
): AttendanceRecord[] {
  const parsed = parseSheet(rows);
  const dateCol = parsed.dateColumnIndex.get(dateStr.trim()) ?? -1;

  return members.map((member) => {
    let state: AttendanceState = "Absent";
    if (dateCol !== -1) {
      const rowIndex = parsed.rowIndexByMember.get(
        memberKey(member.name, member.domain),
      );
      if (rowIndex !== undefined) {
        state = parseState((rows[rowIndex] ?? [])[dateCol]);
      }
    }
    return {
      memberName: member.name,
      domain: member.domain,
      role: member.role,
      state,
    };
  });
}

/**
 * The attendance list as it will read *after* `changes` are applied.
 *
 * A save already holds the grid it planned against, so the authoritative
 * post-write state costs no extra Sheets call to produce — and unlike the
 * browser's optimistic guess it also carries marks another TE made since this
 * page was loaded. Returning this from the save is what stops two TEs working
 * the same domain from drifting apart (spec §15) without paying for a re-read.
 */
export function projectAttendance(
  rows: SheetRows,
  members: Member[],
  dateStr: string,
  changes: AttendanceChange[],
): AttendanceRecord[] {
  const applied = new Map<string, AttendanceState>();
  for (const change of changes) applied.set(normalise(change.memberName), change.state);

  return readAttendance(rows, members, dateStr).map((record) => {
    const state = applied.get(normalise(record.memberName));
    return state === undefined ? record : { ...record, state };
  });
}

/**
 * Work out the exact cells one save must write.
 *
 * This is the fix for spec §7 ("should not unnecessarily create multiple API
 * requests"): the caller sends the whole plan as a single `values.batchUpdate`,
 * so a save costs one read plus one write no matter how many members changed.
 *
 * It is also the fix for §15 ("avoid blindly overwriting unrelated members'
 * attendance"): only members named in `changes` get a date cell, so a
 * concurrent TE editing different members is never clobbered.
 */
export function buildWritePlan(params: {
  rows: SheetRows;
  /** Full configured roster, used for seeding order (spec §4). */
  roster: Member[];
  dateStr: string;
  changes: AttendanceChange[];
  /** Domain the changes belong to; already authorised by the caller. */
  domain: Domain;
  sheetName?: string;
}): WritePlan {
  const { rows, roster, changes, domain } = params;
  const sheetName = params.sheetName ?? ATTENDANCE_SHEET;
  const dateStr = params.dateStr.trim();

  const data: WriteCell[] = [];
  const appendedMembers: string[] = [];
  const seededSheet = rows.length === 0;

  // Row bookkeeping starts from the sheet as it is, then absorbs anything this
  // plan is about to add, so ranges stay correct within a single batch.
  const parsed = parseSheet(rows);
  const rowIndexByMember = new Map(parsed.rowIndexByMember);
  let nextRowIndex = Math.max(rows.length, 1);
  let width = parsed.width;

  if (seededSheet) {
    // Fresh sheet: lay down the header and the entire roster in config order so
    // the sheet's ordering matches the spec from the very first write (spec §4).
    data.push({
      range: `'${sheetName}'!A1:B1`,
      values: [HEADER_ROW],
    });
    if (roster.length > 0) {
      data.push({
        range: `'${sheetName}'!A2:B${roster.length + 1}`,
        values: roster.map((m) => [m.name, m.domain]),
      });
    }
    roster.forEach((m, i) => {
      rowIndexByMember.set(memberKey(m.name, m.domain), i + 1);
    });
    nextRowIndex = roster.length + 1;
    width = FIRST_DATE_COL;
  }

  // Place today's column: reuse it when present, never duplicate it (spec §6).
  let dateColumnIndex = parsed.dateColumnIndex.get(dateStr) ?? -1;
  const createdDateColumn = dateColumnIndex === -1;
  if (createdDateColumn) {
    dateColumnIndex = Math.max(width, FIRST_DATE_COL);
    data.push({
      range: cellRange(sheetName, dateColumnIndex, 0),
      values: [[dateStr]],
    });
  }

  const rosterByName = new Map(
    roster.map((m) => [memberKey(m.name, m.domain), m]),
  );

  // Last write wins per member, so a duplicate submission can't produce two
  // conflicting writes to the same cell inside one batch (spec §15).
  const deduped = new Map<string, AttendanceState>();
  for (const change of changes) {
    deduped.set(change.memberName, change.state);
  }

  for (const [memberName, state] of deduped) {
    const key = memberKey(memberName, domain);
    let rowIndex = rowIndexByMember.get(key);

    if (rowIndex === undefined) {
      // Configured member with no row yet (spec §15 "member exists in config
      // but not sheet"). Append rather than reorder: rewriting column A/B to
      // force config order would move existing attendance data with it.
      const member = rosterByName.get(key);
      if (!member) continue;
      rowIndex = nextRowIndex;
      nextRowIndex += 1;
      rowIndexByMember.set(key, rowIndex);
      appendedMembers.push(member.name);
      data.push({
        range: `'${sheetName}'!A${rowIndex + 1}:B${rowIndex + 1}`,
        values: [[member.name, member.domain]],
      });
    }

    data.push({
      range: cellRange(sheetName, dateColumnIndex, rowIndex),
      values: [[state]],
    });
  }

  return {
    data,
    dateColumnIndex,
    createdDateColumn,
    appendedMembers,
    seededSheet,
  };
}

/**
 * Domain analytics across every recorded date (spec §10).
 *
 * `members` must already be filtered to the caller's domain — that filtering is
 * what keeps a Curation TE from ever seeing Marketing numbers.
 */
export function computeAnalytics(
  rows: SheetRows,
  members: Member[],
  domain: Domain,
  todayStr: string,
): DomainAnalytics {
  const parsed = parseSheet(rows);
  const today = todayStr.trim();
  const dates = parsed.dateColumns;
  const todayRecorded = parsed.dateColumnIndex.has(today);

  const memberStates = members.map((member) => {
    const rowIndex = parsed.rowIndexByMember.get(
      memberKey(member.name, member.domain),
    );
    const row = rowIndex === undefined ? [] : (rows[rowIndex] ?? []);
    const states = dates.map((date) =>
      parseState(row[parsed.dateColumnIndex.get(date) as number]),
    );
    return { member, states };
  });

  const memberStats: MemberStat[] = memberStates.map(({ member, states }) => {
    const present = states.filter((s) => s === "Present").length;
    return {
      memberName: member.name,
      role: member.role,
      present,
      total: dates.length,
      percentage: percent(present, dates.length),
    };
  });

  const dateStats: DateStat[] = dates.map((date, i) => {
    const present = memberStates.filter((m) => m.states[i] === "Present").length;
    return {
      date,
      present,
      absent: members.length - present,
      percentage: percent(present, members.length),
    };
  });

  const todayStat = dateStats.find((d) => d.date === today);
  const presentToday = todayStat?.present ?? 0;
  const totalPresent = memberStats.reduce((sum, m) => sum + m.present, 0);

  return {
    domain,
    today,
    totalMembers: members.length,
    presentToday,
    absentToday: members.length - presentToday,
    todayPercentage: percent(presentToday, members.length),
    todayRecorded,
    overallPercentage: percent(totalPresent, members.length * dates.length),
    memberStats,
    dateStats,
  };
}

/** Percentage rounded to one decimal place; 0 when there is nothing to divide. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Row key under which the Core Members' override window stores its expiry.
 *
 * It shares the `Passwords` tab because that tab already exists and already
 * needs a write path — but it is emphatically not a credential, so
 * `parsePasswordRows` filters it out. Otherwise a member who happened to be
 * named `__override_end__` would have a timestamp sitting in the hash column,
 * and the password map would be quietly carrying a non-password.
 */
export const OVERRIDE_KEY = "__override_end__";

/** Keys in the Passwords tab that are app state rather than someone's password. */
const RESERVED_KEYS = new Set([OVERRIDE_KEY, "username"]);

/**
 * Parse the `Passwords` tab into `username -> bcrypt hash`.
 *
 * Keys are lower-cased so a lookup matches however the name was typed into the
 * sheet. Tolerates a missing header row by skipping only a row that literally
 * looks like one, so the first real user's override is never silently dropped.
 */
export function parsePasswordRows(rows: SheetRows): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const row of rows) {
    const username = cellText((row ?? [])[0]);
    const hash = cellText((row ?? [])[1]);
    if (!username || !hash) continue;
    const key = normalise(username);
    if (RESERVED_KEYS.has(key)) continue;
    overrides[key] = hash;
  }
  return overrides;
}

/**
 * Epoch milliseconds at which the override window expires, or 0.
 *
 * Anything unparseable reads as 0 — "no override" — which is the closed,
 * safe answer.
 */
export function parseOverrideEnd(rows: SheetRows): number {
  for (const row of rows) {
    if (normalise((row ?? [])[0]) !== OVERRIDE_KEY) continue;
    const value = Number.parseInt(cellText((row ?? [])[1]), 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  return 0;
}

/** Row index (0-based) of `username` in the Passwords tab, or -1. */
export function findPasswordRow(rows: SheetRows, username: string): number {
  for (let i = 0; i < rows.length; i++) {
    if (normalise((rows[i] ?? [])[0]) === normalise(username)) return i;
  }
  return -1;
}
