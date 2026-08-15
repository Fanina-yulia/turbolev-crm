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

  async function confirmCrmAccess() {
    const meResponse = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    const me = (await meResponse.json().catch(() => null)) as AccessStatus | null;
    if (me?.authenticated && me.provisioningState === "ACTIVE") {
      window.location.assign("/");
      return true;
    }
    if (me?.authenticated && me.provisioningState === "AUTHENTICATED_UNPROVISIONED") {
      setMessage("Обліковий запис підтверджено, але доступ до Turbo LEV CRM ще не призначено адміністратором.");
      return true;
    }
    if (me?.provisioningState === "INACTIVE") {
      setMessage("Доступ цього облікового запису деактивовано.");
      return true;
    }
    return false;
  }

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
      if (!(await confirmCrmAccess())) setMessage("Сесію створено, але CRM не змогла підтвердити ваш профіль доступу.");
    } catch {
      setMessage("Сервіс входу тимчасово недоступний. Спробуйте ще раз.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: `${window.location.origin}/` }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(result?.message || result?.error || "Не вдалося розпочати вхід через Google.");
        return;
      }
      const target = typeof result?.url === "string" ? result.url : typeof result?.redirect === "string" ? result.redirect : null;
      if (target) {
        window.location.assign(target);
        return;
      }
      setMessage("Google не повернув адресу авторизації. Спробуйте ще раз.");
    } catch {
      setMessage("Сервіс Google-входу тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <button type="button" disabled={busy} onClick={signInWithGoogle}>Увійти через Google</button>
      <div className={styles.help}>або робочим email і паролем</div>
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
      <p className={styles.help}>Навіть успішний вхід не відкриває CRM без призначеної ролі Turbo LEV.</p>
    </form>
  );
}
