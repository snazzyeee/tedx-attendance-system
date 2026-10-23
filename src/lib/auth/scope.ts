/**
 * Which domain is this session allowed to act on?
 *
 * A TE gets exactly their own — the spec's headline rule. A Core Member may
 * name one, but only from `DOMAINS`, and never `Core` itself (Core Members have
 * no attendance of their own to mark, so `Core` is deliberately absent from
 * that list).
 *
 * Extracted because the same three-line decision was previously repeated in the
 * dashboard, the analytics page and the `GET` handler — and *omitted* from the
 * `POST` handler, which took the client's `domain` string unchecked. Nothing
 * exploitable followed from that, because an unknown domain yields an empty
 * roster and `authorizeChanges` then rejects every name; but "safe by accident
 * two functions downstream" is not where an authorization rule should live.
 *
 * Relative `.ts` import so this runs under `node --test` alongside its tests.
 */
import { DOMAINS } from "../../config/domains.ts";
import type { AuthSession, Domain } from "@/types";

/** The domain a session may read or write, given what it asked for. */
export function resolveDomain(
  session: AuthSession,
  requested?: string | null,
): Domain {
  if (session.role !== "Core Member") return session.domain;

  const match = DOMAINS.find(
    (d) => d.toLowerCase() === requested?.trim().toLowerCase(),
  );
  return match ?? DOMAINS[0];
}

/** Roles permitted to view and mark attendance at all (spec §5). */
export function canManageAttendance(session: AuthSession | null): boolean {
  return session?.role === "TE" || session?.role === "Core Member";
}

/** Core Members are exempt from the 3–4 PM window and own the override switch. */
export function isPrivileged(session: AuthSession): boolean {
  return session.role === "Core Member";
}
