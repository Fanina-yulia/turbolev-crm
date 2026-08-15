"use client";

import { FormEvent, useState } from "react";
import styles from "./sign-in.module.css";

type AccessStatus = {
  authenticated?: boolean;
  provisioningState?: string;
  user?: { name?: string | null } | null;
};

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, rememberMe: true }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(result?.message || result?.error || "Не вдалося увійти. Перевірте email і пароль.");
        return;
      }

      const meResponse = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
      const me = (await meResponse.json().catch(() => null)) as AccessStatus | null;
      if (me?.authenticated && me.provisioningState === "ACTIVE") {
        window.location.assign("/");
        return;
      }
      if (me?.authenticated && me.provisioningState === "AUTHENTICATED_UNPROVISIONED") {
        setMessage("Обліковий запис підтверджено, але доступ до Turbo LEV CRM ще не призначено адміністратором.");
        return;
      }
      if (me?.provisioningState === "INACTIVE") {
        setMessage("Доступ цього облікового запису деактивовано.");
        return;
      }
      setMessage("Сесію створено, але CRM не змогла підтвердити ваш профіль доступу.");
    } catch {
      setMessage("Сервіс входу тимчасово недоступний. Спробуйте ще раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>Email</span>
        <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label>
        <span>Пароль</span>
        <input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Перевіряю…" : "Увійти"}</button>
      {message ? <div className={styles.message} role="status">{message}</div> : null}
      <p className={styles.help}>Самостійна реєстрація не відкриває доступ до CRM. Права призначаються всередині Turbo LEV.</p>
    </form>
  );
}
