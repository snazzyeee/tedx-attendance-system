/**
 * Pure sheet-logic tests. Run with `npm test` — no credentials, no network.
 *
 * Node 26 strips TypeScript types natively, so `node --test` executes these
 * `.ts` files directly and the project needs no test dependency.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTENDANCE_SHEET,
  buildWritePlan,
  cellRange,
  columnLetter,
  computeAnalytics,
  findDateColumn,
  findPasswordRow,
  memberKey,
  parseOverrideEnd,
  parsePasswordRows,
  parseSheet,
  parseState,
  percent,
  projectAttendance,
  readAttendance,
} from "./sheet-model.ts";
import type { SheetRows } from "./sheet-model.ts";
import type { AttendanceChange, Member } from "@/types";

const TODAY = "01/09/2026";
const YESTERDAY = "31/08/2026";

const roster: Member[] = [
  { name: "Curation TE 1", domain: "Curation", role: "TE" },
  { name: "Curation SE 1", domain: "Curation", role: "SE" },
  { name: "Curation SE 2", domain: "Curation", role: "SE" },
];

/** A sheet with two recorded dates and one Marketing row mixed in. */
function sampleSheet(): SheetRows {
  return [
    ["Member Name", "Domain", YESTERDAY, TODAY],
    ["Curation TE 1", "Curation", "Present", "Present"],
    ["Curation SE 1", "Curation", "Present", "Absent"],
    ["Curation SE 2", "Curation", "Absent", ""],
    ["Marketing TE 1", "Marketing", "Present", "Present"],
  ];
}

describe("columnLetter", () => {
  it("maps indices to sheet letters past Z", () => {
    const got = [0, 1, 2, 25, 26, 27, 51, 52].map(columnLetter);
    assert.deepEqual(got, ["A", "B", "C", "Z", "AA", "AB", "AZ", "BA"]);
  });

  it("rejects a negative or fractional index rather than producing nonsense", () => {
    assert.throws(() => columnLetter(-1));
    assert.throws(() => columnLetter(1.5));
  });
});

describe("cellRange", () => {
  it("quotes the sheet name and converts to 1-based rows", () => {
    assert.equal(cellRange("Attendance", 2, 3), "'Attendance'!C4");
    assert.equal(cellRange("My Sheet", 0, 0), "'My Sheet'!A1");
  });
});

describe("memberKey", () => {
  it("is case- and whitespace-insensitive", () => {
    assert.equal(memberKey("  Curation TE 1 ", "curation"), memberKey("CURATION TE 1", "Curation"));
  });

  it("cannot collide across a name/domain boundary", () => {
    assert.notEqual(memberKey("A B", "C"), memberKey("A", "B C"));
  });
});

describe("parseState", () => {
  it("treats only an explicit Present as present (spec §7A)", () => {
    for (const value of ["Present", "present", " PRESENT "]) {
      assert.equal(parseState(value), "Present", `${JSON.stringify(value)} should be Present`);
    }
    for (const value of ["Absent", "", "  ", undefined, null, 0, "yes", "P"]) {
      assert.equal(parseState(value), "Absent", `${JSON.stringify(value)} should be Absent`);
    }
  });
});

describe("parseSheet", () => {
  it("indexes date columns from column C onwards", () => {
    const parsed = parseSheet(sampleSheet());
    assert.deepEqual(parsed.dateColumns, [YESTERDAY, TODAY]);
    assert.equal(parsed.dateColumnIndex.get(YESTERDAY), 2);
    assert.equal(parsed.dateColumnIndex.get(TODAY), 3);
  });

  it("keeps the first of a duplicate date header so no third gets added", () => {
    const parsed = parseSheet([
      ["Member Name", "Domain", TODAY, TODAY],
      ["Curation TE 1", "Curation", "Present", "Absent"],
    ]);
    assert.equal(parsed.dateColumnIndex.get(TODAY), 2);
    assert.deepEqual(parsed.dateColumns, [TODAY]);
  });

  it("ignores blank spacer columns and rows without a name", () => {
    const parsed = parseSheet([
      ["Member Name", "Domain", "", TODAY],
      ["", "", "", ""],
      ["Curation TE 1", "Curation", "", "Present"],
    ]);
    assert.deepEqual(parsed.dateColumns, [TODAY]);
    assert.equal(parsed.rowIndexByMember.size, 1);
    assert.equal(parsed.rowIndexByMember.get(memberKey("Curation TE 1", "Curation")), 2);
  });

  it("reports the widest row, not just the header width", () => {
    const parsed = parseSheet([
      ["Member Name", "Domain", TODAY],
      ["Curation TE 1", "Curation", "Present", "stray", "cells"],
    ]);
    assert.equal(parsed.width, 5);
  });
});

describe("findDateColumn", () => {
  it("returns -1 when today has no column yet (spec §13)", () => {
    assert.equal(findDateColumn(sampleSheet(), "02/09/2026"), -1);
    assert.equal(findDateColumn(sampleSheet(), TODAY), 3);
  });
});

describe("readAttendance", () => {
  it("returns one record per configured member, in config order", () => {
    const records = readAttendance(sampleSheet(), roster, TODAY);
    assert.deepEqual(
      records.map((r) => r.memberName),
      ["Curation TE 1", "Curation SE 1", "Curation SE 2"],
    );
    assert.deepEqual(
      records.map((r) => r.state),
      ["Present", "Absent", "Absent"],
    );
  });

  it("never leaks another domain's rows", () => {
    const records = readAttendance(sampleSheet(), roster, TODAY);
    assert.equal(
      records.some((r) => r.memberName.startsWith("Marketing")),
      false,
    );
    assert.equal(
      records.every((r) => r.domain === "Curation"),
      true,
    );
  });

  it("shows a configured member with no sheet row as Absent, not missing", () => {
    const newcomer: Member = { name: "Curation SE 9", domain: "Curation", role: "SE" };
    const records = readAttendance(sampleSheet(), [...roster, newcomer], TODAY);
    assert.equal(records.length, 4);
    assert.deepEqual(records[3], {
      memberName: "Curation SE 9",
      domain: "Curation",
      role: "SE",
      state: "Absent",
    });
  });

  it("reads everyone as Absent on a date the sheet has never recorded", () => {
    const records = readAttendance(sampleSheet(), roster, "05/09/2026");
    assert.equal(
      records.every((r) => r.state === "Absent"),
      true,
    );
  });

  it("carries the role through so the UI can label TE vs SE", () => {
    const records = readAttendance(sampleSheet(), roster, TODAY);
    assert.deepEqual(
      records.map((r) => r.role),
      ["TE", "SE", "SE"],
    );
  });
});

describe("buildWritePlan", () => {
  const change = (memberName: string, state: "Present" | "Absent"): AttendanceChange => ({
    memberName,
    state,
  });

  it("writes only the members named in changes (spec §15)", () => {
    const plan = buildWritePlan({
      rows: sampleSheet(),
      roster,
      dateStr: TODAY,
      changes: [change("Curation SE 2", "Present")],
      domain: "Curation",
    });

    assert.equal(plan.createdDateColumn, false);
    assert.deepEqual(plan.data, [{ range: "'Attendance'!D4", values: [["Present"]] }]);

    // The other members' cells must not appear anywhere in the batch.
    const ranges = plan.data.map((d) => d.range).join(" ");
    for (const untouched of ["D2", "D3", "D5"]) {
      assert.equal(ranges.includes(untouched), false, `${untouched} must not be written`);
    }
  });

  it("reuses today's column instead of appending a duplicate (spec §6)", () => {
    const plan = buildWritePlan({
      rows: sampleSheet(),
      roster,
      dateStr: TODAY,
      changes: [change("Curation TE 1", "Absent")],
      domain: "Curation",
    });
    assert.equal(plan.dateColumnIndex, 3);
    assert.equal(plan.createdDateColumn, false);
    assert.equal(
      plan.data.some((d) => d.values[0][0] === TODAY),
      false,
      "must not rewrite the date header",
    );
  });

  it("appends a new date column past the widest used cell", () => {
    const plan = buildWritePlan({
      rows: sampleSheet(),
      roster,
      dateStr: "02/09/2026",
      changes: [change("Curation TE 1", "Present")],
      domain: "Curation",
    });
    assert.equal(plan.createdDateColumn, true);
    assert.equal(plan.dateColumnIndex, 4);
    assert.deepEqual(plan.data[0], {
      range: "'Attendance'!E1",
      values: [["02/09/2026"]],
    });
    assert.deepEqual(plan.data[1], {
      range: "'Attendance'!E2",
      values: [["Present"]],
    });
  });

  it("seeds headers and the whole roster in config order on an empty sheet (spec §4)", () => {
    const plan = buildWritePlan({
      rows: [],
      roster,
      dateStr: TODAY,
      changes: [change("Curation SE 1", "Present")],
      domain: "Curation",
    });

    assert.equal(plan.seededSheet, true);
    assert.deepEqual(plan.data[0], {
      range: "'Attendance'!A1:B1",
      values: [["Member Name", "Domain"]],
    });
    assert.deepEqual(plan.data[1], {
      range: "'Attendance'!A2:B4",
      values: [
        ["Curation TE 1", "Curation"],
        ["Curation SE 1", "Curation"],
        ["Curation SE 2", "Curation"],
      ],
    });
    // Date column lands at C, and SE 1 is row 3 because config order was kept.
    assert.equal(plan.dateColumnIndex, 2);
    assert.deepEqual(plan.data.at(-1), { range: "'Attendance'!C3", values: [["Present"]] });
  });

  it("appends a configured member who has no sheet row yet (spec §15)", () => {
    const newcomer: Member = { name: "Curation SE 9", domain: "Curation", role: "SE" };
    const plan = buildWritePlan({
      rows: sampleSheet(),
      roster: [...roster, newcomer],
      dateStr: TODAY,
      changes: [change("Curation SE 9", "Present")],
      domain: "Curation",
    });

    assert.deepEqual(plan.appendedMembers, ["Curation SE 9"]);
    assert.deepEqual(plan.data, [
      { range: "'Attendance'!A6:B6", values: [["Curation SE 9", "Curation"]] },
      { range: "'Attendance'!D6", values: [["Present"]] },
    ]);
  });

  it("gives each appended member its own row", () => {
    const extra: Member[] = [
      { name: "Curation SE 8", domain: "Curation", role: "SE" },
      { name: "Curation SE 9", domain: "Curation", role: "SE" },
    ];
    const plan = buildWritePlan({
      rows: sampleSheet(),
      roster: [...roster, ...extra],
      dateStr: TODAY,
      changes: [change("Curation SE 8", "Present"), change("Curation SE 9", "Absent")],
      domain: "Curation",
    });
    const rows = plan.data.map((d) => d.range);
    assert.deepEqual(rows, [
      "'Attendance'!A6:B6",
      "'Attendance'!D6",
      "'Attendance'!A7:B7",
      "'Attendance'!D7",
    ]);
  });

  it("collapses duplicate changes for one member, last write winning", () => {
    const plan = buildWritePlan({
      rows: sampleSheet(),
      roster,
      dateStr: TODAY,
      changes: [
        change("Curation TE 1", "Present"),
        change("Curation TE 1", "Absent"),
      ],
      domain: "Curation",
    });
    assert.deepEqual(plan.data, [{ range: "'Attendance'!D2", values: [["Absent"]] }]);
  });

  it("silently drops a name that is not in the roster", () => {
    // The route rejects these with a 403 first; the model refuses to invent a
    // row for one so a bug upstream cannot corrupt the sheet.
    const plan = buildWritePlan({
      rows: sampleSheet(),
      roster,
      dateStr: TODAY,
      changes: [change("Marketing TE 1", "Present")],
      domain: "Curation",
    });
    assert.deepEqual(plan.data, []);
  });

  it("scales to one cell per changed member and nothing else", () => {
    const many: Member[] = Array.from({ length: 10 }, (_, i) => ({
      name: `Curation SE ${i + 10}`,
      domain: "Curation" as const,
      role: "SE" as const,
    }));
    const rows: SheetRows = [
      ["Member Name", "Domain", TODAY],
      ...many.map((m) => [m.name, m.domain, ""]),
    ];
    const plan = buildWritePlan({
      rows,
      roster: many,
      dateStr: TODAY,
      changes: many.map((m) => change(m.name, "Present")),
      domain: "Curation",
    });
    assert.equal(plan.data.length, 10);
    assert.equal(plan.createdDateColumn, false);
    assert.deepEqual(plan.appendedMembers, []);
  });

  it("targets the sheet it was given", () => {
    const plan = buildWritePlan({
      rows: sampleSheet(),
      roster,
      dateStr: TODAY,
      changes: [change("Curation TE 1", "Present")],
      domain: "Curation",
      sheetName: "Other Tab",
    });
    assert.equal(plan.data[0].range, "'Other Tab'!D2");
    assert.equal(ATTENDANCE_SHEET, "Attendance");
  });
});

describe("percent", () => {
  it("rounds to one decimal and treats an empty denominator as 0", () => {
    assert.equal(percent(1, 3), 33.3);
    assert.equal(percent(2, 3), 66.7);
    assert.equal(percent(3, 3), 100);
    assert.equal(percent(0, 0), 0);
    assert.equal(percent(5, -1), 0);
  });
});

describe("computeAnalytics", () => {
  it("computes member-wise and date-wise figures for the domain only (spec §10)", () => {
    const data = computeAnalytics(sampleSheet(), roster, "Curation", TODAY);

    assert.equal(data.domain, "Curation");
    assert.equal(data.totalMembers, 3);
    assert.equal(data.todayRecorded, true);
    assert.equal(data.presentToday, 1);
    assert.equal(data.absentToday, 2);
    assert.equal(data.todayPercentage, 33.3);

    assert.deepEqual(
      data.memberStats.map((m) => [m.memberName, m.present, m.total, m.percentage]),
      [
        ["Curation TE 1", 2, 2, 100],
        ["Curation SE 1", 1, 2, 50],
        ["Curation SE 2", 0, 2, 0],
      ],
    );

    assert.deepEqual(
      data.dateStats.map((d) => [d.date, d.present, d.absent]),
      [
        [YESTERDAY, 2, 1],
        [TODAY, 1, 2],
      ],
    );

    // 3 present marks out of 3 members x 2 days.
    assert.equal(data.overallPercentage, 50);
  });

  it("flags a day with no column yet instead of reporting a real 0%", () => {
    const data = computeAnalytics(sampleSheet(), roster, "Curation", "09/09/2026");
    assert.equal(data.todayRecorded, false);
    assert.equal(data.presentToday, 0);
    assert.equal(data.absentToday, 3);
  });

  it("survives an empty sheet without dividing by zero", () => {
    const data = computeAnalytics([], roster, "Curation", TODAY);
    assert.deepEqual(data.dateStats, []);
    assert.equal(data.overallPercentage, 0);
    assert.equal(data.todayPercentage, 0);
    assert.equal(data.memberStats.length, 3);
    assert.equal(
      data.memberStats.every((m) => m.total === 0 && m.percentage === 0),
      true,
    );
  });
});

describe("parsePasswordRows", () => {
  it("maps a lower-cased username to a hash and skips a header row", () => {
    const overrides = parsePasswordRows([
      ["Username", "HashedPassword"],
      ["Curation TE 1", "$2b$10$hash1"],
      ["Marketing TE 1", "$2b$10$hash2"],
    ]);
    // Lower-cased on the way in so a lookup matches whatever casing a human
    // typed into the sheet; `verifyPassword` normalises the same way.
    assert.deepEqual(overrides, {
      "curation te 1": "$2b$10$hash1",
      "marketing te 1": "$2b$10$hash2",
    });
  });

  it("does not drop the first row when the tab has no header", () => {
    const overrides = parsePasswordRows([["Curation TE 1", "$2b$10$hash1"]]);
    assert.deepEqual(overrides, { "curation te 1": "$2b$10$hash1" });
  });

  it("ignores rows missing a username or a hash", () => {
    const overrides = parsePasswordRows([
      ["Curation TE 1", ""],
      ["", "$2b$10$orphan"],
      ["Tech TE 1", "$2b$10$ok"],
    ]);
    assert.deepEqual(overrides, { "tech te 1": "$2b$10$ok" });
  });

  it("never surfaces the override timestamp as somebody's password", () => {
    // The override window shares this tab. If it leaked into the password map,
    // a member named __OVERRIDE_END__ would have a credential row that is not
    // a bcrypt hash at all.
    const overrides = parsePasswordRows([
      ["Username", "HashedPassword"],
      ["__OVERRIDE_END__", "1789000000000"],
      ["Tech TE 1", "$2b$10$ok"],
    ]);
    assert.deepEqual(overrides, { "tech te 1": "$2b$10$ok" });
  });
});

describe("parseOverrideEnd", () => {
  it("finds the timestamp whatever case it was written in", () => {
    assert.equal(
      parseOverrideEnd([
        ["Username", "HashedPassword"],
        ["Tech TE 1", "$2b$10$ok"],
        ["__override_end__", "1789000000000"],
      ]),
      1789000000000,
    );
  });

  it("reads a missing, blank or malformed value as no override", () => {
    assert.equal(parseOverrideEnd([]), 0);
    assert.equal(parseOverrideEnd([["Tech TE 1", "$2b$10$ok"]]), 0);
    for (const value of ["", "   ", "not-a-number", "-1", "0"]) {
      assert.equal(parseOverrideEnd([["__OVERRIDE_END__", value]]), 0, value);
    }
  });
});

describe("projectAttendance", () => {
  const dateStr = TODAY;

  it("reports the state a save is about to write, not the stale one", () => {
    const projected = projectAttendance(sampleSheet(), roster, dateStr, [
      { memberName: "Curation SE 2", state: "Present" },
    ]);

    const byName = new Map(projected.map((r) => [r.memberName, r.state]));
    assert.equal(byName.get("Curation SE 2"), "Present", "the changed member");
    assert.equal(byName.get("Curation SE 1"), "Absent", "untouched, from the sheet");
    assert.equal(byName.get("Curation TE 1"), "Present", "untouched, from the sheet");
  });

  it("carries through another TE's marks that are already in the grid", () => {
    // The point of returning this from a save: the browser's optimistic guess
    // knows only its own taps, but the grid the save read knows everyone's.
    const projected = projectAttendance(sampleSheet(), roster, dateStr, [
      { memberName: "Curation SE 2", state: "Present" },
    ]);
    assert.equal(
      projected.find((r) => r.memberName === "Curation TE 1")?.state,
      "Present",
    );
  });

  it("matches member names case-insensitively", () => {
    const projected = projectAttendance(sampleSheet(), roster, dateStr, [
      { memberName: "  curation se 1  ", state: "Present" },
    ]);
    assert.equal(
      projected.find((r) => r.memberName === "Curation SE 1")?.state,
      "Present",
    );
  });

  it("returns every configured member, in configured order", () => {
    const projected = projectAttendance([], roster, dateStr, []);
    assert.deepEqual(
      projected.map((r) => r.memberName),
      roster.map((m) => m.name),
    );
  });
});

describe("findPasswordRow", () => {
  it("finds a user case-insensitively, or reports -1", () => {
    const rows: SheetRows = [
      ["Username", "HashedPassword"],
      ["Curation TE 1", "$2b$10$hash1"],
    ];
    assert.equal(findPasswordRow(rows, "curation te 1"), 1);
    assert.equal(findPasswordRow(rows, "Tech TE 1"), -1);
  });
});
