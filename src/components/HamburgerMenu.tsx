"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "./HamburgerMenu.module.css";
import type { AuthSession } from "@/types";

const LINKS = [
  { href: "/", label: "Attendance" },
  { href: "/analytics", label: "Analytics" },
  { href: "/change-password", label: "Change Password" },
] as const;

export default function HamburgerMenu({ session }: { session: AuthSession }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Close on Escape or on a click outside.
   *
   * Without this the panel could only be dismissed by hitting the button again
   * — on a phone, tapping anywhere else left it hanging over the roster.
   */
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // The cookie may still be live, but the destination is a login page that
      // works either way — better than stranding the user on a dead menu.
    }
    router.push("/login");
    router.refresh();
  };

  return (
    <div className={styles.menuContainer} ref={containerRef}>
      <button
        type="button"
        className={styles.hamburgerBtn}
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={isOpen ? "Close menu" : "Open menu"}
      >
        <span className={`${styles.bar} ${isOpen ? styles.open1 : ""}`} />
        <span className={`${styles.bar} ${isOpen ? styles.open2 : ""}`} />
        <span className={`${styles.bar} ${isOpen ? styles.open3 : ""}`} />
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="menu">
          <div className={styles.userInfo}>
            <div className={styles.userName}>{session.username}</div>
            <div className={styles.userMeta}>
              <span className={styles.pill}>{session.role}</span>
              <span className={styles.userDetail}>{session.domain}</span>
            </div>
          </div>

          <nav className={styles.navLinks}>
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                className={pathname === link.href ? styles.active : ""}
                aria-current={pathname === link.href ? "page" : undefined}
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            role="menuitem"
            className={styles.logoutBtn}
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}
