import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/auth/credentials";
import { clearSession, getSession } from "@/lib/auth/session";
import { updatePassword } from "@/lib/google-sheets";
import { failure, jsonError, tooManyRequests, unauthorized } from "@/lib/api/http";
import { clientIpFrom, passwordChangeLimiter, rateLimitKey } from "@/lib/rate-limit";
import { parseChangePasswordPayload } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON.");
  }

  const parsed = parseChangePasswordPayload(body);
  if (!parsed.ok) return jsonError(400, parsed.error);

  // Rate-limited too: a valid session plus unlimited guesses is a way to brute
  // force the current password of an already-open browser.
  const key = rateLimitKey(clientIpFrom(request.headers), session.username);
  const limit = passwordChangeLimiter.check(key);
  if (!limit.allowed) {
    return tooManyRequests(
      limit.retryAfterSeconds,
      "Too many attempts. Please try again later.",
    );
  }

  let valid: boolean;
  try {
    valid = await verifyPassword(
      session.username,
      session.domain,
      parsed.value.currentPassword,
    );
  } catch (error) {
    return failure(
      "POST /api/auth/change-password",
      error,
      "Unable to verify your current password right now. Please try again.",
    );
  }

  if (!valid) {
    passwordChangeLimiter.recordFailure(key);
    return jsonError(401, "Current password is incorrect.");
  }

  try {
    await updatePassword(session.username, await hashPassword(parsed.value.newPassword));
  } catch (error) {
    return failure(
      "POST /api/auth/change-password",
      error,
      "Unable to save your new password. Please try again.",
    );
  }

  passwordChangeLimiter.reset(key);
  // The old session was issued against the old password; drop it so the user
  // re-authenticates with the new one.
  await clearSession();

  return NextResponse.json({ success: true });
}
