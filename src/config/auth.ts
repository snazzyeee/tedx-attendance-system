import type { Domain } from "@/types";

/**
 * One initial password per domain, shared by that domain's TE on first login
 * (spec §5).
 *
 * The values below are deliberate placeholders, not the deployed ones — this
 * repository is public, so anything committed here is readable by anyone.
 * Replace all seven before the first deploy; `CHANGE_ME_*` is left in place so
 * that forgetting is obvious at the login screen rather than silent.
 *
 * These are plaintext by design: they are bootstrap credentials, not stored
 * secrets. The moment a TE changes their password, a bcrypt hash lands in the
 * `Passwords` worksheet keyed by their name, and `verifyPassword` uses that hash
 * instead — the value below stops working for them (see
 * `src/lib/auth/credentials.ts`).
 *
 * Consequences worth knowing before deploying:
 *  - Anyone who can read this file can log in as any TE who has not yet changed
 *    their password. Change these from the values below, and ask each TE to set
 *    their own password at `/change-password` on day one.
 *  - Because the fallback is per *domain*, not per person, a second TE in the
 *    same domain would share it. `members.ts` documents the one-TE-per-domain
 *    assumption for that reason.
 *  - Editing a value here does not revoke a password already changed in the
 *    sheet. To reset someone, delete their row from the `Passwords` worksheet.
 */
export const INITIAL_PASSWORDS: Record<Domain, string> = {
  Curation: "CHANGE_ME_Curation",
  Marketing: "CHANGE_ME_Marketing",
  EPM: "CHANGE_ME_EPM",
  PRxEditing: "CHANGE_ME_PRxEditing",
  Design: "CHANGE_ME_Design",
  Tech: "CHANGE_ME_Tech",
  Core: "CHANGE_ME_Core",
};
