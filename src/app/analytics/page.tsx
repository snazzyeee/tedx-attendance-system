import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { canManageAttendance, isPrivileged, resolveDomain } from "@/lib/auth/scope";
import { getSession } from "@/lib/auth/session";
import { getDomainAnalytics, getTodayDateIST } from "@/lib/google-sheets";
import Header from "@/components/Header";
import AnalyticsView from "@/components/AnalyticsView";
import DomainSelector from "@/components/DomainSelector";
import type { DomainAnalytics } from "@/types";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Analytics" };

export default async function Analytics(props: {
  searchParams?: Promise<{ domain?: string }>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : {};
  const session = await getSession();

  if (!session || !canManageAttendance(session)) {
    redirect("/login");
  }

  const activeDomain = resolveDomain(session, searchParams?.domain);
  const dateStr = getTodayDateIST();

  let data: DomainAnalytics | null = null;
  let error = "";

  try {
    // Scoped to one domain — a Curation TE's response can never contain
    // Marketing rows (spec §2).
    data = await getDomainAnalytics(activeDomain, dateStr);
  } catch (err) {
    console.error("[analytics] load failed:", err);
    error =
      "Unable to load analytics from Google Sheets. Reload the page to try again.";
  }

  return (
    <div className="container container-wide">
      <Header session={session} dateStr={dateStr} />

      <main>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.title}>Analytics</h1>
            <p className={styles.subtitle}>
              {activeDomain} ·{" "}
              {isPrivileged(session) ? "all domains available" : "your domain only"}
            </p>
          </div>
          {isPrivileged(session) && <DomainSelector activeDomain={activeDomain} />}
        </div>

        <div className={styles.body}>
          {error || !data ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : (
            <AnalyticsView data={data} />
          )}
        </div>
      </main>
    </div>
  );
}
