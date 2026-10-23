import type { Domain, Member } from "@/types";

/**
 * The roster. This file is the single source of truth for who exists (spec §14):
 * the login dropdown, the attendance list, analytics, and the backend's
 * domain-authorization check all read from here — nothing reads member names out
 * of the sheet, and nothing hardcodes them in a component.
 *
 * ## The names below are placeholders
 *
 * This is a public repository, so it ships with a sample roster rather than a
 * real one. The shape is the committee's actual shape — six markable domains
 * plus `Core`, several TEs and SEs each — so the app, the tests and the
 * analytics all behave as they do in production. Replace the entries with your
 * own, keeping:
 *
 *  - **at least one `role: "TE"` per domain** — only TEs can log in (spec §5),
 *    so a domain with no TE has no way in. Several TEs per domain is normal and
 *    supported; they share that domain's bootstrap password until each sets
 *    their own, which is why `config/auth.ts` asks them to on day one.
 *  - **`domain` exactly as spelled in `domains.ts`** — the `Domain` type makes a
 *    typo a compile error rather than a member who silently never appears.
 *  - **TEs first, then SEs, domains in `DOMAINS` order** (spec §4). This
 *    ordering is what the sheet's rows are seeded in and what every screen
 *    renders in.
 *
 * `Core` is not a markable domain: Core Members do not appear in any domain's
 * attendance list, they log in to oversee and to open the override window.
 *
 * Renaming a member does **not** rename their sheet row: rows are matched on
 * name, so the old row is left behind and a new one is appended. To rename
 * someone without losing their history, edit column A of the `Attendance`
 * worksheet to match.
 *
 * Adding or removing a member needs a redeploy — the roster is deliberately code
 * rather than sheet data, so a stray edit in the spreadsheet cannot grant someone
 * access (spec §14).
 */
export const MEMBERS: Member[] = [
  // Curation
  { name: "Curation TE 1", domain: "Curation", role: "TE" },
  { name: "Curation TE 2", domain: "Curation", role: "TE" },
  { name: "Curation TE 3", domain: "Curation", role: "TE" },
  { name: "Curation TE 4", domain: "Curation", role: "TE" },
  { name: "Curation SE 1", domain: "Curation", role: "SE" },
  { name: "Curation SE 2", domain: "Curation", role: "SE" },
  { name: "Curation SE 3", domain: "Curation", role: "SE" },
  { name: "Curation SE 4", domain: "Curation", role: "SE" },

  // Marketing
  { name: "Marketing TE 1", domain: "Marketing", role: "TE" },
  { name: "Marketing TE 2", domain: "Marketing", role: "TE" },
  { name: "Marketing TE 3", domain: "Marketing", role: "TE" },
  { name: "Marketing TE 4", domain: "Marketing", role: "TE" },
  { name: "Marketing TE 5", domain: "Marketing", role: "TE" },
  { name: "Marketing TE 6", domain: "Marketing", role: "TE" },
  { name: "Marketing TE 7", domain: "Marketing", role: "TE" },
  { name: "Marketing TE 8", domain: "Marketing", role: "TE" },
  { name: "Marketing SE 1", domain: "Marketing", role: "SE" },
  { name: "Marketing SE 2", domain: "Marketing", role: "SE" },
  { name: "Marketing SE 3", domain: "Marketing", role: "SE" },
  { name: "Marketing SE 4", domain: "Marketing", role: "SE" },
  { name: "Marketing SE 5", domain: "Marketing", role: "SE" },
  { name: "Marketing SE 6", domain: "Marketing", role: "SE" },

  // EPM
  { name: "EPM TE 1", domain: "EPM", role: "TE" },
  { name: "EPM TE 2", domain: "EPM", role: "TE" },
  { name: "EPM TE 3", domain: "EPM", role: "TE" },
  { name: "EPM TE 4", domain: "EPM", role: "TE" },
  { name: "EPM TE 5", domain: "EPM", role: "TE" },
  { name: "EPM TE 6", domain: "EPM", role: "TE" },
  { name: "EPM TE 7", domain: "EPM", role: "TE" },
  { name: "EPM TE 8", domain: "EPM", role: "TE" },
  { name: "EPM SE 1", domain: "EPM", role: "SE" },
  { name: "EPM SE 2", domain: "EPM", role: "SE" },
  { name: "EPM SE 3", domain: "EPM", role: "SE" },
  { name: "EPM SE 4", domain: "EPM", role: "SE" },
  { name: "EPM SE 5", domain: "EPM", role: "SE" },
  { name: "EPM SE 6", domain: "EPM", role: "SE" },
  { name: "EPM SE 7", domain: "EPM", role: "SE" },
  { name: "EPM SE 8", domain: "EPM", role: "SE" },
  { name: "EPM SE 9", domain: "EPM", role: "SE" },

  // PRxEditing
  { name: "PRxEditing TE 1", domain: "PRxEditing", role: "TE" },
  { name: "PRxEditing TE 2", domain: "PRxEditing", role: "TE" },
  { name: "PRxEditing TE 3", domain: "PRxEditing", role: "TE" },
  { name: "PRxEditing TE 4", domain: "PRxEditing", role: "TE" },
  { name: "PRxEditing TE 5", domain: "PRxEditing", role: "TE" },
  { name: "PRxEditing TE 6", domain: "PRxEditing", role: "TE" },
  { name: "PRxEditing SE 1", domain: "PRxEditing", role: "SE" },
  { name: "PRxEditing SE 2", domain: "PRxEditing", role: "SE" },
  { name: "PRxEditing SE 3", domain: "PRxEditing", role: "SE" },
  { name: "PRxEditing SE 4", domain: "PRxEditing", role: "SE" },
  { name: "PRxEditing SE 5", domain: "PRxEditing", role: "SE" },
  { name: "PRxEditing SE 6", domain: "PRxEditing", role: "SE" },
  { name: "PRxEditing SE 7", domain: "PRxEditing", role: "SE" },

  // Design
  { name: "Design TE 1", domain: "Design", role: "TE" },
  { name: "Design TE 2", domain: "Design", role: "TE" },
  { name: "Design TE 3", domain: "Design", role: "TE" },
  { name: "Design SE 1", domain: "Design", role: "SE" },
  { name: "Design SE 2", domain: "Design", role: "SE" },
  { name: "Design SE 3", domain: "Design", role: "SE" },
  { name: "Design SE 4", domain: "Design", role: "SE" },

  // Tech
  { name: "Tech TE 1", domain: "Tech", role: "TE" },
  { name: "Tech TE 2", domain: "Tech", role: "TE" },
  { name: "Tech TE 3", domain: "Tech", role: "TE" },
  { name: "Tech SE 1", domain: "Tech", role: "SE" },
  { name: "Tech SE 2", domain: "Tech", role: "SE" },

  // Core Members (BE students) — exempt from the window, can open the override
  { name: "Core Member 1", domain: "Core", role: "Core Member" },
  { name: "Core Member 2", domain: "Core", role: "Core Member" },
  { name: "Core Member 3", domain: "Core", role: "Core Member" },
  { name: "Core Member 4", domain: "Core", role: "Core Member" },
  { name: "Core Member 5", domain: "Core", role: "Core Member" },
  { name: "Core Member 6", domain: "Core", role: "Core Member" },
];

export const getMembersByDomain = (domain: Domain): Member[] => {
  return MEMBERS.filter((m) => m.domain === domain);
};
