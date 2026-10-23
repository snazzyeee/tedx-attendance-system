import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decrypt } from "@/lib/auth/session";

/**
 * Optimistic auth gate.
 *
 * This only keeps unauthenticated traffic off protected routes so the browser
 * gets a redirect instead of a flash of empty UI. It is deliberately NOT the
 * authorization layer: every route handler and page re-reads the session and
 * re-checks the domain itself. See `getSession()` callers.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const isApi = path.startsWith("/api");
  const sessionCookie = request.cookies.get("session")?.value;

  if (!sessionCookie) {
    return isApi
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
  }

  const session = await decrypt(sessionCookie);

  // Expired or tampered token: clear it so the user isn't stuck in a redirect
  // loop with a cookie the app will never accept.
  if (!session) {
    const response = isApi
      ? NextResponse.json({ error: "Session expired" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("session");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match everything except Next.js internals and static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon\\.png|apple-icon).*)",
  ],
};
