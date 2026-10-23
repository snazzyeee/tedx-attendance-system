"use client";

import styles from "./WindowBanner.module.css";
import {
  attendanceWindowStatus,
  formatDuration,
  WINDOW_LABEL,
} from "@/lib/time/ist";

/**
 * The one-hour window, stated plainly.
 *
 * The whole app is a rule about time, so the rule gets a permanent home at the
 * top of the screen rather than surfacing only as a rejected save. The clock
 * comes from the parent, which anchors it to the server — a device running
 * fast must not be told the window is open when the API will refuse.
 */
export default function WindowBanner({
  nowMs,
  overrideEndMs,
  isCore,
}: {
  nowMs: number;
  overrideEndMs: number;
  isCore: boolean;
}) {
  const status = attendanceWindowStatus(nowMs);
  const overrideActive = overrideEndMs > nowMs;

  if (isCore) {
    return (
      <Banner tone="core" title="Core access">
        You can mark attendance at any time, for any domain.
      </Banner>
    );
  }

  if (overrideActive) {
    return (
      <Banner tone="override" title="Emergency window open">
        Closes in <Countdown ms={overrideEndMs - nowMs} />
      </Banner>
    );
  }

  if (status.open) {
    return (
      <Banner tone="open" title="Attendance is open">
        Closes in <Countdown ms={status.remainingMs} />
      </Banner>
    );
  }

  return (
    <Banner tone="closed" title="Attendance is closed">
      Opens in <Countdown ms={status.remainingMs} /> · {WINDOW_LABEL}
    </Banner>
  );
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: "open" | "closed" | "override" | "core";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role="status">
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.text}>
        <strong className={styles.title}>{title}</strong>
        <span className={styles.detail}>{children}</span>
      </span>
    </div>
  );
}

/** Tabular numerals so a ticking countdown does not jiggle the line it sits on. */
function Countdown({ ms }: { ms: number }) {
  return <span className={styles.countdown}>{formatDuration(ms)}</span>;
}
