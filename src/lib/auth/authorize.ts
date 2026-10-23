/**
 * Domain authorization for attendance writes (spec §2, §12).
 *
 * Pure and type-import-only, so the spec's headline rule — "the backend must
 * reject a request attempting to access another domain's data" — is asserted by
 * unit tests instead of being trusted to a route handler that needs a live
 * session, a live sheet, and the Next runtime to exercise.
 *
 * The route stays a thin adapter: session in, this decision, HTTP status out.
 */
import type { AttendanceChange, Domain, Member } from "@/types";

export type AuthorizedChanges =
  | { ok: true; changes: AttendanceChange[] }
  | { ok: false; error: string };

/**
 * Check every requested change against the caller's own roster.
 *
 * All-or-nothing on purpose: one foreign name rejects the whole submission, so a
 * partially-valid payload can never half-apply to the sheet.
 *
 * Names are matched case-insensitively but rewritten to the configured spelling,
 * so a client sending "curation se 1" updates the existing row rather than
 * creating a second one for the same person.
 */
export function authorizeChanges(
  domain: Domain,
  roster: Member[],
  changes: AttendanceChange[],
): AuthorizedChanges {
  const allowed = new Map(roster.map((m) => [m.name.trim().toLowerCase(), m.name]));

  const authorized: AttendanceChange[] = [];
  for (const change of changes) {
    const canonical = allowed.get(change.memberName.trim().toLowerCase());
    if (!canonical) {
      return {
        ok: false,
        error: `"${change.memberName}" is not a member of ${domain}. You can only mark attendance for your own domain.`,
      };
    }
    authorized.push({ memberName: canonical, state: change.state });
  }

  return { ok: true, changes: authorized };
}
