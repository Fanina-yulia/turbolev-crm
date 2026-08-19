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
  const [email, setEmail] = useState(searchParams.get("email") || "");
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
      const result = (await neonAuthClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
        rememberMe: true,
        callbackURL: nextPath,
      })) as { error?: AuthError } | undefined;

      if (result?.error) {
        setMessage(result.error.message || result.error.code || "Не вдалося увійти. Перевірте email і пароль.");
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
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setMessage("Спочатку введіть email, для якого потрібно встановити або відновити пароль.");
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

      setMessage("Лист для встановлення пароля надіслано. Відкрийте його та задайте пароль, після чого CRM увійде під цим email.");
    } catch {
      setMessage("Не вдалося надіслати лист для встановлення пароля. Спробуйте ще раз.");
    } finally {
      setBusy(false);
    }
  }

  async function activateAccount() {
    if (!email.trim() || password.length < 8) {
      setMessage("Для першої активації введіть робочий email і пароль щонайменше з 8 символів.");
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
        if (result?.error === "ACCOUNT_ALREADY_LINKED") {
          setMessage("Цей email уже прив'язаний до CRM. Натисніть «Задати / відновити пароль» нижче.");
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
      <button type="button" disabled={busy} onClick={requestPasswordSetup}>Задати / відновити пароль</button>
      <button type="button" disabled={busy} onClick={activateAccount}>Перший вхід нового працівника</button>
      {message ? <div className={styles.message} role="status">{message}</div> : null}
      <p className={styles.help}>Для вже існуючого Google-акаунта використовуйте «Задати / відновити пароль»: доступ і роль у CRM збережуться.</p>
    </form>
  );
}
