/**
 * Brute-force limiter tests (spec §12).
 *
 * The clock is injected, so the 15-minute window and block are verified in
 * microseconds rather than by sleeping.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOGIN_LIMIT,
  PASSWORD_CHANGE_LIMIT,
  RateLimiter,
  clientIpFrom,
  rateLimitKey,
} from "./index.ts";

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

const KEY = "203.0.113.7|curation te 1";

describe("RateLimiter", () => {
  it("allows a fresh key and reports the full budget", () => {
    const limiter = new RateLimiter(LOGIN_LIMIT, clock().now);
    assert.deepEqual(limiter.check(KEY), {
      allowed: true,
      remaining: 5,
      retryAfterSeconds: 0,
    });
  });

  it("blocks on the fifth failure, matching the spec's ~5-attempt guidance", () => {
    const time = clock();
    const limiter = new RateLimiter(LOGIN_LIMIT, time.now);

    for (let attempt = 1; attempt <= 4; attempt++) {
      const result = limiter.recordFailure(KEY);
      assert.equal(result.allowed, true, `attempt ${attempt} should still be allowed`);
      assert.equal(result.remaining, 5 - attempt);
    }

    const fifth = limiter.recordFailure(KEY);
    assert.equal(fifth.allowed, false);
    assert.equal(fifth.remaining, 0);
    assert.equal(fifth.retryAfterSeconds, 900, "15 minutes, in seconds");
  });

  it("keeps refusing a blocked key without recording anything new", () => {
    const time = clock();
    const limiter = new RateLimiter(LOGIN_LIMIT, time.now);
    for (let i = 0; i < 5; i++) limiter.recordFailure(KEY);

    time.advance(60_000);
    const checked = limiter.check(KEY);
    assert.equal(checked.allowed, false);
    assert.equal(checked.retryAfterSeconds, 840, "the countdown shrinks with time");
  });

  it("lets the key back in once the block expires", () => {
    const time = clock();
    const limiter = new RateLimiter(LOGIN_LIMIT, time.now);
    for (let i = 0; i < 5; i++) limiter.recordFailure(KEY);

    time.advance(LOGIN_LIMIT.blockMs - 1);
    assert.equal(limiter.check(KEY).allowed, false);

    time.advance(2);
    const after = limiter.check(KEY);
    assert.equal(after.allowed, true);
    assert.equal(after.remaining, 5, "the window starts clean after serving a block");
  });

  it("does not stack old failures onto a block already served", () => {
    const time = clock();
    const limiter = new RateLimiter(LOGIN_LIMIT, time.now);
    for (let i = 0; i < 5; i++) limiter.recordFailure(KEY);

    time.advance(LOGIN_LIMIT.blockMs + 1);
    // A single failure after the block must not immediately re-block.
    const next = limiter.recordFailure(KEY);
    assert.equal(next.allowed, true);
    assert.equal(next.remaining, 4);
  });

  it("forgets failures that age out of the window", () => {
    const time = clock();
    const limiter = new RateLimiter(LOGIN_LIMIT, time.now);

    limiter.recordFailure(KEY);
    limiter.recordFailure(KEY);
    time.advance(LOGIN_LIMIT.windowMs + 1);

    // A patient attacker gets a fresh budget, which is what a sliding window
    // means; the point is that 5 fast guesses cost 15 minutes.
    const result = limiter.recordFailure(KEY);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 4);
  });

  it("counts failures spread across the window, not just consecutive ones", () => {
    const time = clock();
    const limiter = new RateLimiter(LOGIN_LIMIT, time.now);

    // Four failures at three-minute intervals stay inside a 15-minute window.
    for (let i = 0; i < 4; i++) {
      assert.equal(limiter.recordFailure(KEY).allowed, true);
      time.advance(3 * 60 * 1000);
    }
    assert.equal(limiter.recordFailure(KEY).allowed, false);
  });

  it("clears the counter on a successful login", () => {
    const limiter = new RateLimiter(LOGIN_LIMIT, clock().now);
    for (let i = 0; i < 4; i++) limiter.recordFailure(KEY);
    assert.equal(limiter.check(KEY).remaining, 1);

    limiter.reset(KEY);
    assert.equal(limiter.check(KEY).remaining, 5);
    assert.equal(limiter.size(), 0);
  });

  it("isolates keys, so one user cannot lock out another", () => {
    const limiter = new RateLimiter(LOGIN_LIMIT, clock().now);
    for (let i = 0; i < 5; i++) limiter.recordFailure(KEY);

    assert.equal(limiter.check(KEY).allowed, false);
    assert.equal(limiter.check("203.0.113.8|curation te 1").allowed, true);
    assert.equal(limiter.check("203.0.113.7|marketing te 1").allowed, true);
  });

  it("honours a different config", () => {
    const time = clock();
    const limiter = new RateLimiter(PASSWORD_CHANGE_LIMIT, time.now);
    for (let i = 0; i < 9; i++) {
      assert.equal(limiter.recordFailure(KEY).allowed, true);
    }
    const tenth = limiter.recordFailure(KEY);
    assert.equal(tenth.allowed, false);
    assert.equal(tenth.retryAfterSeconds, 300, "5-minute block");
  });

  it("sweeps stale keys so a username-cycling attack cannot grow the map forever", () => {
    const time = clock();
    const limiter = new RateLimiter(LOGIN_LIMIT, time.now);

    // Sweeping only kicks in past the threshold, so fill past it.
    for (let i = 0; i < 1000; i++) limiter.recordFailure(`10.0.0.1|user${i}`);
    assert.equal(limiter.size(), 1000);

    time.advance(LOGIN_LIMIT.windowMs + 1);
    limiter.recordFailure("10.0.0.1|fresh");

    assert.equal(limiter.size(), 1, "every aged-out key should have been dropped");
  });

  it("does not sweep a key that is still blocked", () => {
    const time = clock();
    // A block outlasting the failure window is the only way to observe the
    // distinction; the shipped login config happens to use equal durations.
    const limiter = new RateLimiter(
      { limit: 5, windowMs: 60_000, blockMs: 600_000 },
      time.now,
    );

    for (let i = 0; i < 5; i++) limiter.recordFailure(KEY); // now blocked
    for (let i = 0; i < 999; i++) limiter.recordFailure(`10.0.0.1|user${i}`);
    assert.equal(limiter.size(), 1000);

    // Past the failure window but still well inside the block.
    time.advance(60_001);
    limiter.recordFailure("10.0.0.1|fresh");

    assert.equal(limiter.check(KEY).allowed, false, "an active block must survive a sweep");
    assert.equal(limiter.size(), 2, "the stale keys went, KEY and the fresh one stayed");
  });
});

describe("rateLimitKey", () => {
  it("normalises the username so casing cannot buy extra attempts", () => {
    assert.equal(
      rateLimitKey("203.0.113.7", "  Curation TE 1 "),
      rateLimitKey("203.0.113.7", "curation te 1"),
    );
  });

  it("keeps the IP distinct from the username", () => {
    assert.notEqual(
      rateLimitKey("203.0.113.7", "curation te 1"),
      rateLimitKey("203.0.113.8", "curation te 1"),
    );
  });
});

describe("clientIpFrom", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    assert.equal(clientIpFrom(headers), "203.0.113.7");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    assert.equal(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIpFrom(new Headers()), "unknown");
  });

  it("ignores a blank forwarded header", () => {
    assert.equal(
      clientIpFrom(new Headers({ "x-forwarded-for": " ", "x-real-ip": "203.0.113.9" })),
      "203.0.113.9",
    );
  });
});
