"use client";

import { useEffect, useState, type ReactNode } from "react";

type AccessState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "unauthenticated" }
  | { kind: "unprovisioned" }
  | { kind: "inactive" }
  | { kind: "error"; message: string };

type MeResponse = {
  ok?: boolean;
  authenticated?: boolean;
  provisioningState?: string;
};

const PERSONNEL_RETURN_PATH = "/?section=settings&settingsTab=personnel";

export function PersonnelAccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as MeResponse | null;
        if (cancelled) return;

        if (!response.ok || !data?.ok) {
          setState({ kind: "error", message: "Не вдалося перевірити сесію CRM." });
          return;
        }
        if (!data.authenticated) {
          setState({ kind: "unauthenticated" });
          return;
        }
        if (data.provisioningState === "AUTHENTICATED_UNPROVISIONED") {
          setState({ kind: "unprovisioned" });
          return;
        }
        if (data.provisioningState === "INACTIVE") {
          setState({ kind: "inactive" });
          return;
        }
        if (data.provisioningState !== "ACTIVE") {
          setState({ kind: "error", message: "CRM не змогла підтвердити активний профіль доступу." });
          return;
        }
        setState({ kind: "ready" });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Сервіс авторизації тимчасово недоступний." });
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "ready") return <>{children}</>;

  const signIn = () => {
    window.location.assign(`/auth/sign-in?next=${encodeURIComponent(PERSONNEL_RETURN_PATH)}`);
  };

  const title = state.kind === "checking"
    ? "Перевіряю доступ…"
    : state.kind === "unauthenticated"
      ? "Потрібен вхід до CRM"
      : state.kind === "unprovisioned"
        ? "Доступ ще не призначено"
        : state.kind === "inactive"
          ? "Обліковий запис деактивовано"
          : "Не вдалося перевірити доступ";

  const text = state.kind === "checking"
    ? "Зачекайте кілька секунд."
    : state.kind === "unauthenticated"
      ? "Сесія у цьому браузері відсутня або завершилась. Увійдіть, після чого CRM поверне Вас одразу до розділу «Персонал»."
      : state.kind === "unprovisioned"
        ? "Обліковий запис підтверджено, але адміністратор ще не призначив йому роль у Turbo LEV."
        : state.kind === "inactive"
          ? "Цей обліковий запис не може працювати з персоналом, доки його не активує адміністратор."
          : state.kind === "error"
            ? state.message
            : "";

  return (
    <section
      role="status"
      aria-live="polite"
      style={{
        maxWidth: 760,
        margin: "64px auto",
        padding: 28,
        border: "1px solid var(--line)",
        borderRadius: 16,
        background: "var(--panel)",
        color: "var(--text)",
        boxShadow: "0 12px 32px rgba(0,0,0,.08)",
      }}
    >
      <div style={{ color: "var(--orange)", fontSize: 11, fontWeight: 800, letterSpacing: ".1em" }}>
        НАЛАШТУВАННЯ · ПЕРСОНАЛ
      </div>
      <h2 style={{ margin: "8px 0", fontSize: 26 }}>{title}</h2>
      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.55 }}>{text}</p>
      {state.kind === "unauthenticated" ? (
        <button
          type="button"
          onClick={signIn}
          style={{
            marginTop: 18,
            minHeight: 44,
            padding: "0 18px",
            border: "1px solid var(--orange)",
            borderRadius: 10,
            background: "var(--orange)",
            color: "#fff",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Увійти та додати працівника
        </button>
      ) : null}
    </section>
  );
}
