"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { neonAuthClient } from "@/src/security/neon-auth-client";
import styles from "../sign-in/sign-in.module.css";

type AuthError = { message?: string; code?: string } | null | undefined;

type ResetClient = {
  resetPassword(input: { newPassword: string; token: string }): Promise<{ error?: AuthError } | undefined>;
};

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setMessage("Посилання недійсне або прострочене. Запросіть новий лист для встановлення пароля.");
      return;
    }
    if (password.length < 8) {
      setMessage("Пароль має містити щонайменше 8 символів.");
      return;
    }
    if (password !== confirm) {
      setMessage("Паролі не збігаються.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const client = neonAuthClient as unknown as ResetClient;
      const result = await client.resetPassword({ newPassword: password, token });
      if (result?.error) {
        setMessage(result.error.message || result.error.code || "Не вдалося встановити пароль.");
        return;
      }

      if (email) {
        const signIn = (await neonAuthClient.signIn.email({
          email,
          password,
          rememberMe: true,
          callbackURL: nextPath,
        })) as { error?: AuthError } | undefined;
        if (!signIn?.error) {
          window.location.assign(nextPath);
          return;
        }
      }

      const login = new URL("/auth/sign-in", window.location.origin);
      login.searchParams.set("next", nextPath);
      if (email) login.searchParams.set("email", email);
      window.location.assign(login.toString());
    } catch {
      setMessage("Не вдалося встановити пароль. Спробуйте запросити новий лист.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {email ? <div className={styles.help}>Логін: {email}</div> : null}
      <label>
        <span>Новий пароль</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <label>
        <span>Повторіть пароль</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy || !token}>{busy ? "Зберігаю…" : "Встановити пароль і увійти"}</button>
      {message ? <div className={styles.message} role="status">{message}</div> : null}
    </form>
  );
}
