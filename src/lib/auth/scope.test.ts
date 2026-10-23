import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { canManageAttendance, isPrivileged, resolveDomain } from "./scope.ts";
import type { AuthSession } from "@/types";

const te: AuthSession = { username: "Tech TE 1", domain: "Tech", role: "TE" };
const core: AuthSession = { username: "Core Member 1", domain: "Core", role: "Core Member" };
const se: AuthSession = { username: "Tech SE 1", domain: "Tech", role: "SE" };

describe("resolveDomain", () => {
  it("pins a TE to their own domain whatever they ask for", () => {
    assert.equal(resolveDomain(te, "Marketing"), "Tech");
    assert.equal(resolveDomain(te, "Core"), "Tech");
    assert.equal(resolveDomain(te, null), "Tech");
  });

  it("lets a Core Member pick any real domain", () => {
    assert.equal(resolveDomain(core, "Marketing"), "Marketing");
    assert.equal(resolveDomain(core, "  design  "), "Design");
  });

  it("falls back rather than trusting an unknown domain string", () => {
    for (const bad of ["Core", "Finance", "", "   ", null, undefined, "../etc"]) {
      assert.equal(resolveDomain(core, bad), "Curation");
    }
  });
});

describe("canManageAttendance", () => {
  it("admits TEs and Core Members only", () => {
    assert.equal(canManageAttendance(te), true);
    assert.equal(canManageAttendance(core), true);
    assert.equal(canManageAttendance(se), false);
    assert.equal(canManageAttendance(null), false);
  });
});

describe("isPrivileged", () => {
  it("is true only for Core Members", () => {
    assert.equal(isPrivileged(core), true);
    assert.equal(isPrivileged(te), false);
  });
});
