"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./DomainSelector.module.css";
import { DOMAINS } from "@/config/domains";
import type { Domain } from "@/types";

/**
 * Domain switcher for Core Members.
 *
 * Navigation is a server round-trip, so the selected value is held locally and
 * the control disables itself while the new page loads — otherwise the select
 * snaps back to the old domain for as long as the request takes, which reads as
 * the click having failed.
 */
export default function DomainSelector({ activeDomain }: { activeDomain: Domain }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Domain>(activeDomain);

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor="core-domain-select">
        Viewing
      </label>
      <select
        id="core-domain-select"
        className={`select-field ${styles.select}`}
        value={selected}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value as Domain;
          setSelected(next);
          startTransition(() => {
            router.push(`${pathname}?domain=${encodeURIComponent(next)}`);
          });
        }}
      >
        {DOMAINS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </div>
  );
}
