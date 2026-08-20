"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./customer-cabinet-card.module.css";

type ShareMeta = {
  id: string;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

type CabinetCase = {
  vehicle: { id: string; label: string; plateNumber: string | null };
  diagnosticId: string | null;
  diagnosticStatus: string | null;
  reviewState: string | null;
  shareable: boolean;
  workOrder: { id: string; status: string } | null;
};

type ContextResponse = { ok: boolean; cases?: CabinetCase[]; error?: string };

type ReportResponse = { ok: boolean; share?: ShareMeta | null; path?: string; error?: string; message?: string };

const reviewLabel: Record<string, string> = {
  DRAFT: "Діагностика ще не передана сервіс-менеджеру",
  RETURNED: "Діагностику повернено механіку на уточнення",
  SUBMITTED: "Діагностика передана сервіс-менеджеру",
  CONFIRMED: "Діагностика підтверджена",
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

export function CustomerCabinetCard({ clientId, vehicleId }: { clientId?: string | null; vehicleId?: string | null }) {
  const [cases, setCases] = useState<CabinetCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (clientId) params.set("clientId", clientId);
    if (vehicleId) params.set("vehicleId", vehicleId);
    return params.toString();
  }, [clientId, vehicleId]);

  useEffect(() => {
    if (!query) {
      setCases([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/customer-cabinet/context?${query}`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as ContextResponse | null;
        if (!response.ok || !body?.ok) throw new Error(body?.error || "Не вдалося завантажити кабінет клієнта");
        setCases(body.cases || []);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка кабінету клієнта");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query]);

  return <div className={styles.cabinetCard}>
    <div className={styles.cabinetHeading}>
      <div><span className={styles.cabinetEyebrow}>КАБІНЕТ КЛІЄНТА</span><h3>Посилання для клієнта</h3></div>
      <span className={styles.cabinetIcon}>↗</span>
    </div>
    <p className={styles.cabinetIntro}>Клієнт відкриває статус авто, діагностику, кошторис, погодження та чат без входу в CRM.</p>

    {loading && <div className={styles.cabinetMuted}>Перевіряю доступність кабінету…</div>}
    {error && <div className={styles.cabinetError}>{error}</div>}
    {!loading && !error && !cases.length && <div className={styles.cabinetMuted}>Посилання стане доступним після створення діагностики та передачі її сервіс-менеджеру.</div>}

    {!loading && !error && cases.map((item) => <CabinetCaseRow key={item.vehicle.id} item={item} />)}
  </div>;
}

function CabinetCaseRow({ item }: { item: CabinetCase }) {
  const [share, setShare] = useState<ShareMeta | null>(null);
  const [freshPath, setFreshPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setShare(null);
    setFreshPath(null);
    setMessage("");
    setError("");
    if (!item.shareable || !item.diagnosticId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/diagnostics/${encodeURIComponent(item.diagnosticId!)}/report`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as ReportResponse | null;
        if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося перевірити посилання");
        setShare(body.share || null);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка посилання");
      }
    })();
    return () => controller.abort();
  }, [item.diagnosticId, item.shareable]);

  async function createLink() {
    if (!item.diagnosticId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(item.diagnosticId)}/report`, {
        method: "POST",
        credentials: "include",
      });
      const body = await response.json().catch(() => null) as ReportResponse | null;
      if (!response.ok || !body?.ok || !body.path) throw new Error(body?.message || body?.error || "Не вдалося створити посилання");
      setShare(body.share || null);
      setFreshPath(body.path);
      setMessage("Посилання створено. Тепер його можна скопіювати та надіслати клієнту.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка створення посилання");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!freshPath) return;
    const url = `${window.location.origin}${freshPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Посилання скопійовано.");
    } catch {
      setError("Не вдалося скопіювати автоматично. Виділіть посилання нижче та скопіюйте вручну.");
    }
  }

  async function revokeLink() {
    if (!item.diagnosticId || !share?.active) return;
    if (!window.confirm("Відкликати посилання на кабінет клієнта?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(item.diagnosticId)}/report?shareId=${encodeURIComponent(share.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await response.json().catch(() => null) as ReportResponse | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкликати посилання");
      setShare(body.share || null);
      setFreshPath(null);
      setMessage("Посилання відкликано.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка відкликання посилання");
    } finally {
      setBusy(false);
    }
  }

  const fullUrl = freshPath ? `${typeof window !== "undefined" ? window.location.origin : ""}${freshPath}` : "";
  const stateText = item.reviewState ? (reviewLabel[item.reviewState] || item.reviewState) : "Діагностики ще немає";

  return <div className={styles.cabinetVehicle}>
    <div className={styles.cabinetVehicleTop}>
      <div><strong>{item.vehicle.label}</strong><small>{item.vehicle.plateNumber || "Без держномера"}</small></div>
      <span className={`${styles.cabinetStatus} ${item.shareable ? styles.cabinetReady : ""}`}>{item.shareable ? (share?.active ? "● Доступний" : "Готовий") : "Недоступний"}</span>
    </div>
    <div className={styles.cabinetState}>{stateText}</div>

    {item.shareable ? <>
      <div className={styles.cabinetActions}>
        <button type="button" className={styles.cabinetPrimary} disabled={busy} onClick={() => void createLink()}>{share?.active ? "Створити нове посилання" : "Створити посилання"}</button>
        {freshPath && <button type="button" className={styles.cabinetSecondary} disabled={busy} onClick={() => void copyLink()}>⧉ Копіювати</button>}
        {freshPath && <a className={styles.cabinetSecondary} href={freshPath} target="_blank" rel="noreferrer">Відкрити ↗</a>}
        {share?.active && <button type="button" className={styles.cabinetDanger} disabled={busy} onClick={() => void revokeLink()}>Відкликати</button>}
      </div>
      {freshPath && <input className={styles.cabinetUrl} readOnly value={fullUrl} onFocus={(event) => event.currentTarget.select()} aria-label="Посилання на кабінет клієнта" />}
      {share?.active && !freshPath && <small className={styles.cabinetNote}>Активне посилання вже існує. З міркувань безпеки сам токен не зберігається у CRM, тому для копіювання створіть нове — попереднє автоматично буде відкликано.</small>}
      {share?.expiresAt && <small className={styles.cabinetNote}>Діє до {formatDate(share.expiresAt)}</small>}
    </> : <small className={styles.cabinetNote}>Кнопка «Створити посилання» з’явиться автоматично після передачі діагностики сервіс-менеджеру.</small>}

    {message && <div className={styles.cabinetMessage}>{message}</div>}
    {error && <div className={styles.cabinetError}>{error}</div>}
  </div>;
}
