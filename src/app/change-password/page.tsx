import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { getTodayDateIST } from "@/lib/google-sheets";
import Header from "@/components/Header";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Change Password" };

export default async function ChangePassword() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="container">
      <Header session={session} dateStr={getTodayDateIST()} />

      <main>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.title}>Change password</h1>
            <p className={styles.subtitle}>{session.username}</p>
          </div>
        </div>

        <ChangePasswordForm />
      </main>
    </div>
  );
}
