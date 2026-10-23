/**
 * Payload-validation tests (spec §12). Pure functions, no network, no fixtures.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAttendanceState,
  isValidDateString,
  parseAttendancePayload,
  parseChangePasswordPayload,
  parseLoginPayload,
} from "./index.ts";

/** Narrow to the failure branch so `error` is readable in assertions. */
function errorOf(result: { ok: boolean; error?: string }): string {
  assert.equal(result.ok, false, "expected validation to fail");
  return result.error ?? "";
}

describe("isAttendanceState", () => {
  it("accepts only the two exact spellings the sheet stores", () => {
    assert.equal(isAttendanceState("Present"), true);
    assert.equal(isAttendanceState("Absent"), true);
    for (const value of ["present", "ABSENT", "", " Present", true, 1, null, undefined]) {
      assert.equal(isAttendanceState(value), false, `${JSON.stringify(value)} should be rejected`);
    }
  });
});

describe("isValidDateString", () => {
  it("accepts DD/MM/YYYY", () => {
    assert.equal(isValidDateString("01/09/2026"), true);
    assert.equal(isValidDateString("31/12/2026"), true);
    assert.equal(isValidDateString(" 01/09/2026 "), true);
  });

  it("rejects a date the calendar does not have", () => {
    assert.equal(isValidDateString("31/02/2026"), false);
    assert.equal(isValidDateString("31/04/2026"), false);
    assert.equal(isValidDateString("00/09/2026"), false);
    assert.equal(isValidDateString("32/09/2026"), false);
    assert.equal(isValidDateString("01/13/2026"), false);
    assert.equal(isValidDateString("01/00/2026"), false);
  });

  it("gets leap years right", () => {
    assert.equal(isValidDateString("29/02/2024"), true);
    assert.equal(isValidDateString("29/02/2023"), false);
    assert.equal(isValidDateString("29/02/2000"), true);
    assert.equal(isValidDateString("29/02/1900"), false);
  });

  it("rejects anything that is not the exact format", () => {
    for (const value of ["1/9/2026", "2026-09-01", "01-09-2026", "01/09/26", "", 20260901, null]) {
      assert.equal(isValidDateString(value), false, `${JSON.stringify(value)} should be rejected`);
    }
  });
});

describe("parseLoginPayload", () => {
  it("accepts a name and password, trimming the name", () => {
    const result = parseLoginPayload({ username: "  Curation TE 1 ", password: "secret123" });
    assert.deepEqual(result, {
      ok: true,
      value: { username: "Curation TE 1", password: "secret123" },
    });
  });

  it("does not trim the password", () => {
    const result = parseLoginPayload({ username: "Curation TE 1", password: " pad " });
    assert.equal(result.ok && result.value.password, " pad ");
  });

  it("rejects a missing, blank or non-string name", () => {
    for (const username of [undefined, null, "", "   ", 42, {}, []]) {
      assert.equal(errorOf(parseLoginPayload({ username, password: "x" })), "Name is required.");
    }
  });

  it("rejects a missing or empty password", () => {
    assert.equal(
      errorOf(parseLoginPayload({ username: "Curation TE 1" })),
      "Password is required.",
    );
    assert.equal(
      errorOf(parseLoginPayload({ username: "Curation TE 1", password: "" })),
      "Password is required.",
    );
  });

  it("rejects a password past bcrypt's 72-byte truncation point", () => {
    const result = parseLoginPayload({
      username: "Curation TE 1",
      password: "a".repeat(73),
    });
    assert.match(errorOf(result), /at most 72 characters/);
    // 72 exactly is fine.
    assert.equal(
      parseLoginPayload({ username: "Curation TE 1", password: "a".repeat(72) }).ok,
      true,
    );
  });

  it("rejects an oversized name instead of passing it to the sheet", () => {
    const result = parseLoginPayload({ username: "a".repeat(201), password: "secret123" });
    assert.equal(errorOf(result), "Name is required.");
  });

  it("rejects a non-object body, including an array", () => {
    for (const body of [null, undefined, "string", 42, []]) {
      assert.equal(
        errorOf(parseLoginPayload(body)),
        "Request body must be a JSON object.",
      );
    }
  });
});

describe("parseAttendancePayload", () => {
  const one = [{ memberName: "Curation SE 1", state: "Present" }];

  it("accepts a changes array and defers the date to the route", () => {
    const result = parseAttendancePayload({ changes: one });
    assert.deepEqual(result, {
      ok: true,
      value: {
        date: null,
        domain: null,
        changes: [{ memberName: "Curation SE 1", state: "Present" }],
      },
    });
  });

  it("still accepts the legacy `records` key", () => {
    const result = parseAttendancePayload({ records: one });
    assert.equal(result.ok && result.value.changes.length, 1);
  });

  it("carries a client-supplied domain as a request, never as a decision", () => {
    // Core Members pick a domain, so the field is parsed — but authorisation is
    // `resolveDomain`'s job, and it only ever answers with a real domain the
    // session may touch. See lib/auth/scope.test.ts.
    const result = parseAttendancePayload({ domain: "Marketing", changes: one });
    assert.equal(result.ok && result.value.domain, "Marketing");
  });

  it("ignores a non-string domain rather than coercing it", () => {
    for (const domain of [42, null, {}, ["Marketing"]]) {
      const result = parseAttendancePayload({ domain, changes: one });
      assert.equal(result.ok && result.value.domain, null);
    }
  });

  it("rejects a missing or non-array changes list", () => {
    for (const body of [{}, { changes: "Present" }, { changes: {} }]) {
      assert.match(errorOf(parseAttendancePayload(body)), /must be an array/);
    }
  });

  it("rejects an empty submission rather than writing nothing", () => {
    assert.equal(
      errorOf(parseAttendancePayload({ changes: [] })),
      "No attendance changes were submitted.",
    );
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: 501 }, (_, i) => ({
      memberName: `Member ${i}`,
      state: "Present",
    }));
    assert.match(errorOf(parseAttendancePayload({ changes: many })), /Too many/);
  });

  it("names the offending position when an entry is malformed", () => {
    assert.match(
      errorOf(parseAttendancePayload({ changes: [one[0], "nope"] })),
      /position 2 is not an object/,
    );
    assert.match(
      errorOf(parseAttendancePayload({ changes: [one[0], { state: "Present" }] })),
      /position 2 is missing a member name/,
    );
  });

  it("rejects a state that is not exactly Present or Absent", () => {
    for (const state of ["present", "P", "", true, 1, null, undefined]) {
      assert.match(
        errorOf(parseAttendancePayload({ changes: [{ memberName: "Curation SE 1", state }] })),
        /must have state "Present" or "Absent"/,
      );
    }
  });

  it("trims member names so a padded name matches the roster", () => {
    const result = parseAttendancePayload({
      changes: [{ memberName: "  Curation SE 1  ", state: "Absent" }],
    });
    assert.equal(result.ok && result.value.changes[0].memberName, "Curation SE 1");
  });

  it("accepts an explicit valid date and rejects an impossible one", () => {
    const good = parseAttendancePayload({ date: "31/08/2026", changes: one });
    assert.equal(good.ok && good.value.date, "31/08/2026");

    assert.match(
      errorOf(parseAttendancePayload({ date: "31/02/2026", changes: one })),
      /real date in DD\/MM\/YYYY/,
    );
    assert.match(
      errorOf(parseAttendancePayload({ date: "2026-08-31", changes: one })),
      /real date in DD\/MM\/YYYY/,
    );
  });

  it("treats an absent or null date as today", () => {
    assert.equal(parseAttendancePayload({ changes: one }).ok, true);
    const nulled = parseAttendancePayload({ date: null, changes: one });
    assert.equal(nulled.ok && nulled.value.date, null);
  });
});

describe("parseChangePasswordPayload", () => {
  it("accepts a current and a longer-than-minimum new password", () => {
    const result = parseChangePasswordPayload({
      currentPassword: "old-password",
      newPassword: "new-password",
    });
    assert.deepEqual(result, {
      ok: true,
      value: { currentPassword: "old-password", newPassword: "new-password" },
    });
  });

  it("requires the current password", () => {
    assert.equal(
      errorOf(parseChangePasswordPayload({ newPassword: "new-password" })),
      "Current password is required.",
    );
    assert.equal(
      errorOf(parseChangePasswordPayload({ currentPassword: "", newPassword: "new-password" })),
      "Current password is required.",
    );
  });

  it("enforces the 8-character minimum", () => {
    const result = parseChangePasswordPayload({
      currentPassword: "old-password",
      newPassword: "short7c",
    });
    assert.match(errorOf(result), /at least 8 characters/);
    assert.equal(
      parseChangePasswordPayload({ currentPassword: "old-password", newPassword: "exactly8" }).ok,
      true,
    );
  });

  it("enforces the 72-character bcrypt ceiling", () => {
    const result = parseChangePasswordPayload({
      currentPassword: "old-password",
      newPassword: "a".repeat(73),
    });
    assert.match(errorOf(result), /at most 72 characters/);
  });

  it("refuses a no-op change", () => {
    const result = parseChangePasswordPayload({
      currentPassword: "same-password",
      newPassword: "same-password",
    });
    assert.match(errorOf(result), /must be different/);
  });

  it("requires the new password to be a string at all", () => {
    assert.equal(
      errorOf(parseChangePasswordPayload({ currentPassword: "old-password", newPassword: 12345678 })),
      "New password is required.",
    );
  });
});
