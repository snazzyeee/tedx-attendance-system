/**
 * Service-layer tests driven by a fake `SheetsClient`.
 *
 * These are the API-cost guarantees the spec asks for and that nothing else can
 * check: how many Sheets requests a save actually issues (§7), and which cells
 * it touches (§15). `import type` for the client means `googleapis` is never
 * loaded, so this file runs under bare `node --test`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SheetsError } from "./errors.ts";
import {
  createDateColumn,
  getAttendance,
  getOverrideEndMs,
  getDomainAnalytics,
  getPasswordOverrides,
  getTodayColumn,
  getTodayDateIST,
  setOverrideEndMs,
  updateAttendance,
  updatePassword,
} from "./attendance-service.ts";
import type { SheetsClient } from "./client.ts";
import type { SheetRows, WriteCell } from "./sheet-model.ts";
import type { AttendanceChange, Member } from "@/types";

const TODAY = "01/09/2026";
const YESTERDAY = "31/08/2026";

interface Recorder {
  client: SheetsClient;
  reads: string[];
  writes: WriteCell[][];
  /** Audit-log appends. Counted because they spend the same Sheets quota. */
  appends: { range: string; rows: unknown[][] }[];
}

/**
 * A fake sheet. `rowsFor` lets one fake serve both the Attendance and Passwords
 * tabs, or throw for a tab that does not exist.
 */
function recorder(rowsFor: (range: string) => SheetRows): Recorder {
  const reads: string[] = [];
  const writes: WriteCell[][] = [];
  const appends: { range: string; rows: unknown[][] }[] = [];
  return {
    reads,
    writes,
    appends,
    client: {
      async getValues(range) {
        reads.push(range);
        return rowsFor(range);
      },
      async appendValues(range, values) {
        appends.push({ range, rows: values });
      },
      async batchUpdate(data) {
        writes.push(data);
      },
    },
  };
}

function fixed(rows: SheetRows): Recorder {
  return recorder(() => rows);
}

const roster = (count: number): Member[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `Curation SE ${i + 1}`,
    domain: "Curation" as const,
    role: "SE" as const,
  }));

function sheetFor(members: Member[], dates: string[] = [TODAY]): SheetRows {
  return [
    ["Member Name", "Domain", ...dates],
    ...members.map((m) => [m.name, m.domain, ...dates.map(() => "")]),
  ];
}

const present = (m: Member): AttendanceChange => ({
  memberName: m.name,
  state: "Present",
});

describe("getTodayDateIST", () => {
  it("formats as DD/MM/YYYY", () => {
    assert.match(getTodayDateIST(), /^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("uses IST, so the date rolls over at 18:30 UTC", () => {
    // 18:29 UTC is still the 1st in Kolkata (UTC+5:30); 18:30 is the 2nd.
    assert.equal(getTodayDateIST(new Date("2026-09-01T18:29:00Z")), "01/09/2026");
    assert.equal(getTodayDateIST(new Date("2026-09-01T18:30:00Z")), "02/09/2026");
    // A UTC-morning timestamp must not report "yesterday" to an Indian user.
    assert.equal(getTodayDateIST(new Date("2026-09-02T00:30:00Z")), "02/09/2026");
  });
});

describe("updateAttendance", () => {
  it("issues exactly one read and one batchUpdate for 10 members (spec §7)", async () => {
    const members = roster(10);
    const fake = fixed(sheetFor(members));

    const result = await updateAttendance(fake.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: members.map(present),
    });

    assert.equal(fake.reads.length, 1, "should read the sheet once");
    assert.equal(fake.writes.length, 1, "should write in a single batchUpdate");
    assert.equal(fake.writes[0].length, 10, "one cell per changed member");
    assert.equal(result.written, 10);
    assert.equal(result.createdDateColumn, false);
    assert.deepEqual(result.appendedMembers, []);
  });

  it("stays at three calls with the audit log, for any roster size (spec §7)", async () => {
    // The number that matters against Google's 60-per-minute quota. The browser
    // batches a burst of taps into one of these, so a 14-person roster costs 3
    // requests — not the 42 it cost when every toggle POSTed on its own.
    const members = roster(40);
    const fake = fixed(sheetFor(members));

    const result = await updateAttendance(fake.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: members.map(present),
      teName: "Curation TE 1",
    });

    assert.equal(fake.reads.length, 1);
    assert.equal(fake.writes.length, 1);
    assert.equal(fake.appends.length, 1, "one append for the whole batch");
    assert.equal(fake.appends[0].rows.length, 40, "one audit row per mark");
    assert.equal(result.apiCalls, 3);
    assert.equal(result.auditFailed, false);
  });

  it("returns the post-save roster so the browser needs no re-read", async () => {
    const members = roster(3);
    const fake = fixed(sheetFor(members));

    const result = await updateAttendance(fake.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: [present(members[1])],
    });

    assert.equal(fake.reads.length, 1, "no second read to report the new state");
    assert.deepEqual(
      result.records.map((r) => [r.memberName, r.state]),
      [
        ["Curation SE 1", "Absent"],
        ["Curation SE 2", "Present"],
        ["Curation SE 3", "Absent"],
      ],
    );
  });

  it("saves the attendance even when the Audit Log tab is missing", async () => {
    const members = roster(2);
    const fake = fixed(sheetFor(members));
    fake.client.appendValues = async () => {
      throw new SheetsError("missing-tab", "Unable to parse range: 'Audit Log'!A:E");
    };

    const result = await updateAttendance(fake.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: members.map(present),
      teName: "Curation TE 1",
    });

    // The mark is the product; the log is the receipt. Losing the receipt must
    // not lose the mark — but the TE is told, so somebody can add the tab.
    assert.equal(fake.writes.length, 1, "the attendance write still happened");
    assert.equal(result.auditFailed, true);
    assert.equal(result.apiCalls, 2);
  });

  it("costs the same two calls for 1 member as for 40", async () => {
    const members = roster(40);
    const one = fixed(sheetFor(members));
    const all = fixed(sheetFor(members));

    await updateAttendance(one.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: [present(members[0])],
    });
    await updateAttendance(all.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: members.map(present),
    });

    assert.equal(one.reads.length + one.writes.length, 2);
    assert.equal(all.reads.length + all.writes.length, 2);
  });

  it("never names an untouched member's cell (spec §15)", async () => {
    const members = roster(10);
    const fake = fixed(sheetFor(members));

    // Members 1 and 10 live in sheet rows 2 and 11 -> cells C2 and C11.
    await updateAttendance(fake.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: [present(members[0]), present(members[9])],
    });

    const ranges = fake.writes[0].map((w) => w.range);
    assert.deepEqual(ranges, ["'Attendance'!C2", "'Attendance'!C11"]);
    for (const untouched of ["C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]) {
      assert.equal(
        ranges.some((r) => r.endsWith(`!${untouched}`)),
        false,
        `${untouched} belongs to another member and must not be written`,
      );
    }
  });

  it("creates today's column when absent and reuses it when present (spec §6)", async () => {
    const members = roster(3);

    const missing = fixed(sheetFor(members, [YESTERDAY]));
    const created = await updateAttendance(missing.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: [present(members[0])],
    });
    assert.equal(created.createdDateColumn, true);
    assert.deepEqual(missing.writes[0][0], {
      range: "'Attendance'!D1",
      values: [[TODAY]],
    });

    const existing = fixed(sheetFor(members, [YESTERDAY, TODAY]));
    const reused = await updateAttendance(existing.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: [present(members[0])],
    });
    assert.equal(reused.createdDateColumn, false);
    assert.equal(
      existing.writes[0].some((w) => w.values[0][0] === TODAY),
      false,
      "the existing date header must not be rewritten",
    );
    assert.equal(existing.writes[0][0].range, "'Attendance'!D2");
  });

  it("saves twice on the same date without adding a second column", async () => {
    const members = roster(3);
    const rows = sheetFor(members);
    const fake = fixed(rows);

    for (const state of ["Present", "Absent"] as const) {
      await updateAttendance(fake.client, {
        roster: members,
        domain: "Curation",
        dateStr: TODAY,
        changes: [{ memberName: members[0].name, state }],
      });
    }

    assert.equal(fake.writes.length, 2);
    assert.deepEqual(fake.writes[0], [{ range: "'Attendance'!C2", values: [["Present"]] }]);
    assert.deepEqual(fake.writes[1], [{ range: "'Attendance'!C2", values: [["Absent"]] }]);
  });

  it("appends a configured member the sheet has never seen (spec §15)", async () => {
    const members = roster(3);
    const newcomer: Member = { name: "Curation SE 9", domain: "Curation", role: "SE" };
    const fake = fixed(sheetFor(members));

    const result = await updateAttendance(fake.client, {
      roster: [...members, newcomer],
      domain: "Curation",
      dateStr: TODAY,
      changes: [present(newcomer)],
    });

    assert.deepEqual(result.appendedMembers, ["Curation SE 9"]);
    assert.deepEqual(fake.writes[0], [
      { range: "'Attendance'!A5:B5", values: [["Curation SE 9", "Curation"]] },
      { range: "'Attendance'!C5", values: [["Present"]] },
    ]);
  });

  it("still batches when the sheet is empty and must be seeded (spec §4)", async () => {
    const members = roster(3);
    const fake = fixed([]);

    await updateAttendance(fake.client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: members.map(present),
    });

    assert.equal(fake.reads.length, 1);
    assert.equal(fake.writes.length, 1);
    assert.equal(fake.writes[0][0].range, "'Attendance'!A1:B1");
  });

  it("propagates a Sheets outage instead of reporting a false success", async () => {
    const client: SheetsClient = {
      async getValues() {
        throw new SheetsError("unavailable", "Google Sheets is unavailable.");
      },
      async appendValues() {}, async batchUpdate() {
        assert.fail("must not write after a failed read");
      },
    };

    await assert.rejects(
      () =>
        updateAttendance(client, {
          roster: roster(1),
          domain: "Curation",
          dateStr: TODAY,
          changes: [present(roster(1)[0])],
        }),
      (error: unknown) => error instanceof SheetsError && error.kind === "unavailable",
    );
  });
});

describe("getAttendance", () => {
  it("reads once and writes nothing", async () => {
    const members = roster(3);
    const fake = fixed(sheetFor(members));

    const records = await getAttendance(fake.client, members, TODAY);

    assert.equal(fake.reads.length, 1);
    assert.equal(fake.writes.length, 0);
    assert.equal(fake.reads[0], "'Attendance'!A:ZZ");
    assert.equal(records.length, 3);
  });

  it("reads empty, missing and \"Absent\" cells all as Absent (spec §7A)", async () => {
    const members = roster(3);
    const fake = fixed([
      ["Member Name", "Domain", TODAY],
      ["Curation SE 1", "Curation", ""], // empty cell
      ["Curation SE 2", "Curation"], // cell absent from a ragged row
      ["Curation SE 3", "Curation", "Absent"], // explicit
    ]);

    const records = await getAttendance(fake.client, members, TODAY);
    assert.deepEqual(
      records.map((r) => r.state),
      ["Absent", "Absent", "Absent"],
    );
  });

  it("reads a present mark back regardless of the casing in the sheet", async () => {
    const members = roster(2);
    const fake = fixed([
      ["Member Name", "Domain", TODAY],
      ["Curation SE 1", "Curation", "present"],
      ["Curation SE 2", "Curation", " PRESENT "],
    ]);

    const records = await getAttendance(fake.client, members, TODAY);
    assert.deepEqual(
      records.map((r) => r.state),
      ["Present", "Present"],
    );
  });

  it("round-trips a save: write then read shows the saved state", async () => {
    const members = roster(3);
    const rows = sheetFor(members);
    // A fake that actually applies the batch, so the read-back is meaningful.
    const client: SheetsClient = {
      async getValues() {
        return rows;
      },
      async appendValues() {}, async batchUpdate(data) {
        for (const cell of data) {
          const match = /!([A-Z]+)(\d+)$/.exec(cell.range);
          if (!match) continue;
          const col = match[1].charCodeAt(0) - 65;
          const row = Number(match[2]) - 1;
          rows[row][col] = cell.values[0][0];
        }
      },
    };

    await updateAttendance(client, {
      roster: members,
      domain: "Curation",
      dateStr: TODAY,
      changes: [present(members[1])],
    });

    const records = await getAttendance(client, members, TODAY);
    assert.deepEqual(
      records.map((r) => r.state),
      ["Absent", "Present", "Absent"],
    );
  });
});

describe("getTodayColumn / createDateColumn", () => {
  it("reports -1 for a date with no column", async () => {
    const fake = fixed(sheetFor(roster(2), [YESTERDAY]));
    assert.equal(await getTodayColumn(fake.client, TODAY), -1);
    assert.equal(await getTodayColumn(fake.client, YESTERDAY), 2);
    assert.equal(fake.writes.length, 0);
  });

  it("adds the header once and is idempotent on a second call (spec §6)", async () => {
    const rows = sheetFor(roster(2), [YESTERDAY]);
    const fake = recorder(() => rows);

    const created = await createDateColumn(fake.client, TODAY);
    assert.equal(created, 3);
    assert.equal(fake.writes.length, 1);
    assert.deepEqual(fake.writes[0], [{ range: "'Attendance'!D1", values: [[TODAY]] }]);

    // Simulate the header now existing, as it would after the write lands.
    rows[0].push(TODAY);
    const again = await createDateColumn(fake.client, TODAY);
    assert.equal(again, 3);
    assert.equal(fake.writes.length, 1, "must not write a duplicate column");
  });
});

describe("getDomainAnalytics", () => {
  it("summarises the domain in a single read", async () => {
    const members = roster(2);
    const fake = fixed([
      ["Member Name", "Domain", YESTERDAY, TODAY],
      ["Curation SE 1", "Curation", "Present", "Present"],
      ["Curation SE 2", "Curation", "Absent", "Present"],
      ["Marketing SE 1", "Marketing", "Present", "Present"],
    ]);

    const data = await getDomainAnalytics(fake.client, members, "Curation", TODAY);

    assert.equal(fake.reads.length, 1);
    assert.equal(fake.writes.length, 0);
    assert.equal(data.totalMembers, 2);
    assert.equal(data.presentToday, 2);
    assert.equal(data.overallPercentage, 75);
    assert.equal(
      data.memberStats.some((m) => m.memberName.startsWith("Marketing")),
      false,
      "another domain's member must never appear",
    );
  });
});

describe("getPasswordOverrides", () => {
  it("reads the Passwords tab, not the Attendance tab", async () => {
    const fake = fixed([
      ["Username", "HashedPassword"],
      ["Curation TE 1", "$2b$10$hash"],
    ]);

    const overrides = await getPasswordOverrides(fake.client);
    assert.equal(fake.reads[0], "'Passwords'!A:ZZ");
    // Keys are lower-cased so a lookup matches however the name was typed into
    // the sheet — `verifyPassword` normalises the username the same way.
    assert.deepEqual(overrides, { "curation te 1": "$2b$10$hash" });
  });

  it("rethrows an outage rather than reporting no overrides (fail closed)", async () => {
    const client: SheetsClient = {
      async getValues() {
        throw new SheetsError("unavailable", "Google Sheets is unavailable.");
      },
      async appendValues() {}, async batchUpdate() {},
    };

    // A caller that saw `{}` here would accept a password the user has changed.
    await assert.rejects(() => getPasswordOverrides(client), SheetsError);
  });
});

describe("updatePassword", () => {
  it("overwrites an existing user's hash in place", async () => {
    const fake = fixed([
      ["Username", "HashedPassword"],
      ["Curation TE 1", "$2b$10$old"],
      ["Tech TE 1", "$2b$10$other"],
    ]);

    await updatePassword(fake.client, "Curation TE 1", "$2b$10$new");

    assert.equal(fake.writes.length, 1);
    assert.deepEqual(fake.writes[0], [
      { range: "'Passwords'!B2", values: [["$2b$10$new"]] },
    ]);
  });

  it("appends a first-time user without disturbing existing rows", async () => {
    const fake = fixed([
      ["Username", "HashedPassword"],
      ["Curation TE 1", "$2b$10$old"],
    ]);

    await updatePassword(fake.client, "Tech TE 1", "$2b$10$new");

    assert.deepEqual(fake.writes[0], [
      { range: "'Passwords'!A3:B3", values: [["Tech TE 1", "$2b$10$new"]] },
    ]);
  });

  it("seeds the header when the tab exists but is empty", async () => {
    const fake = fixed([]);

    await updatePassword(fake.client, "Curation TE 1", "$2b$10$new");

    assert.deepEqual(fake.writes[0], [
      { range: "'Passwords'!A1:B1", values: [["Username", "HashedPassword"]] },
      { range: "'Passwords'!A2:B2", values: [["Curation TE 1", "$2b$10$new"]] },
    ]);
  });

  it("turns a missing tab into an actionable config error", async () => {
    const client: SheetsClient = {
      async getValues() {
        throw new SheetsError("missing-tab", "Unable to parse range: 'Passwords'!A:ZZ");
      },
      async appendValues() {}, async batchUpdate() {
        assert.fail("must not attempt a write into a tab that does not exist");
      },
    };

    await assert.rejects(
      () => updatePassword(client, "Curation TE 1", "$2b$10$new"),
      (error: unknown) =>
        error instanceof SheetsError &&
        error.kind === "config" &&
        error.message.includes("Passwords"),
    );
  });
});

describe("the override window", () => {
  it("reads back the timestamp it wrote", async () => {
    const rows: SheetRows = [["Username", "HashedPassword"]];
    const fake = recorder(() => rows);

    await setOverrideEndMs(fake.client, 1789000000000);
    assert.equal(fake.writes.length, 1);
    const [{ range, values }] = fake.writes[0];
    assert.match(range, /^'Passwords'!A2:B2$/);
    assert.deepEqual(values, [["__override_end__", "1789000000000"]]);
  });

  it("reports no override when the Passwords tab holds only passwords", async () => {
    const fake = fixed([
      ["Username", "HashedPassword"],
      ["Curation TE 1", "$2b$10$hash"],
    ]);
    assert.equal(await getOverrideEndMs(fake.client), 0);
  });
});
