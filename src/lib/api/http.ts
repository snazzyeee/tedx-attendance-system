/**
 * Shared JSON responses for the route handlers.
 *
 * Centralised so a Sheets failure produces the same status code and the same
 * user-facing wording everywhere, and so nothing leaks a stack trace or a
 * spreadsheet ID to the client — details go to the server log instead.
 */
import { NextResponse } from "next/server";
import { SheetsError } from "@/lib/google-sheets";

export function jsonError(status: number, error: string, extra?: ResponseInit) {
  return NextResponse.json({ error }, { status, ...extra });
}

export function unauthorized(error = "Unauthorized") {
  return jsonError(401, error);
}

export function forbidden(error = "Forbidden") {
  return jsonError(403, error);
}

export function tooManyRequests(retryAfterSeconds: number, error: string) {
  return NextResponse.json(
    { error, retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/**
 * Turn any thrown value into a response.
 *
 * A Sheets problem is the operator's-environment problem, not a bug, so it maps
 * to 503 with the spec's retry wording (§7). Anything else is a genuine 500.
 *
 * Signed-in callers get Google's actual message — a TE staring at "the
 * Passwords worksheet does not exist" can fix it in a minute, where "try again
 * later" would have them retrying forever. Callers who have *not* signed in get
 * the generic line instead, because those messages can name the spreadsheet ID
 * and the service-account address, and `/api/auth/login` is reachable by anyone
 * on the internet. Pass `exposeDetail: false` from any unauthenticated route.
 */
export function failure(
  context: string,
  error: unknown,
  clientMessage: string,
  options: { exposeDetail?: boolean } = {},
) {
  const exposeDetail = options.exposeDetail ?? true;

  if (error instanceof SheetsError) {
    console.error(`[${context}] Sheets ${error.kind}:`, error.message);
    return jsonError(503, exposeDetail ? error.message : clientMessage);
  }
  console.error(`[${context}]`, error);
  return jsonError(500, clientMessage);
}
