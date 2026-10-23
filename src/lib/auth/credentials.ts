/**
 * Password verification for TE logins (spec §5, §12).
 *
 * A user's password lives in one of two places: the `Passwords` worksheet once
 * they have changed it, otherwise the per-domain default in `config/auth.ts`.
 * The override always wins.
 *
 * `getPasswordOverrides()` deliberately rethrows anything other than "the
 * Passwords tab does not exist", so a Sheets outage makes login fail closed
 * rather than silently falling back to a password the user already replaced.
 */
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { INITIAL_PASSWORDS } from "@/config/auth";
import { getPasswordOverrides } from "@/lib/google-sheets";
import type { Domain } from "@/types";

/**
 * A bcrypt hash of a value nobody knows, compared against when a user has no
 * override. Without it, "this account has changed its password" would be
 * observable from response timing alone.
 */
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still burn a comparison so the early exit isn't a length oracle.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Is `candidate` the current password for `username`?
 *
 * Throws if the password store cannot be read — callers must let that surface
 * as a 503 rather than treating it as a failed login.
 */
export async function verifyPassword(
  username: string,
  domain: Domain,
  candidate: string,
): Promise<boolean> {
  const overrides = await getPasswordOverrides();
  const hash = overrides[username.trim().toLowerCase()];

  if (hash) return bcrypt.compare(candidate, hash);

  await bcrypt.compare(candidate, DUMMY_HASH);
  const initial = INITIAL_PASSWORDS[domain];
  if (!initial) return false;
  return constantTimeEquals(candidate, initial);
}

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 10);
}
