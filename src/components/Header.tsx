import styles from "./Header.module.css";
import HamburgerMenu from "./HamburgerMenu";
import type { AuthSession } from "@/types";

/**
 * Sticky app bar.
 *
 * Sticky because the attendance list is long — a TE scrolling to the bottom of
 * a fourteen-person roster should not have to scroll back up to reach the menu.
 */
export default function Header({
  session,
  dateStr,
}: {
  session: AuthSession;
  dateStr: string;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.logo}>
          <span className={styles.tedx}>TEDx</span>
          <span className={styles.dypdpu}>DYPDPU</span>
        </div>

        <div className={styles.meta}>
          <span className={styles.date}>{dateStr}</span>
          <span className={styles.domain}>
            {session.role === "Core Member" ? "Core" : session.domain}
          </span>
        </div>

        <HamburgerMenu session={session} />
      </div>
    </header>
  );
}
