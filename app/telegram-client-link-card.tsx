"use client";

import { useEffect, useState } from "react";
import styles from "./customer-cabinet-card.module.css";

type TelegramState = {
  ok?: boolean;
  configured?: boolean;
  linked?: boolean;
  contact?: {
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    linkedAt?: string | null;
    lastInboundAt?: string | null;
    lastOutboundAt?: string | null;
    linkExpiresAt?: string | null;
  } | null;
  error?: string;
};

type LinkResponse = {
  ok?: boolean;
  link?: { url: string; expiresAt: string; botUsername: string };
  error?: string;
};

function humanDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" });
}

export function TelegramClientLinkCard({ clientId }: { clientId: string }) {
  const [state, setState] = useState<TelegramState | null>(null);
  const [freshUrl, setFreshUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/telegram`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null) as TelegramState | null;
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не вдалося перевірити Telegram");
      setState(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка Telegram");
    }
  }

  useEffect(() => { void load(); }, [clientId]);

  async function createLink() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/telegram`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null) as LinkResponse | null;
      if (!response.ok || !body?.ok || !body.link?.url) throw new Error(body?.error || "Не вдалося створити Telegram-посилання");
      setFreshUrl(body.link.url);
      setMessage("Персональне Telegram-посилання створено. Клієнту потрібно відкрити його та натиснути Start.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка створення посилання");
    } finally { setBusy(false); }
  }

  async function copyLink() {
    if (!freshUrl) return;
    try {
      await navigator.clipboard.writeText(freshUrl);
      setMessage("Telegram-посилання скопійовано.");
    } catch {
      setError("Не вдалося скопіювати автоматично. Скопіюйте адресу з поля нижче.");
    }
  }

  async function disconnect() {
    if (!window.confirm("Відключити Telegram від цього клієнта?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/telegram`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Не вдалося відключити Telegram");
      setFreshUrl("");
      setMessage("Telegram відключено від клієнта.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка відключення");
    } finally { setBusy(false); }
  }

  const contactName = [state?.contact?.firstName, state?.contact?.lastName].filter(Boolean).join(" ");

  return <div className={styles.cabinetCard}>
    <div className={styles.cabinetHeading}>
      <div><span className={styles.cabinetEyebrow}>TELEGRAM</span><h3>Чат із клієнтом</h3></div>
      <span className={styles.cabinetIcon}>✈</span>
    </div>
    <p className={styles.cabinetIntro}>Клієнт пише в Telegram, менеджер відповідає з CRM. Прив’язка виконується персональним одноразовим посиланням.</p>

    {state && !state.configured && <div className={styles.cabinetMuted}>Спочатку підключіть Telegram Bot у «Налаштування → Інтеграції».</div>}
    {state?.linked ? <div className={styles.cabinetVehicle}>
      <div className={styles.cabinetVehicleTop}>
        <div><strong>{contactName || state.contact?.username || "Telegram підключено"}</strong><small>{state.contact?.username ? `@${state.contact.username}` : "Клієнт прив’язаний"}</small></div>
        <span className={`${styles.cabinetStatus} ${styles.cabinetReady}`}>● Підключено</span>
      </div>
      <small className={styles.cabinetNote}>Підключено: {humanDate(state.contact?.linkedAt)} · останнє повідомлення: {humanDate(state.contact?.lastInboundAt)}</small>
    </div> : null}

    {state?.configured ? <div className={styles.cabinetActions}>
      <button type="button" className={styles.cabinetPrimary} disabled={busy} onClick={() => void createLink()}>{state.linked ? "Створити нове посилання" : "Підключити Telegram"}</button>
      {freshUrl && <button type="button" className={styles.cabinetSecondary} disabled={busy} onClick={() => void copyLink()}>⧉ Копіювати</button>}
      {freshUrl && <a className={styles.cabinetSecondary} href={freshUrl} target="_blank" rel="noreferrer">Відкрити ↗</a>}
      {state.linked && <button type="button" className={styles.cabinetDanger} disabled={busy} onClick={() => void disconnect()}>Відключити</button>}
    </div> : null}

    {freshUrl && <input className={styles.cabinetUrl} readOnly value={freshUrl} onFocus={(event) => event.currentTarget.select()} aria-label="Telegram-посилання клієнта" />}
    {message && <div className={styles.cabinetMessage}>{message}</div>}
    {error && <div className={styles.cabinetError}>{error}</div>}
  </div>;
}
