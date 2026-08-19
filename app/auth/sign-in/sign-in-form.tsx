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
  const [showPassword, setShowPassword] = useState(false);
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
      setMessage("Обліковий запис підтверджено, але доступ до CRM ще не призначено керівником.");
      return true;
    }
    if (me?.provisioningState === "INACTIVE") {
      setMessage("Доступ цього працівника до CRM деактивовано.");
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
        setMessage("Вкажіть робочий логін.");
        return;
      }
      if (!password) {
        setMessage("Вкажіть пароль.");
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
          setMessage(result?.message || result?.error || "Невірний логін або пароль.");
          return;
        }
        if (!(await confirmCrmAccess())) {
          setMessage("Вхід виконано, але CRM не змогла підтвердити Ваш профіль доступу.");
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
        setMessage("Невірний логін або пароль.");
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
    const value = identifier.trim();
    if (!value) {
      setMessage("Спочатку введіть свій логін або робочий e-mail.");
      return;
    }
    if (!value.includes("@")) {
      setMessage("Пароль для робочого логіна відновлює керівник у «Налаштування → Персонал».");
      return;
    }

    const normalizedEmail = value.toLowerCase();
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
        setMessage("Не вдалося надіслати лист для відновлення пароля.");
        return;
      }

      setMessage("Лист для відновлення пароля надіслано на робочий e-mail.");
    } catch {
      setMessage("Не вдалося надіслати лист для відновлення пароля. Спробуйте ще раз.");
    } finally {
      setBusy(false);
    }
  }

  async function activateAccount() {
    const normalizedEmail = identifier.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage("Введіть робочий логін або e-mail.");
      return;
    }
    if (!normalizedEmail.includes("@")) {
      setMessage("Для працівника з робочим логіном перший пароль задає керівник у «Налаштування → Персонал». Після цього просто натисніть «Увійти».");
      return;
    }
    if (password.length < 8) {
      setMessage("Для першої e-mail активації введіть пароль щонайменше з 8 символів.");
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
          setMessage("Цей e-mail уже активований. Скористайтеся звичайним входом або відновленням пароля.");
          return;
        }
        setMessage(result?.message || "Не вдалося активувати обліковий запис.");
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

      if (result?.error) setMessage("Не вдалося розпочати вхід через Google.");
    } catch {
      setMessage("Сервіс Google-входу тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span>Логін</span>
        <input
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="Ваш робочий логін"
          required
          autoFocus
        />
      </label>

      <label className={styles.field}>
        <span>Пароль</span>
        <div className={styles.passwordField}>
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Введіть пароль"
            required
          />
          <button
            type="button"
            className={styles.eyeButton}
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Приховати пароль" : "Показати пароль"}
            aria-pressed={showPassword}
          >{showPassword ? "◉" : "◌"}</button>
        </div>
      </label>

      <button type="submit" className={styles.primaryButton} disabled={busy}>
        {busy ? "Входжу…" : "Увійти →"}
      </button>

      <div className={styles.accountLinks}>
        <button type="button" disabled={busy} onClick={requestPasswordSetup}>Забули пароль?</button>
        <span aria-hidden="true">·</span>
        <button type="button" disabled={busy} onClick={activateAccount}>Перший вхід</button>
      </div>

      {message ? <div className={styles.message} role="status">{message}</div> : null}

      <details className={styles.alternative}>
        <summary>Інший спосіб входу</summary>
        <div className={styles.alternativeBody}>
          <button type="button" className={styles.googleButton} disabled={busy} onClick={signInWithGoogle}>Продовжити через Google</button>
          <p>Google-вхід залишено як додатковий спосіб для раніше підключених облікових записів.</p>
        </div>
      </details>
    </form>
  );
}
