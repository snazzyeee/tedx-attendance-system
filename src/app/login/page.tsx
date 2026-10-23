"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DOMAINS } from "@/config/domains";
import { MEMBERS } from "@/config/members";
import { WINDOW_LABEL } from "@/lib/time/ist";
import type { Domain } from "@/types";
import styles from "./page.module.css";

type AccountType = "TE" | "Core Member";

export default function Login() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType>("TE");
  const [domain, setDomain] = useState<Domain | "">("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const activeMembers = useMemo(() => {
    if (accountType === "Core Member") {
      return MEMBERS.filter((m) => m.role === "Core Member");
    }
    return domain ? MEMBERS.filter((m) => m.domain === domain && m.role === "TE") : [];
  }, [accountType, domain]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error ?? "Login failed. Please try again.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Unable to reach the server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const submitDisabled =
    loading || (accountType === "TE" && !domain) || !username || !password;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <h1 className={styles.wordmark}>
            <span className={styles.tedx}>TEDx</span>DYPDPU
          </h1>
          <p className={styles.tagline}>Attendance Management System</p>
        </div>

        <form onSubmit={handleLogin} className={styles.form}>
          {error && (
            <div className="error-text" role="alert">
              {error}
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="accountType">
              Account type
            </label>
            <select
              id="accountType"
              className="select-field"
              value={accountType}
              onChange={(e) => {
                setAccountType(e.target.value as AccountType);
                setDomain("");
                setUsername("");
              }}
              required
            >
              <option value="TE">TE</option>
              <option value="Core Member">Core Member</option>
            </select>
          </div>

          {accountType === "TE" && (
            <div className="field">
              <label className="label" htmlFor="domain">
                Domain
              </label>
              <select
                id="domain"
                className="select-field"
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value as Domain);
                  setUsername("");
                }}
                required
              >
                <option value="" disabled>
                  Select domain
                </option>
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="username">
              {accountType === "TE" ? "TE name" : "Core member name"}
            </label>
            <select
              id="username"
              className="select-field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={accountType === "TE" && !domain}
              required
            >
              <option value="" disabled>
                {accountType === "TE" && !domain
                  ? "Select a domain first"
                  : "Select name"}
              </option>
              {activeMembers.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Enter password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={submitDisabled}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className={styles.hint}>
          Attendance can be marked between {WINDOW_LABEL}.
        </p>
      </div>
    </div>
  );
}
