import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { canManageAttendance, isPrivileged, resolveDomain } from "@/lib/auth/scope";
import { getSession } from "@/lib/auth/session";
import { getTodayDateIST } from "@/lib/google-sheets";
import Header from "@/components/Header";
import AttendanceList from "@/components/AttendanceList";
import DomainSelector from "@/components/DomainSelector";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Attendance" };

export default async function Dashboard(props: {
  searchParams?: Promise<{ domain?: string }>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : {};
  const session = await getSession();

  if (!session || !canManageAttendance(session)) {
    redirect("/login");
  }

  const activeDomain = resolveDomain(session, searchParams?.domain);
  const dateStr = getTodayDateIST();

  return (
    <div className="container">
      <Header session={session} dateStr={dateStr} />

      <main>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.title}>{activeDomain}</h1>
            <p className={styles.subtitle}>{dateStr}</p>
          </div>
          {isPrivileged(session) && <DomainSelector activeDomain={activeDomain} />}
        </div>

        {/*
          The clock is no longer passed down from here. It used to be
          `Date.now()` read during render — which React flags as impure, and
          which drifts by however long the page took to reach the browser. The
          list now takes the server's clock from the API response it was already
          making.
        */}
        {/*
          Keyed by domain so a Core Member switching domains gets a clean
          component — fresh loading state, no marks queued against the old
          roster — instead of an effect trying to reset state it already holds.
        */}
        <AttendanceList
          key={activeDomain}
          domain={activeDomain}
          role={session.role}
        />
      </main>
    </div>
  );
}
