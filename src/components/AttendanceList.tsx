"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./AttendanceList.module.css";
import AttendanceToggle from "./AttendanceToggle";
import OverridePanel from "./OverridePanel";
import WindowBanner from "./WindowBanner";
import {
  attendanceWindowStatus,
  WINDOW_CLOSED_MESSAGE,
} from "@/lib/time/ist";
import type {
  AttendanceRecord,
  AttendanceResponse,
  AttendanceSaveResponse,
  AttendanceState,
  Domain,
  Role,
} from "@/types";

interface Props {
  domain: Domain;
  role: Role;
}

type Status = "loading" | "error" | "ready";
type SaveState = "idle" | "saving" | "saved" | "failed";

/**
 * How long to wait for more taps before sending a save.
 *
 * This is the whole fix for the app's worst efficiency problem. Every toggle
 * used to POST on its own, and every POST costs a `values.get`, a
 * `values.batchUpdate` and an audit append — so one TE marking a fourteen-person
 * roster spent ~42 of Google's 60 requests-per-minute, and two domains marking
 * at 3 PM could exhaust the quota during the only hour the app is usable.
 * Coalescing a burst of taps into one request turns that into 3, whatever the
 * roster size, with no change to how the screen behaves.
 */
const SAVE_DEBOUNCE_MS = 700;

/** How long "Saved" stays up before the indicator goes quiet again. */
const SAVED_NOTICE_MS = 2000;

type FetchResult =
  | {
      kind: "ok";
      records: AttendanceRecord[];
      overrideEndMs: number;
      serverTimeMs: number;
    }
  | { kind: "unauthorized" }
  | { kind: "error"; error: string };

/** Read the domain's roster. Module-level: no state, nothing to memoise. */
async function fetchAttendance(domain: Domain): Promise<FetchResult> {
  try {
    const res = await fetch(`/api/attendance?domain=${encodeURIComponent(domain)}`, {
      cache: "no-store",
    });
    if (res.status === 401) return { kind: "unauthorized" };

    const data = (await res.json().catch(() => null)) as
      | (Partial<AttendanceResponse> & { error?: string })
      | null;

    if (!res.ok) {
      return { kind: "error", error: data?.error ?? "Unable to load attendance." };
    }

    return {
      kind: "ok",
      records: data?.records ?? [],
      overrideEndMs: data?.overrideEndMs ?? 0,
      serverTimeMs: data?.serverTimeMs ?? Date.now(),
    };
  } catch {
    return {
      kind: "error",
      error: "Unable to reach the server. Please check your connection.",
    };
  }
}

export default function AttendanceList({ domain, role }: Props) {
  const router = useRouter();
  const isCore = role === "Core Member";

  const [status, setStatus] = useState<Status>("loading");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [overrideEndMs, setOverrideEndMs] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  /**
   * The server's clock, tracked as an offset from this device's.
   *
   * The window is decided server-side, so a phone running five minutes fast
   * must not be shown an open window that will reject its saves.
   */
  const clockOffsetRef = useRef(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  /** Marks tapped but not yet sent. Survives re-renders without causing them. */
  const pendingRef = useRef(new Map<string, AttendanceState>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncClock = useCallback((serverTimeMs: number | undefined) => {
    if (typeof serverTimeMs === "number" && Number.isFinite(serverTimeMs)) {
      clockOffsetRef.current = serverTimeMs - Date.now();
    }
  }, []);

  // One ticker for the whole screen. The member rows are memoised below so this
  // repaints the countdown only, not twenty toggle buttons a second.
  useEffect(() => {
    const tick = () => setNowMs(Date.now() + clockOffsetRef.current);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const windowOpen = attendanceWindowStatus(nowMs).open;
  const overrideActive = overrideEndMs > nowMs;
  const canMark = isCore || windowOpen || overrideActive;

  // --- loading ------------------------------------------------------------

  /**
   * Fold a fetch result into state.
   *
   * Fetching (`fetchAttendance`, below) is kept out of the component entirely
   * and the state update happens in a `.then` callback, which is the shape
   * React's rules actually want: an effect subscribes to an external system and
   * setState lands in the callback, never in the effect body.
   */
  const apply = useCallback(
    (result: FetchResult) => {
      if (!mountedRef.current) return;

      if (result.kind === "unauthorized") {
        router.push("/login");
        return;
      }
      if (result.kind === "error") {
        setLoadError(result.error);
        setStatus("error");
        return;
      }

      syncClock(result.serverTimeMs);
      setRecords(result.records);
      setOverrideEndMs(result.overrideEndMs);
      setLoadError("");
      setStatus("ready");
    },
    [router, syncClock],
  );

  const reload = useCallback(
    () => fetchAttendance(domain).then(apply),
    [domain, apply],
  );

  useEffect(() => {
    fetchAttendance(domain).then(apply);
  }, [domain, apply]);

  // --- saving -------------------------------------------------------------

  /**
   * Always points at the newest `flush`.
   *
   * A save that finds more taps queued when it lands has to start another one,
   * and a function cannot close over itself without defeating memoisation. The
   * indirection keeps the drain loop while leaving `flush` a plain callback.
   */
  const latestFlush = useRef<(() => void) | null>(null);

  const flush = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // One request at a time: a second in-flight save would race the first over
    // the same cells, and the loser's read would already be stale.
    if (inFlightRef.current || pendingRef.current.size === 0) return;

    const batch = Array.from(pendingRef.current, ([memberName, state]) => ({
      memberName,
      state,
    }));
    pendingRef.current.clear();
    inFlightRef.current = true;
    setSaveState("saving");

    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, changes: batch }),
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const data = (await res.json().catch(() => null)) as
        | (Partial<AttendanceSaveResponse> & { error?: string })
        | null;

      if (!res.ok) {
        // The optimistic marks may or may not have landed, so guessing is worse
        // than asking: re-read and show whatever the sheet actually says.
        setMessage(data?.error ?? "Unable to save attendance. Please try again.");
        setSaveState("failed");
        await reload();
        return;
      }

      syncClock(data?.serverTimeMs);

      if (data?.records) {
        // Authoritative state, computed from the grid the save already read —
        // so this also picks up a second TE's concurrent marks for free. Any
        // tap made while the request was in flight wins over it.
        const stillPending = pendingRef.current;
        setRecords(
          data.records.map((record) => {
            const queued = stillPending.get(record.memberName);
            return queued === undefined ? record : { ...record, state: queued };
          }),
        );
      }

      // A failed audit append is a note, not a failure: the marks are in the
      // sheet. Saying "Not saved" here would send a TE back to re-tap a roster
      // that is already correct.
      setMessage(
        data?.auditFailed
          ? 'Saved. The "Audit Log" tab is missing, so this was not logged.'
          : "",
      );
      setSaveState("saved");
    } catch {
      setMessage("Unable to reach the server. Your last change was not saved.");
      setSaveState("failed");
      await reload();
    } finally {
      inFlightRef.current = false;
      // Taps that arrived mid-request are still queued; drain them rather than
      // waiting for the TE to touch something else.
      if (mountedRef.current && pendingRef.current.size > 0) latestFlush.current?.();
    }
  }, [domain, reload, router, syncClock]);

  useEffect(() => {
    latestFlush.current = () => void flush();
  }, [flush]);

  // Clear the "Saved" notice on a timer, and never leave a timer behind.
  useEffect(() => {
    if (saveState !== "saved") return;
    savedTimerRef.current = setTimeout(() => setSaveState("idle"), SAVED_NOTICE_MS);
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, [saveState]);

  /**
   * Send whatever is queued before the page can go away.
   *
   * A debounce that loses the last tap when a TE locks their phone would be a
   * worse bug than the one it fixes, so anything still pending is flushed the
   * moment the tab is hidden or unmounted.
   */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      void flush();
    };
  }, [flush]);

  const handleToggle = useCallback(
    (memberName: string, nextState: AttendanceState) => {
      if (!canMark) {
        setMessage(WINDOW_CLOSED_MESSAGE);
        setSaveState("failed");
        return;
      }

      setMessage("");
      setRecords((current) =>
        current.map((r) =>
          r.memberName === memberName ? { ...r, state: nextState } : r,
        ),
      );

      pendingRef.current.set(memberName, nextState);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
      setSaveState("saving");
    },
    [canMark, flush],
  );

  const handleOverrideChange = useCallback(
    (endMs: number, serverTimeMs?: number) => {
      syncClock(serverTimeMs);
      setOverrideEndMs(endMs);
    },
    [syncClock],
  );

  // --- rendering ----------------------------------------------------------

  /**
   * Memoised against the once-a-second tick above: when only `nowMs` changes,
   * these elements keep their identity and React skips the whole list.
   */
  const rows = useMemo(
    () =>
      records.map((record) => (
        <li key={record.memberName} className={styles.row}>
          <span className={styles.memberName}>
            {record.memberName}
            <span className={styles.role}>{record.role}</span>
          </span>
          <AttendanceToggle
            state={record.state}
            memberName={record.memberName}
            disabled={!canMark}
            onChange={(next) => handleToggle(record.memberName, next)}
          />
        </li>
      )),
    [records, canMark, handleToggle],
  );

  if (status === "loading") {
    return (
      <div className={styles.container} aria-busy="true">
        <p className={styles.statusText}>Loading {domain} attendance…</p>
        <ul className={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className={styles.skeletonRow}>
              <span className={styles.skeletonName} />
              <span className={styles.skeletonToggle} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={styles.container}>
        <p className="error-text" role="alert">
          {loadError}
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setStatus("loading");
            setLoadError("");
            void reload();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className={styles.container}>
        <p className={styles.statusText}>
          No members are configured for {domain}. Add them to{" "}
          <code>src/config/members.ts</code>.
        </p>
      </div>
    );
  }

  const presentCount = records.filter((r) => r.state === "Present").length;
  const presentPercent = Math.round((presentCount / records.length) * 100);

  return (
    <div className={styles.container}>
      {isCore && (
        <OverridePanel
          overrideEndMs={overrideEndMs}
          nowMs={nowMs}
          onChange={handleOverrideChange}
          onError={(text) => {
            setMessage(text);
            setSaveState("failed");
          }}
        />
      )}

      <WindowBanner
        nowMs={nowMs}
        overrideEndMs={overrideEndMs}
        isCore={isCore}
      />

      <div className={styles.summary}>
        <div className={styles.summaryCount}>
          <strong>{presentCount}</strong>
          <span className={styles.summaryTotal}>/ {records.length} present</span>
        </div>
        <div
          className={styles.summaryBar}
          role="meter"
          aria-valuenow={presentPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Share of the domain marked present"
        >
          <span className={styles.summaryFill} style={{ width: `${presentPercent}%` }} />
        </div>
        <SaveIndicator state={saveState} />
      </div>

      <ul className={styles.list}>{rows}</ul>

      {/* `role="status"` so a screen reader hears a save failure without the
          message stealing focus mid-roll-call. */}
      <div className={styles.footer} role="status" aria-live="polite">
        {message && (
          <p className={saveState === "failed" ? "error-text" : styles.notice}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;

  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Not saved";

  return (
    <span
      className={`${styles.saveIndicator} ${styles[`save_${state}`]}`}
      aria-live="polite"
    >
      {label}
    </span>
  );
}
