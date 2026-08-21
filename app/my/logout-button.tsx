"use client";

import { useState } from "react";
import styles from "./client-garage.module.css";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/public/diagnostic-report/client-session", { method: "DELETE" });
    } finally {
      window.location.assign("/my");
    }
  }

  return <button type="button" className={styles.logout} onClick={() => void logout()} disabled={busy}>
    {busy ? "Вихід…" : "Вийти"}
  </button>;
}
