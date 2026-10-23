"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./OverridePanel.module.css";
import { formatDuration, WINDOW_LABEL } from "@/lib/time/ist";

/**
 * The Core Members' 15-minute override switch.
 *
 * Split out of `AttendanceList` so the dashboard is not carrying a second
 * screen's worth of inline styles — and so the button that opens the door for
 * every TE in the club is a file someone can read on its own.
 */
export default function OverridePanel({
  overrideEndMs,
  nowMs,
  onChange,
  onError,
}: {
  overrideEndMs: number;
  nowMs: number;
  onChange: (endMs: number, serverTimeMs?: number) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const active = overrideEndMs > nowMs;

  const send = async (action: "start" | "stop") => {
    setBusy(true);
    try {
      const res = await fetch("/api/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const data = (await res.json().catch(() => null)) as
        | { overrideEndMs?: number; serverTimeMs?: number; error?: string }
        | null;

      if (!res.ok || typeof data?.overrideEndMs !== "number") {
        onError(data?.error ?? "Failed to update the override window.");
        return;
      }

      onChange(data.overrideEndMs, data.serverTimeMs);
    } catch {
      onError("Unable to reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${styles.panel} ${active ? styles.active : ""}`}>
      <div className={styles.info}>
        <h2 className={styles.title}>Global override window</h2>
        <p className={styles.detail}>
          {active ? (
            <>
              Open — every TE can mark attendance for{" "}
              <span className={styles.countdown}>
                {formatDuration(overrideEndMs - nowMs)}
              </span>
              .
            </>
          ) : (
            <>Closed — TEs are restricted to {WINDOW_LABEL}.</>
          )}
        </p>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className="btn-primary btn-compact"
          disabled={busy || active}
          onClick={() => send("start")}
        >
          Open 15 min
        </button>
        <button
          type="button"
          className="btn-danger btn-compact"
          disabled={busy || !active}
          onClick={() => send("stop")}
        >
          Close now
        </button>
      </div>
    </section>
  );
}
