/**
 * The only module in the app that talks to Google over the network.
 *
 * Everything else depends on the `SheetsClient` interface, which is what lets
 * the service layer be tested with a fake (see `attendance-service.test.ts`)
 * and keeps Sheets specifics out of UI and route code (spec §13).
 */
import { google } from "googleapis";
import { SheetsError, classifyError } from "./errors.ts";
import type { SheetRows, WriteCell } from "./sheet-model.ts";

export { SheetsError, classifyError };
export type { SheetsErrorKind } from "./errors.ts";

export interface SheetsClient {
  getValues(range: string): Promise<SheetRows>;
  /** One request for many non-contiguous cells (spec §7). */
  batchUpdate(data: WriteCell[]): Promise<void>;
  /** Append rows to a specific tab. */
  appendValues(range: string, values: (string | number | boolean | null)[][]): Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new SheetsError(
      "config",
      `Missing required environment variable ${name}. See README § Environment.`,
    );
  }
  return value;
}

let cached: SheetsClient | null = null;

export function getSheetsClient(): SheetsClient {
  if (cached) return cached;

  const spreadsheetId = requireEnv("GOOGLE_SHEET_ID");
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: requireEnv("GOOGLE_CLIENT_EMAIL"),
      // Vercel and .env files store the PEM with escaped newlines.
      private_key: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  cached = {
    async getValues(range) {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });
        return response.data.values ?? [];
      } catch (error) {
        throw classifyError(error);
      }
    },

    async batchUpdate(data) {
      if (data.length === 0) return;
      try {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "USER_ENTERED", data },
        });
      } catch (error) {
        throw classifyError(error);
      }
    },

    async appendValues(range, values) {
      if (values.length === 0) return;
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        });
      } catch (error) {
        throw classifyError(error);
      }
    },
  };

  return cached;
}
