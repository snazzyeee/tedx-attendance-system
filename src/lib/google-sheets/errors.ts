/**
 * Sheets error taxonomy. Network-free on purpose: the service layer and the
 * route handlers both need to classify failures, but neither should pull
 * `googleapis` into scope (which would also stop the offline tests from
 * loading under bare `node --test`).
 */

export type SheetsErrorKind =
  /** A worksheet tab does not exist. Often benign (e.g. no Passwords tab yet). */
  | "missing-tab"
  /** Credentials/sheet ID missing or rejected — an operator problem. */
  | "config"
  /** Transient: network down, quota exceeded, Google 5xx. */
  | "unavailable";

export class SheetsError extends Error {
  readonly kind: SheetsErrorKind;

  constructor(kind: SheetsErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SheetsError";
    this.kind = kind;
  }
}

interface GoogleApiError {
  code?: number | string;
  message?: string;
  errors?: { reason?: string; message?: string }[];
}

/**
 * Map a googleapis rejection onto something the routes can turn into a status
 * code. Without this, a missing `Passwords` tab and a real outage are
 * indistinguishable — which is how the previous version ended up failing open.
 */
export function classifyError(error: unknown): SheetsError {
  if (error instanceof SheetsError) return error;

  const err = (error ?? {}) as GoogleApiError;
  const status = Number(err.code);
  const message = err.message ?? String(error);

  if (status === 400 && /unable to parse range/i.test(message)) {
    return new SheetsError("missing-tab", message, { cause: error });
  }
  if (status === 401 || status === 403) {
    return new SheetsError(
      "config",
      `Google rejected the service account (${status}). Confirm the sheet is shared with GOOGLE_CLIENT_EMAIL as Editor. ${message}`,
      { cause: error },
    );
  }
  if (status === 404) {
    return new SheetsError(
      "config",
      `Spreadsheet not found. Check GOOGLE_SHEET_ID. ${message}`,
      { cause: error },
    );
  }
  return new SheetsError("unavailable", message, { cause: error });
}

/** Narrowing helper for callers that only care about one kind. */
export function isSheetsErrorKind(error: unknown, kind: SheetsErrorKind): boolean {
  return error instanceof SheetsError && error.kind === kind;
}
