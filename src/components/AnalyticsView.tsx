import type { DomainAnalytics } from "@/types";
import styles from "./AnalyticsView.module.css";

/** Below this, a member's bar turns amber — the row a TE is scanning for. */
const LOW_ATTENDANCE = 50;

/**
 * Domain-scoped attendance analytics (spec §10).
 *
 * Rendered from a `DomainAnalytics` computed on the server for one domain, so
 * another domain's numbers are never in the payload at all.
 *
 * Bars are plain CSS widths rather than a charting library — the spec forbids
 * Tailwind, and an extra dependency buys nothing for two simple series.
 */
export default function AnalyticsView({ data }: { data: DomainAnalytics }) {
  const hasHistory = data.dateStats.length > 0;
  // Newest first: recent days are what a TE actually looks at.
  const recentDates = [...data.dateStats].reverse();

  return (
    <div className={styles.wrapper}>
      <section className={styles.cards} aria-label="Today's summary">
        <Card label="Total Members" value={data.totalMembers} />
        <Card label="Present Today" value={data.presentToday} tone={styles.present} />
        <Card label="Absent Today" value={data.absentToday} tone={styles.absent} />
        <Card
          label="Today"
          value={`${data.todayPercentage}%`}
          tone={styles.accent}
        />
      </section>

      {!data.todayRecorded && (
        <p className={styles.note}>
          No attendance has been recorded for {data.today} yet, so today&apos;s
          figures show everyone as absent.
        </p>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Member-wise attendance</h2>
          <span className={styles.sectionMeta}>
            {hasHistory
              ? `across ${data.dateStats.length} recorded day${data.dateStats.length === 1 ? "" : "s"}`
              : "no recorded days yet"}
          </span>
        </div>

        {hasHistory ? (
          <ul className={styles.memberList}>
            {data.memberStats.map((member) => (
              <li key={member.memberName} className={styles.memberRow}>
                <div className={styles.memberTop}>
                  <span className={styles.memberName}>
                    {member.memberName}
                    <span className={styles.role}>{member.role}</span>
                  </span>
                  <span className={styles.memberValue}>
                    {member.percentage}%
                    <span className={styles.memberCount}>
                      {member.present}/{member.total}
                    </span>
                  </span>
                </div>
                <div
                  className={styles.bar}
                  role="meter"
                  aria-valuenow={member.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${member.memberName} attendance`}
                >
                  <div
                    className={`${styles.barFill} ${
                      member.percentage < LOW_ATTENDANCE ? styles.barLow : ""
                    }`}
                    style={{ width: `${member.percentage}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            Member percentages appear once attendance has been saved for at least
            one day.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Date-wise trend</h2>
          <span className={styles.sectionMeta}>
            overall {data.overallPercentage}%
          </span>
        </div>

        {hasHistory ? (
          <ul className={styles.dateList}>
            {recentDates.map((day) => (
              <li
                key={day.date}
                className={`${styles.dateRow} ${day.date === data.today ? styles.dateToday : ""}`}
              >
                <span className={styles.dateLabel}>{day.date}</span>
                <div className={styles.stackedBar} aria-hidden="true">
                  <div
                    className={styles.stackPresent}
                    style={{ width: `${day.percentage}%` }}
                  />
                  <div
                    className={styles.stackAbsent}
                    style={{ width: `${100 - day.percentage}%` }}
                  />
                </div>
                <span className={styles.dateValue}>
                  {day.present}P / {day.absent}A
                  <span className={styles.datePercent}>{day.percentage}%</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>No dates have been recorded yet.</p>
        )}
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={`${styles.cardValue} ${tone}`}>{value}</span>
    </div>
  );
}
