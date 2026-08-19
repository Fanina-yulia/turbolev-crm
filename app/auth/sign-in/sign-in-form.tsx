"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { neonAuthClient } from "@/src/security/neon-auth-client";
import styles from "./sign-in.module.css";

type AccessStatus = {
  authenticated?: boolean;
  provisioningState?: string;
  user?: { name?: string | null } | null;
};

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function SignInForm() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function confirmCrmAccess() {
    const meResponse = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    const me = (await meResponse.json().catch(() => null)) as AccessStatus | null;
    if (me?.authenticated && me.provisioningState === "ACTIVE") {
      window.location.assign(nextPath);
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

  async function activateAccount() {
    if (!email.trim() || password.length < 8) {
      setMessage("Для активації введіть робочий email і пароль щонайменше з 8 символів.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(result?.message || result?.error || "Не вдалося активувати обліковий запис.");
        return;
      }
      if (!(await confirmCrmAccess())) {
        setMessage("Акаунт створено. Тепер натисніть «Увійти» з цим email і паролем.");
      }
    } catch {
      setMessage("Сервіс активації тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    setMessage("");
    try {
      const result = (await neonAuthClient.signIn.social({
        provider: "google",
        callbackURL: nextPath,
      })) as { error?: { message?: string; code?: string } | null } | undefined;

      if (result?.error) {
        setMessage(result.error.message || result.error.code || "Не вдалося розпочати вхід через Google.");
      }
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
      <button type="button" disabled={busy} onClick={activateAccount}>Перший вхід · активувати email і пароль</button>
      {message ? <div className={styles.message} role="status">{message}</div> : null}
      <p className={styles.help}>Активація працює тільки для email, який адміністратор уже додав у Turbo LEV CRM і якому призначено роль.</p>
    </form>
  );
}
