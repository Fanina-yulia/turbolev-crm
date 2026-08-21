"use client";

import { useState } from "react";
import styles from "./access.module.css";

export function ActivateClientPortal({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function activate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/public/client-portal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareToken: token }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; message?: string; redirectTo?: string } | null;
      if (!response.ok || !body?.ok || !body.redirectTo) {
        throw new Error(body?.message || "Не вдалося активувати кабінет.");
      }
      window.location.assign(body.redirectTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося активувати кабінет.");
      setBusy(false);
    }
  }

  return <div className={styles.actions}>
    <button type="button" onClick={() => void activate()} disabled={busy}>
      {busy ? "Активуємо доступ…" : "Відкрити мій постійний кабінет"}
    </button>
    {error ? <p className={styles.error}>{error}</p> : null}
  </div>;
}
