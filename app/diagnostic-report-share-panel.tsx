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
type Handoff = {
  workOrder: { id: string; status: string };
  counts: { total: number; imported: number; pending: number; labor: number; parts: number };
  createdCount?: number;
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Kyiv" }).format(new Date(value));
}

export function DiagnosticReportSharePanel({ diagnosticId, reviewState, workOrder }: { diagnosticId: string; reviewState: string; workOrder: { id: string; status: string } | null }) {
  const [share, setShare] = useState<ShareMeta | null>(null);
  const [freshPath, setFreshPath] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/report`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити кабінет клієнта");
      setShare(body.share || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка кабінету клієнта");
    }
  }, [diagnosticId]);

  const loadHandoff = useCallback(async () => {
    if (!workOrder) { setHandoff(null); return; }
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/commercial-handoff`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok) setHandoff(body as Handoff & { ok: true });
    } catch {}
  }, [diagnosticId, workOrder]);

  useEffect(() => { setFreshPath(null); void load(); void loadHandoff(); }, [load, loadHandoff]);

  async function createLink() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/report`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body?.path) throw new Error(body?.message || body?.error || "Не вдалося створити посилання");
      setShare(body.share as ShareMeta);
      setFreshPath(String(body.path));
      setMessage("Нове посилання на особистий кабінет створено. Попереднє посилання відкликано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка створення посилання"); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    if (!freshPath) return;
    const url = `${window.location.origin}${freshPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Посилання скопійовано. Його можна надіслати клієнту у Viber, Telegram або SMS.");
    } catch {
      setError("Браузер не дозволив автоматичне копіювання. Створіть посилання ще раз і скопіюйте його з адресного рядка.");
    }
  }

  async function revoke() {
    if (!share?.active || !confirm("Відкликати посилання на особистий кабінет? Після цього клієнт більше не відкриє цей кабінет.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/report?shareId=${encodeURIComponent(share.id)}`, { method: "DELETE", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкликати посилання");
      setShare(body.share as ShareMeta); setFreshPath(null); setMessage("Посилання на особистий кабінет відкликано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка відкликання"); }
    finally { setBusy(false); }
  }

  async function importRecommendations() {
    if (!workOrder) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/commercial-handoff`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося додати рекомендації у кошторис");
      setHandoff(body as Handoff & { ok: true });
      const created = Number(body.createdCount || 0);
      setMessage(created ? `У кошторис додано ${created} нових чернеткових позицій. Вкажіть ціни перед відправкою клієнту.` : "Усі рекомендації вже були перенесені — дублі не створені.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка кошторису"); }
    finally { setBusy(false); }
  }

  if (!["SUBMITTED", "CONFIRMED"].includes(reviewState) && !workOrder) return null;

  return <section className={styles.panel}>
    <div className={styles.head}>
      <div><span>КАБІНЕТ КЛІЄНТА</span><h4>Особистий кабінет власника авто</h4><p>Одне захищене посилання: статус ремонту, діагностика, кошторис, погодження та чат із сервіс-менеджером.</p></div>
      <div className={`${styles.status} ${share?.active ? styles.active : ""}`}>{share?.active ? "● Кабінет доступний" : "Посилання неактивне"}</div>
    </div>

    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.message}>{message}</div>}
    {share?.requestedPricingAt && <div className={styles.pricingAlert}><span>₴</span><div><strong>Клієнт попросив кошторис</strong><small>{dateTime(share.requestedPricingAt)} · запит отримано через особистий кабінет</small></div></div>}

    <div className={styles.grid}>
      <div className={styles.shareBox}>
        <div className={styles.shareMeta}><span>Особистий кабінет</span>{share ? <><strong>{share.active ? "Доступний клієнту" : share.revokedAt ? "Відкликаний" : "Потрібно оновити"}</strong><small>Створено: {dateTime(share.createdAt)}{share.expiresAt ? ` · до ${dateTime(share.expiresAt)}` : ""}</small></> : <><strong>Ще не створений</strong><small>Створити можна після передачі діагностики менеджеру.</small></>}</div>
        <div className={styles.actions}>
          <button className={styles.primary} type="button" disabled={busy} onClick={() => void createLink()}>{freshPath ? "Створити нове посилання" : "Створити посилання"}</button>
          {freshPath && <button className={styles.copy} type="button" disabled={busy} onClick={() => void copyLink()}>⧉ Копіювати</button>}
          {share?.active && <button className={styles.danger} type="button" disabled={busy} onClick={() => void revoke()}>Відкликати</button>}
        </div>
        {share?.active && !freshPath && <small className={styles.tokenNote}>З міркувань безпеки CRM не зберігає сам URL. Щоб скопіювати його після перезавантаження сторінки, створіть нове посилання — старе автоматично відкличеться.</small>}
      </div>

      {workOrder && <div className={styles.handoffBox}>
        <div><span>КОШТОРИС · WORKORDER</span><strong>{handoff ? `${handoff.counts.imported}/${handoff.counts.total} рекомендацій перенесено` : "Рекомендації діагностики"}</strong><small>{handoff?.counts.total ? `${handoff.counts.labor} робіт · ${handoff.counts.parts} деталей` : "Проблемні пункти з налаштованими рекомендаціями можна перенести як чернетки."}</small></div>
        <button type="button" disabled={busy || handoff?.counts.total === 0 || handoff?.counts.pending === 0} onClick={() => void importRecommendations()}>{handoff?.counts.pending === 0 && handoff?.counts.total ? "✓ Уже в кошторисі" : "Додати рекомендації у кошторис"}</button>
        <small>Ці позиції не вважаються погодженими клієнтом і не запускають закупівлю. Спочатку сервіс-менеджер задає ціну та формує фінальний кошторис.</small>
      </div>}
    </div>
  </section>;
}
