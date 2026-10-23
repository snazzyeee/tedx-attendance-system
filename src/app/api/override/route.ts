import { NextResponse } from "next/server";
import { isPrivileged } from "@/lib/auth/scope";
import { getSession } from "@/lib/auth/session";
import { setOverrideEndMs } from "@/lib/google-sheets";
import { failure, jsonError, unauthorized } from "@/lib/api/http";

/** How long one override lasts. Long enough to finish a roll call, no longer. */
export const OVERRIDE_DURATION_MS = 15 * 60 * 1000;

/**
 * Open or close the global override window (Core Members only).
 *
 * While it is open, TEs may mark attendance outside 3–4 PM IST. It is stored in
 * the sheet rather than in memory on purpose: every serverless instance has to
 * agree about it, and a cold start must not quietly revoke a window a Core
 * Member opened thirty seconds ago.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isPrivileged(session)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON.");
  }

  const action = (body as { action?: unknown } | null)?.action;
  if (action !== "start" && action !== "stop") {
    return jsonError(400, "Action must be 'start' or 'stop'.");
  }

  const endMs = action === "start" ? Date.now() + OVERRIDE_DURATION_MS : 0;

  try {
    await setOverrideEndMs(endMs);
    console.log(
      `[POST /api/override] ${session.username} ${action === "start" ? "opened" : "closed"} the override window`,
    );
    return NextResponse.json(
      { success: true, overrideEndMs: endMs, serverTimeMs: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure("POST /api/override", error, "Failed to update the override window.");
  }
}
