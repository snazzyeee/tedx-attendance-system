/**
 * Request-payload validation (spec §12 "Validate user inputs", §16 `lib/validation/`).
 *
 * Pure and dependency-free — only `import type`, so these functions run under
 * `node --test` with no build step, and every validator is exercised directly
 * in `index.test.ts`.
 *
 * Scope is deliberately narrow: shape, type, and length. Whether a member or
 * domain actually *exists*, and whether this session may touch it, is decided
 * in the route against config — keeping authorization in exactly one place
 * instead of splitting it across two modules.
 */
import type { AttendanceChange, AttendanceState } from "@/types";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_FIELD = 200;
/** bcrypt silently truncates beyond 72 bytes, so accepting more is misleading. */
const MAX_PASSWORD = 72;
const MIN_PASSWORD = 8;

function ok<T>(value: T): Validated<T> {
  return { ok: true, value };
}

function fail<T>(error: string): Validated<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A trimmed non-empty string, or null. */
function text(value: unknown, max = MAX_FIELD): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export function isAttendanceState(value: unknown): value is AttendanceState {
  return value === "Present" || value === "Absent";
}

/** `DD/MM/YYYY`, checked against the real calendar so 31/02 is rejected. */
export function isValidDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export function parseLoginPayload(body: unknown): Validated<LoginPayload> {
  if (!isRecord(body)) return fail("Request body must be a JSON object.");

  const username = text(body.username);
  if (!username) return fail("Name is required.");

  // Length-checked but not complexity-checked: rejecting an existing password
  // for weakness would lock a real TE out of a system they already use.
  if (typeof body.password !== "string" || body.password.length === 0) {
    return fail("Password is required.");
  }
  if (body.password.length > MAX_PASSWORD) {
    return fail(`Password must be at most ${MAX_PASSWORD} characters.`);
  }

  return ok({ username, password: body.password });
}

export interface AttendancePayload {
  /** Optional; the route falls back to today in IST. */
  date: string | null;
  domain?: string | null;
  changes: AttendanceChange[];
}

/**
 * Parse an attendance save.
 *
 * `domain` and `date` are carried through as *requests*, never as decisions.
 * The route resolves the domain against the session (`resolveDomain`) and takes
 * the date from the server clock, so a forged field here can at most produce a
 * 403 — it can never redirect a write (spec §2/§12).
 */
export function parseAttendancePayload(body: unknown): Validated<AttendancePayload> {
  if (!isRecord(body)) return fail("Request body must be a JSON object.");

  const raw = body.changes ?? body.records;
  if (!Array.isArray(raw)) {
    return fail("`changes` must be an array of attendance marks.");
  }
  if (raw.length === 0) return fail("No attendance changes were submitted.");
  if (raw.length > 500) return fail("Too many attendance changes in one request.");

  const changes: AttendanceChange[] = [];
  for (const [i, entry] of raw.entries()) {
    if (!isRecord(entry)) return fail(`Change at position ${i + 1} is not an object.`);
    const memberName = text(entry.memberName);
    if (!memberName) return fail(`Change at position ${i + 1} is missing a member name.`);
    if (!isAttendanceState(entry.state)) {
      return fail(`Change for "${memberName}" must have state "Present" or "Absent".`);
    }
    changes.push({ memberName, state: entry.state });
  }

  let date: string | null = null;
  if (body.date !== undefined && body.date !== null) {
    if (!isValidDateString(body.date)) {
      return fail("`date` must be a real date in DD/MM/YYYY format.");
    }
    date = (body.date as string).trim();
  }
  
  let domain: string | null = null;
  if (typeof body.domain === "string") {
    domain = body.domain.trim();
  }

  return ok({ date, changes, domain });
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export function parseChangePasswordPayload(
  body: unknown,
): Validated<ChangePasswordPayload> {
  if (!isRecord(body)) return fail("Request body must be a JSON object.");

  if (typeof body.currentPassword !== "string" || body.currentPassword.length === 0) {
    return fail("Current password is required.");
  }
  if (typeof body.newPassword !== "string") {
    return fail("New password is required.");
  }
  if (body.newPassword.length < MIN_PASSWORD) {
    return fail(`New password must be at least ${MIN_PASSWORD} characters.`);
  }
  if (body.newPassword.length > MAX_PASSWORD) {
    return fail(`New password must be at most ${MAX_PASSWORD} characters.`);
  }
  if (body.newPassword === body.currentPassword) {
    return fail("New password must be different from the current password.");
  }

  return ok({
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });
}
