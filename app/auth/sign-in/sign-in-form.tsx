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

type AuthError = { message?: string; code?: string } | null | undefined;

type PasswordResetClient = {
  requestPasswordReset(input: { email: string; redirectTo: string }): Promise<{ error?: AuthError } | undefined>;
};

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function SignInForm() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const [identifier, setIdentifier] = useState(searchParams.get("email") || searchParams.get("login") || "");
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
      const value = identifier.trim();
      if (!value) {
        setMessage("Вкажіть логін або e-mail.");
        return;
      }

      if (!value.includes("@")) {
        const response = await fetch("/api/auth/local/sign-in", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ login: value, password, rememberMe: true }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) {
          setMessage(result?.message || result?.error || "Не вдалося увійти. Перевірте логін і пароль.");
          return;
        }
        if (!(await confirmCrmAccess())) {
          setMessage("Вхід виконано, але CRM не змогла підтвердити профіль доступу.");
        }
        return;
      }

      const result = (await neonAuthClient.signIn.email({
        email: value.toLowerCase(),
        password,
        rememberMe: true,
        callbackURL: nextPath,
      })) as { error?: AuthError } | undefined;

      if (result?.error) {
        setMessage(result.error.message || result.error.code || "Не вдалося увійти. Перевірте e-mail і пароль.");
        return;
      }

      await confirmCrmAccess();
    } catch {
      setMessage("Сервіс входу тимчасово недоступний. Спробуйте ще раз.");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordSetup() {
    const normalizedEmail = identifier.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setMessage("Відновлення через e-mail доступне лише для e-mail входу. Пароль працівника за логіном змінюється в його картці у розділі «Персонал».");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const redirect = new URL("/auth/reset-password", window.location.origin);
      redirect.searchParams.set("email", normalizedEmail);
      redirect.searchParams.set("next", nextPath);

      const client = neonAuthClient as unknown as PasswordResetClient;
      const result = await client.requestPasswordReset({
        email: normalizedEmail,
        redirectTo: redirect.toString(),
      });

      if (result?.error) {
        setMessage(result.error.message || result.error.code || "Не вдалося надіслати лист для встановлення пароля.");
        return;
      }

      setMessage("Лист для встановлення пароля надіслано. Відкрийте його та задайте пароль, після чого CRM увійде під цим e-mail.");
    } catch {
      setMessage("Не вдалося надіслати лист для встановлення пароля. Спробуйте ще раз.");
    } finally {
      setBusy(false);
    }
  }

  async function activateAccount() {
    const normalizedEmail = identifier.trim().toLowerCase();
    if (!normalizedEmail.includes("@") || password.length < 8) {
      setMessage("Для першої e-mail активації введіть робочий e-mail і пароль щонайменше з 8 символів.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (result?.error === "ACCOUNT_ALREADY_LINKED") {
          setMessage("Цей e-mail уже прив'язаний до CRM. Натисніть «Задати / відновити пароль» нижче.");
          return;
        }
        setMessage(result?.message || result?.error || "Не вдалося активувати обліковий запис.");
        return;
      }
      await confirmCrmAccess();
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
      })) as { error?: AuthError } | undefined;

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
      <div className={styles.help}>або логіном / e-mail і паролем</div>
      <label>
        <span>Логін або e-mail</span>
        <input type="text" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
      </label>
      <label>
        <span>Пароль</span>
        <input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Перевіряю…" : "Увійти"}</button>
      <button type="button" disabled={busy} onClick={requestPasswordSetup}>Задати / відновити пароль e-mail акаунта</button>
      <button type="button" disabled={busy} onClick={activateAccount}>Перший e-mail вхід</button>
      {message ? <div className={styles.message} role="status">{message}</div> : null}
      <p className={styles.help}>Для працівників логін і пароль задає керівник у «Налаштування → Персонал». E-mail для такого входу не потрібен.</p>
    </form>
  );
}
