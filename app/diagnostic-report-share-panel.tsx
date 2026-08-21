"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./diagnostic-report-share-panel.module.css";

type ShareMeta = {
  id: string;
  diagnosticRequestId: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  requestedPricingAt: string | null;
  active: boolean;
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Kyiv" }).format(new Date(value));
}

export function DiagnosticReportSharePanel({ diagnosticId, reviewState }: { diagnosticId: string; reviewState: string; workOrder?: { id: string; status: string } | null }) {
  const [share, setShare] = useState<ShareMeta | null>(null);
  const [freshPath, setFreshPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (reviewState !== "CONFIRMED") { setShare(null); return; }
    setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/report`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити стан Діагностичної карти");
      setShare(body.share || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка Діагностичної карти");
    }
  }, [diagnosticId, reviewState]);

  useEffect(() => { setFreshPath(null); void load(); }, [load]);

  async function createLink() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/report`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body?.path) throw new Error(body?.message || body?.error || "Не вдалося створити посилання");
      setShare(body.share as ShareMeta);
      setFreshPath(String(body.path));
      setMessage("Посилання на підтверджену Діагностичну карту створено. Попереднє посилання відкликано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка створення посилання"); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    if (!freshPath) return;
    const url = `${window.location.origin}${freshPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Посилання скопійовано. Його можна надіслати клієнту через Комунікації, Viber, Telegram або SMS.");
    } catch {
      setError("Браузер не дозволив автоматичне копіювання. Створіть посилання ще раз і скопіюйте його з адресного рядка.");
    }
  }

  async function revoke() {
    if (!share?.active || !confirm("Відкликати посилання на Діагностичну карту?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/report?shareId=${encodeURIComponent(share.id)}`, { method: "DELETE", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкликати посилання");
      setShare(body.share as ShareMeta); setFreshPath(null); setMessage("Посилання на Діагностичну карту відкликано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка відкликання"); }
    finally { setBusy(false); }
  }

  if (reviewState !== "CONFIRMED") return null;

  return <section className={styles.panel}>
    <div className={styles.head}>
      <div><span>ДІАГНОСТИЧНА КАРТА · КЛІЄНТУ</span><h4>Надсилання готової ДК</h4><p>Підтверджена Діагностична карта є окремим технічним документом. Посилання лише надає клієнту доступ до її фінальної версії.</p></div>
      <div className={`${styles.status} ${share?.active ? styles.active : ""}`}>{share?.active ? "● Посилання активне" : "Не надсилалась"}</div>
    </div>

    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.message}>{message}</div>}
    {share?.requestedPricingAt && <div className={styles.pricingAlert}><span>₴</span><div><strong>Клієнт попросив розрахунок</strong><small>{dateTime(share.requestedPricingAt)} · це запит на окрему Комерційну пропозицію</small></div></div>}

    <div className={styles.grid}>
      <div className={styles.shareBox}>
        <div className={styles.shareMeta}><span>Доступ клієнта до ДК</span>{share ? <><strong>{share.active ? "Діагностична карта доступна" : share.revokedAt ? "Посилання відкликане" : "Потрібно оновити"}</strong><small>Створено: {dateTime(share.createdAt)}{share.expiresAt ? ` · до ${dateTime(share.expiresAt)}` : ""}</small></> : <><strong>Ще не надсилалась</strong><small>Створення посилання не змінює статус ДК і не створює Комерційну пропозицію.</small></>}</div>
        <div className={styles.actions}>
          <button className={styles.primary} type="button" disabled={busy} onClick={() => void createLink()}>{freshPath ? "Створити нове посилання" : "Створити посилання"}</button>
          {freshPath && <button className={styles.copy} type="button" disabled={busy} onClick={() => void copyLink()}>⧉ Копіювати</button>}
          {share?.active && <button className={styles.danger} type="button" disabled={busy} onClick={() => void revoke()}>Відкликати</button>}
        </div>
        {share?.active && !freshPath && <small className={styles.tokenNote}>CRM не зберігає сам URL. Щоб отримати нове посилання після перезавантаження сторінки, створіть його повторно — попереднє буде відкликане.</small>}
      </div>
    </div>
  </section>;
}
