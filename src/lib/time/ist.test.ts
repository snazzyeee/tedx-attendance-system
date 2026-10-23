import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attendanceWindowStatus,
  DAY_MS,
  formatDuration,
  getTodayDateIST,
  HOUR_MS,
  isWindowOpen,
  msSinceMidnightIST,
} from "./ist.ts";

/** A UTC instant for the given IST wall-clock time on 12 Sep 2026. */
function ist(hour: number, minute = 0, second = 0): number {
  return Date.UTC(2026, 8, 12, hour, minute, second) - 5.5 * HOUR_MS;
}

describe("msSinceMidnightIST", () => {
  it("measures from IST midnight, not UTC midnight", () => {
    assert.equal(msSinceMidnightIST(ist(0)), 0);
    assert.equal(msSinceMidnightIST(ist(15, 30)), 15.5 * HOUR_MS);
  });

  it("stays inside the day for a pre-epoch instant", () => {
    const value = msSinceMidnightIST(-DAY_MS);
    assert.ok(value >= 0 && value < DAY_MS, `got ${value}`);
  });
});

describe("getTodayDateIST", () => {
  it("formats as DD/MM/YYYY", () => {
    assert.match(getTodayDateIST(new Date(ist(12))), /^\d{2}\/\d{2}\/\d{4}$/);
    assert.equal(getTodayDateIST(new Date(ist(12))), "12/09/2026");
  });

  it("rolls the date at IST midnight, not UTC midnight", () => {
    // 19:00 UTC on the 12th is already 00:30 IST on the 13th.
    const lateUtc = Date.UTC(2026, 8, 12, 19, 0, 0);
    assert.equal(getTodayDateIST(new Date(lateUtc)), "13/09/2026");
  });
});

describe("attendanceWindowStatus", () => {
  it("is closed before 3 PM and counts down to the opening", () => {
    const status = attendanceWindowStatus(ist(14, 30));
    assert.equal(status.open, false);
    assert.equal(status.remainingMs, 30 * 60 * 1000);
  });

  it("opens exactly at 15:00:00 IST", () => {
    assert.equal(isWindowOpen(ist(14, 59, 59)), false);
    assert.equal(isWindowOpen(ist(15, 0, 0)), true);
  });

  it("closes exactly at 16:00:00 IST", () => {
    assert.equal(isWindowOpen(ist(15, 59, 59)), true);
    assert.equal(isWindowOpen(ist(16, 0, 0)), false);
  });

  it("counts down to close while open", () => {
    const status = attendanceWindowStatus(ist(15, 20));
    assert.equal(status.open, true);
    assert.equal(status.remainingMs, 40 * 60 * 1000);
  });

  it("counts forward to tomorrow's opening after 4 PM", () => {
    const status = attendanceWindowStatus(ist(16, 0, 0));
    assert.equal(status.open, false);
    assert.equal(status.remainingMs, 23 * HOUR_MS);
  });

  it("never reports a negative countdown across the whole day", () => {
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const status = attendanceWindowStatus(ist(0, minute));
      assert.ok(status.remainingMs >= 0, `negative at minute ${minute}`);
      assert.ok(status.remainingMs <= DAY_MS, `overflow at minute ${minute}`);
    }
  });
});

describe("formatDuration", () => {
  it("pads minutes and seconds so the countdown does not jitter", () => {
    assert.equal(formatDuration(2 * HOUR_MS + 5 * 60_000 + 9_000), "2h 05m 09s");
    assert.equal(formatDuration(9_000), "0m 09s");
  });

  it("clamps a negative remainder to zero", () => {
    assert.equal(formatDuration(-5_000), "0m 00s");
  });
});
