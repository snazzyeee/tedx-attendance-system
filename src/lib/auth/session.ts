import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { AuthSession } from "@/types";

const secretKey = process.env.SESSION_SECRET;

if (!secretKey && process.env.NODE_ENV === "production") {
  // A predictable fallback secret in production would let anyone forge a
  // session cookie for any domain, which defeats every authorization check.
  throw new Error(
    "SESSION_SECRET must be set in production. Generate one with: openssl rand -base64 32",
  );
}

const key = new TextEncoder().encode(
  secretKey || "dev_only_insecure_secret_for_tedx_attendance",
);

export async function encrypt(payload: AuthSession) {
  // Spread into a plain object so the payload satisfies jose's JWTPayload
  // index-signature requirement without an `any` cast.
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h") // 24 hours expiry
    .sign(key);
}

export async function decrypt(input: string): Promise<AuthSession | null> {
  try {
    const { payload } = await jwtVerify(input, key, {
      algorithms: ["HS256"],
    });
    return payload as unknown as AuthSession;
  } catch {
    // Expired, tampered, or signed with a rotated secret — all mean "no session".
    return null;
  }
}

export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) return null;
  return await decrypt(session);
}

export async function setSession(payload: AuthSession) {
  const session = await encrypt(payload);
  const cookieStore = await cookies();
  cookieStore.set("session", session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60, // 24 hours
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.set("session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
