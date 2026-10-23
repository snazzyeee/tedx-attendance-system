/**
 * Cross-domain authorization tests (spec §2: "a Curation TE must not be able to
 * mark attendance for Marketing", enforced in the backend).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizeChanges } from "./authorize.ts";
import type { AttendanceChange, Member } from "@/types";

const curation: Member[] = [
  { name: "Curation TE 1", domain: "Curation", role: "TE" },
  { name: "Curation SE 1", domain: "Curation", role: "SE" },
  { name: "Curation SE 2", domain: "Curation", role: "SE" },
];

const present = (memberName: string): AttendanceChange => ({ memberName, state: "Present" });

describe("authorizeChanges", () => {
  it("passes changes for the caller's own members through unchanged", () => {
    const result = authorizeChanges(
      "Curation",
      curation,
      [present("Curation SE 1"), { memberName: "Curation SE 2", state: "Absent" }],
    );
    assert.deepEqual(result, {
      ok: true,
      changes: [
        { memberName: "Curation SE 1", state: "Present" },
        { memberName: "Curation SE 2", state: "Absent" },
      ],
    });
  });

  it("rejects a member from another domain (spec §2)", () => {
    const result = authorizeChanges("Curation", curation, [present("Marketing SE 1")]);
    assert.equal(result.ok, false);
    assert.equal(
      result.ok ? "" : result.error,
      '"Marketing SE 1" is not a member of Curation. You can only mark attendance for your own domain.',
    );
  });

  it("rejects the whole submission when one name is foreign, so nothing half-applies", () => {
    const result = authorizeChanges("Curation", curation, [
      present("Curation SE 1"),
      present("Marketing SE 1"),
      present("Curation SE 2"),
    ]);
    assert.equal(result.ok, false);
  });

  it("rejects a name that exists nowhere", () => {
    assert.equal(authorizeChanges("Curation", curation, [present("Nobody")]).ok, false);
  });

  it("rejects the caller's own TE name spelled for another domain", () => {
    // A forged payload cannot smuggle a foreign row in by matching on role.
    assert.equal(authorizeChanges("Curation", curation, [present("Marketing TE 1")]).ok, false);
  });

  it("cannot be bypassed with casing or padding", () => {
    const result = authorizeChanges("Curation", curation, [present("  cUrAtIoN sE 1 ")]);
    assert.equal(result.ok, true);
    // Rewritten to the configured spelling, so no duplicate row can be created.
    assert.equal(result.ok && result.changes[0].memberName, "Curation SE 1");
  });

  it("lets a TE mark their own attendance", () => {
    assert.equal(authorizeChanges("Curation", curation, [present("Curation TE 1")]).ok, true);
  });

  it("authorizes an empty list to an empty list", () => {
    assert.deepEqual(authorizeChanges("Curation", curation, []), { ok: true, changes: [] });
  });

  it("rejects everything when the roster is empty", () => {
    // An unconfigured domain must not become a write-anything domain.
    assert.equal(authorizeChanges("Curation", [], [present("Curation SE 1")]).ok, false);
  });
});
