import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MEMBERS } from "@/config/members";
import { verifyPassword } from "@/lib/auth/credentials";
import { setSession } from "@/lib/auth/session";
import { failure, jsonError, tooManyRequests } from "@/lib/api/http";
import { clientIpFrom, loginLimiter, rateLimitKey } from "@/lib/rate-limit";
import { parseLoginPayload } from "@/lib/validation";

/**
 * One message for every credential failure.
 *
 * Distinguishing "no such TE" from "wrong password" would let an attacker
 * enumerate valid accounts for free before starting to guess.
 */
const INVALID = "Invalid name or password.";

const blockedMessage = (seconds: number) =>
  `Too many failed login attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`;

/**
 * Record a failed attempt and answer it.
 *
 * Both failure paths — no such TE, and wrong password — go through here, so the
 * response to the attempt that trips the limiter is identical either way. If
 * only one path returned `429`, the difference would tell an attacker which
 * names are real, which is the enumeration leak `INVALID` exists to close.
 */
function rejectAttempt(key: string) {
  const after = loginLimiter.recordFailure(key);
  if (!after.allowed) {
    return tooManyRequests(after.retryAfterSeconds, blockedMessage(after.retryAfterSeconds));
  }
  return jsonError(401, INVALID);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON.");
  }

  const parsed = parseLoginPayload(body);
  if (!parsed.ok) return jsonError(400, parsed.error);

  const { username, password } = parsed.value;
  const key = rateLimitKey(clientIpFrom(request.headers), username);

  const limit = loginLimiter.check(key);
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds, blockedMessage(limit.retryAfterSeconds));
  }

  // The domain comes from the roster entry, never from the request body — so a
  // client cannot pair a real name with someone else's domain (spec §2).
  const member = MEMBERS.find(
    (m) => m.name.toLowerCase() === username.toLowerCase(),
  );

  if (!member || (member.role !== "TE" && member.role !== "Core Member")) {
    // Only TEs and Core Members manage attendance. An SE name is a failed credential
    // rather than a 403, so the response cannot confirm the name exists.
    return rejectAttempt(key);
  }

  let valid: boolean;
  try {
    valid = await verifyPassword(member.name, member.domain, password);
  } catch (error) {
    // Fail closed: an unreadable password store must never grant access. The
    // detail stays in the server log — this route is reachable without a
    // session, and Google's messages can name the spreadsheet and the service
    // account.
    return failure(
      "POST /api/auth/login",
      error,
      "Unable to verify your password right now. Please try again in a moment.",
      { exposeDetail: false },
    );
  }

  if (!valid) return rejectAttempt(key);

  loginLimiter.reset(key);
  await setSession({
    username: member.name,
    domain: member.domain,
    role: member.role,
  });

  return NextResponse.json({
    success: true,
    domain: member.domain,
    username: member.name,
  });
}
