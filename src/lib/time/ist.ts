/**
 * The attendance window, in one place.
 *
 * The window is the whole point of this app — attendance may only be marked
 * between 3 PM and 4 PM IST — so "is it open?" is answered here and nowhere
 * else. The route used to decide it with `new Date(d.toLocaleString("en-US",
 * {timeZone}))`, which round-trips through a locale string that Node is not
 * required to parse back, and the client decided it again with its own offset
 * arithmetic. Two implementations of one rule is a bug waiting for a timezone
 * to disagree.
 *
 * Pure and `import type`-only, so it runs unchanged under `node --test`, in a
 * route handler, and in the browser.
 *
 * India has no daylight saving and has held UTC+05:30 since 1947, so the fixed
 * offset below is exact — but the calendar date still comes from `Intl`, which
 * is the part that genuinely needs a timezone database.
 */

/** IST is UTC+05:30, with no daylight saving to shift it. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/** Attendance opens at 15:00 IST and closes at 16:00 IST (spec §8). */
export const WINDOW_START_HOUR = 15;
export const WINDOW_END_HOUR = 16;

const WINDOW_START_MS = WINDOW_START_HOUR * HOUR_MS;
const WINDOW_END_MS = WINDOW_END_HOUR * HOUR_MS;

/** Human-readable window, so the UI and the error messages cannot drift apart. */
export const WINDOW_LABEL = "3 PM – 4 PM IST";

export const WINDOW_CLOSED_MESSAGE = `Attendance can only be marked between ${WINDOW_LABEL}.`;

/**
 * Milliseconds since IST midnight.
 *
 * Shifting the epoch by a fixed offset and taking the remainder is exact for a
 * zone with no DST, and — unlike `toLocaleString` — cannot be defeated by a
 * locale that formats midnight as 24:00.
 */
export function msSinceMidnightIST(nowMs: number): number {
  const shifted = nowMs + IST_OFFSET_MS;
  // `%` keeps the sign of the dividend; epoch-negative inputs would otherwise
  // land before midnight.
  return ((shifted % DAY_MS) + DAY_MS) % DAY_MS;
}

/** Today's date in IST as `DD/MM/YYYY` (spec §6). */
export function getTodayDateIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);
}

export interface WindowStatus {
  open: boolean;
  /** Until close when open; until the next 3 PM when closed. Never negative. */
  remainingMs: number;
}

/**
 * Is the window open right now, and for how much longer?
 *
 * One function for both states so the countdown the TE reads and the check the
 * server enforces are computed from the same arithmetic.
 */
export function attendanceWindowStatus(nowMs: number): WindowStatus {
  const sinceMidnight = msSinceMidnightIST(nowMs);

  if (sinceMidnight < WINDOW_START_MS) {
    return { open: false, remainingMs: WINDOW_START_MS - sinceMidnight };
  }
  if (sinceMidnight < WINDOW_END_MS) {
    return { open: true, remainingMs: WINDOW_END_MS - sinceMidnight };
  }
  return { open: false, remainingMs: DAY_MS - sinceMidnight + WINDOW_START_MS };
}

/** The authorization form of the same question, for the route handler. */
export function isWindowOpen(nowMs: number): boolean {
  return attendanceWindowStatus(nowMs).open;
}

/** `2h 5m 09s`, for a countdown. Clamps at zero rather than showing `-1m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
    : `${minutes}m ${pad(seconds)}s`;
}
