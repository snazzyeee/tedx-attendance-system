"use client";

import styles from "./AttendanceToggle.module.css";
import type { AttendanceState } from "@/types";

interface Props {
  state: AttendanceState;
  memberName: string;
  disabled?: boolean;
  onChange: (newState: AttendanceState) => void;
}

/**
 * Blocky TEDx toggle switch.
 *
 * Fully controlled: the parent owns the state. An early version seeded
 * `useState` from a prop, which meant a re-read from the sheet could not move
 * the switch — the UI silently drifted from the source of truth (spec §7A).
 *
 * The sliding track carries the meaning, which is why the brand red works here
 * as "on" where it would not on a plain pill: position, the ✓/✕ in the thumb,
 * and the label all say the same thing, so nobody has to read red as "good".
 */
export default function AttendanceToggle({
  state,
  memberName,
  disabled = false,
  onChange,
}: Props) {
  const present = state === "Present";

  return (
    <button
      type="button"
      className={`${styles.toggleWrapper} ${present ? styles.present : styles.absent}`}
      onClick={() => onChange(present ? "Absent" : "Present")}
      disabled={disabled}
      aria-pressed={present}
      aria-label={`${memberName}: ${state}. Activate to mark ${present ? "Absent" : "Present"}.`}
    >
      <span className={styles.toggleTrack} aria-hidden="true">
        <span className={styles.toggleThumb}>{present ? "✓" : "✕"}</span>
      </span>
      <span className={styles.toggleLabel}>{state}</span>
    </button>
  );
}
