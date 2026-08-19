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
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

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

  async function continueWithGoogle() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: PERSONNEL_RETURN_PATH }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setAuthError(result?.message || result?.error || "Не вдалося розпочати вхід через Google.");
        return;
      }
      const target = typeof result?.url === "string"
        ? result.url
        : typeof result?.redirect === "string"
          ? result.redirect
          : null;
      if (!target) {
        setAuthError("Google не повернув адресу авторизації. Спробуйте ще раз.");
        return;
      }
      window.location.assign(target);
    } catch {
      setAuthError("Сервіс Google-входу тимчасово недоступний. Спробуйте ще раз.");
    } finally {
      setAuthBusy(false);
    }
  }

  const signInWithEmail = () => {
    window.location.assign(`/auth/sign-in?next=${encodeURIComponent(PERSONNEL_RETURN_PATH)}`);
  };

  const title = state.kind === "checking"
    ? "Перевіряю доступ…"
    : state.kind === "unauthenticated"
      ? "Підтвердіть вхід один раз"
      : state.kind === "unprovisioned"
        ? "Доступ ще не призначено"
        : state.kind === "inactive"
          ? "Обліковий запис деактивовано"
          : "Не вдалося перевірити доступ";

  const text = state.kind === "checking"
    ? "Зачекайте кілька секунд."
    : state.kind === "unauthenticated"
      ? "Натисніть «Продовжити через Google». Після підтвердження CRM автоматично поверне Вас сюди і відкриє розділ «Персонал»."
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={() => void continueWithGoogle()}
            disabled={authBusy}
            style={{
              minHeight: 44,
              padding: "0 18px",
              border: "1px solid var(--orange)",
              borderRadius: 10,
              background: "var(--orange)",
              color: "#fff",
              fontWeight: 800,
              cursor: authBusy ? "wait" : "pointer",
              opacity: authBusy ? 0.7 : 1,
            }}
          >
            {authBusy ? "Відкриваю Google…" : "Продовжити через Google"}
          </button>
          <button
            type="button"
            onClick={signInWithEmail}
            disabled={authBusy}
            style={{
              minHeight: 44,
              padding: "0 18px",
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "transparent",
              color: "var(--text)",
              fontWeight: 700,
              cursor: authBusy ? "default" : "pointer",
            }}
          >
            Увійти email і паролем
          </button>
        </div>
      ) : null}

      {authError ? (
        <div style={{ marginTop: 12, color: "#b42318", fontWeight: 700 }}>{authError}</div>
      ) : null}
    </section>
  );
}
