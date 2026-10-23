/**
 * Brute-force protection (spec §12).
 *
 * A sliding-window counter in a module-level Map. Dependency-free by decision,
 * which carries a real limitation: the counters live in one server process, so
 * they reset on a cold start and are not shared between serverless instances.
 * That still raises the cost of an online guessing attack by orders of
 * magnitude, but it is not a distributed limiter — see the README's Known
 * limitations. Moving to Upstash/Redis is a drop-in replacement for `consume`.
 *
 * The clock is injectable so the window logic is testable without waiting.
 */

export interface RateLimitConfig {
  /** Failures allowed inside the window before blocking. */
  limit: number;
  windowMs: number;
  /** How long a blocked key stays blocked once it trips. */
  blockMs: number;
}

export const LOGIN_LIMIT: RateLimitConfig = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const PASSWORD_CHANGE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
  blockMs: 5 * 60 * 1000,
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the caller may retry; 0 when allowed. */
  retryAfterSeconds: number;
}

interface Entry {
  /** Timestamps of recent failures, oldest first. */
  failures: number[];
  blockedUntil: number;
}

export type Clock = () => number;

/**
 * Guard against unbounded growth: a stuffing attack cycling usernames would
 * otherwise add a Map entry per attempt. Once this many keys are tracked, a
 * sweep runs on the next call.
 */
const SWEEP_THRESHOLD = 1000;

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly config: RateLimitConfig;
  private readonly now: Clock;

  // Fields are assigned explicitly rather than declared as constructor
  // parameter properties: those emit code, which Node's strip-only TypeScript
  // support rejects, and this module has to load under `node --test`.
  constructor(config: RateLimitConfig, now: Clock = Date.now) {
    this.config = config;
    this.now = now;
  }

  /** Current state without recording anything — used before checking a password. */
  check(key: string): RateLimitResult {
    const now = this.now();
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true, remaining: this.config.limit, retryAfterSeconds: 0 };

    if (entry.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
      };
    }

    const recent = this.recentFailures(entry, now);
    return {
      allowed: true,
      remaining: Math.max(0, this.config.limit - recent.length),
      retryAfterSeconds: 0,
    };
  }

  /** Record one failure. The result reflects the state *after* recording. */
  recordFailure(key: string): RateLimitResult {
    const now = this.now();
    this.maybeSweep(now);

    const entry = this.entries.get(key) ?? { failures: [], blockedUntil: 0 };
    entry.failures = this.recentFailures(entry, now);
    entry.failures.push(now);

    if (entry.failures.length >= this.config.limit) {
      entry.blockedUntil = now + this.config.blockMs;
      // Start the next window clean so a blocked key isn't re-blocked forever
      // by failures that predate the block it already served.
      entry.failures = [];
    }
    this.entries.set(key, entry);

    if (entry.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, this.config.limit - entry.failures.length),
      retryAfterSeconds: 0,
    };
  }

  /** Clear a key after a successful authentication. */
  reset(key: string): void {
    this.entries.delete(key);
  }

  /** Test/diagnostic hook. */
  size(): number {
    return this.entries.size;
  }

  private recentFailures(entry: Entry, now: number): number[] {
    const cutoff = now - this.config.windowMs;
    return entry.failures.filter((t) => t > cutoff);
  }

  private maybeSweep(now: number): void {
    if (this.entries.size < SWEEP_THRESHOLD) return;
    const cutoff = now - this.config.windowMs;
    for (const [key, entry] of this.entries) {
      const stale = entry.blockedUntil <= now && !entry.failures.some((t) => t > cutoff);
      if (stale) this.entries.delete(key);
    }
    
    // Prevent OOM from malicious IP spoofing generating infinite keys
    if (this.entries.size > SWEEP_THRESHOLD * 2) {
      const keysToDelete = Array.from(this.entries.keys()).slice(0, SWEEP_THRESHOLD);
      for (const key of keysToDelete) this.entries.delete(key);
    }
  }
}

/**
 * Key a limiter by client IP *and* username.
 *
 * Both matter: IP-only lets one NAT'd campus network lock everyone out, and
 * username-only lets an attacker lock a real TE out of their own account. The
 * pair means an attacker must burn a fresh IP for every 5 guesses.
 */
export function rateLimitKey(ip: string, username: string): string {
  return `${ip}|${username.trim().toLowerCase()}`;
}

/**
 * Best-effort client IP.
 *
 * Behind Vercel/any proxy the socket address is the proxy's, so the forwarded
 * headers are the only signal available. They are spoofable by a direct client,
 * which is exactly why the username half of the key exists.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

// Shared instances. Module-level so counters survive between requests in the
// same process (the whole point), and so routes cannot accidentally each get a
// fresh, empty limiter.
export const loginLimiter = new RateLimiter(LOGIN_LIMIT);
export const passwordChangeLimiter = new RateLimiter(PASSWORD_CHANGE_LIMIT);
