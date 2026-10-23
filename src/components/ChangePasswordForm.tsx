"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./ChangePasswordForm.module.css";

const MIN_LENGTH = 8;
/** bcrypt silently truncates past 72 bytes, so the route rejects longer. */
const MAX_LENGTH = 72;

export default function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Client-side checks are a courtesy; the route validates independently.
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from the current password.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error ?? "Unable to change your password. Please try again.");
        return;
      }

      setSuccess("Password changed. Taking you back to sign in…");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      // The route already cleared the session server-side; this just moves the
      // browser somewhere it can actually use.
      setTimeout(() => {
        router.push("/login");
        router.refresh();
      }, 1800);
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {error && (
        <div className={`error-text ${styles.banner}`} role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className={`success-text ${styles.banner}`} role="status">
          {success}
        </div>
      )}

      <PasswordField
        id="currentPassword"
        label="Current password"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
        show={showPasswords}
        onToggleShow={() => setShowPasswords((v) => !v)}
      />

      <PasswordField
        id="newPassword"
        label="New password"
        value={newPassword}
        onChange={setNewPassword}
        autoComplete="new-password"
        show={showPasswords}
        onToggleShow={() => setShowPasswords((v) => !v)}
        minLength={MIN_LENGTH}
        maxLength={MAX_LENGTH}
        describedBy="newPasswordHint"
        hint={`Between ${MIN_LENGTH} and ${MAX_LENGTH} characters.`}
      />

      <PasswordField
        id="confirmPassword"
        label="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
        show={showPasswords}
        onToggleShow={() => setShowPasswords((v) => !v)}
        invalid={mismatch}
        describedBy={mismatch ? "confirmHint" : undefined}
        hint={mismatch ? "Passwords do not match." : undefined}
        hintTone={mismatch ? styles.hintError : undefined}
      />

      <button
        type="submit"
        className="btn-primary"
        disabled={loading || !!success || mismatch}
      >
        {loading ? "Changing…" : "Change password"}
      </button>

      <p className={styles.footnote}>
        You will be signed out and asked to sign in with the new password.
      </p>
    </form>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  show,
  onToggleShow,
  minLength,
  maxLength,
  describedBy,
  hint,
  hintTone,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  show: boolean;
  onToggleShow: () => void;
  minLength?: number;
  maxLength?: number;
  describedBy?: string;
  hint?: string;
  hintTone?: string;
  invalid?: boolean;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="password-wrapper">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          className="input-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          minLength={minLength}
          maxLength={maxLength}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required
        />
        <button
          type="button"
          className="password-toggle"
          onClick={onToggleShow}
          aria-label={show ? "Hide passwords" : "Show passwords"}
          tabIndex={-1}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={describedBy} className={`${styles.hint} ${hintTone ?? ""}`}>
          {hint}
        </p>
      )}
    </div>
  );
}
