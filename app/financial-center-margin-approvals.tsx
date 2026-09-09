"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./financial-center-v2.module.css";

type MarginRequest = {
  workOrderId: string;
  currency: string;
  locationId: string | null;
  revenue: number;
  plannedCost: number;
  grossMarginAmount: number;
  grossMarginPercent: number;
  warningMarginPercent: number;
  requestedAt: string;
  requestedByName: string | null;
};

function money(value: number, currency = "UAH") {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося виконати погодження маржі.");
  return payload;
}

export function FinancialCenterMarginApprovals({ locationId, onChanged }: { locationId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<MarginRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
      const payload = await apiJson(`/api/finance/margin-approvals${query}`);
      setRows(Array.isArray(payload.pending) ? payload.pending : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити низькомаржинальні КП.");
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("turbolev:data-changed", refresh);
    return () => window.removeEventListener("turbolev:data-changed", refresh);
  }, [load]);

  async function approve(row: MarginRequest) {
    const note = window.prompt("Коментар до фінансового погодження (необов'язково):", "") ?? "";
    setBusyId(row.workOrderId);
    setError("");
    setMessage("");
    try {
      await apiJson("/api/finance/margin-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId: row.workOrderId, note }),
      });
      setMessage(`Маржу КП по ЗН ${row.workOrderId} погоджено. Тепер КП можна відправити клієнту.`);
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося погодити маржу.");
    } finally {
      setBusyId("");
    }
  }

  return <section className={styles.panel} style={{ marginTop: 16 }}>
    <div className={styles.panelHeader}>
      <div>
        <span className={styles.eyebrow}>MARGIN GATE</span>
        <h2>КП нижче мінімальної маржі</h2>
        <p>КП з маржею нижче контрольного порогу не відправляється клієнту, доки фінансовий користувач не погодить саме поточну ревізію цін і складу.</p>
      </div>
      <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
    </div>
    {error && <div className={styles.errorBox}>{error}</div>}
    {message && <div className={styles.success}>{message}</div>}
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Замовлення</th><th>Запит</th><th className={styles.numberCell}>Продаж</th><th className={styles.numberCell}>Собівартість</th><th className={styles.numberCell}>Маржа</th><th>Поріг</th><th>Дія</th></tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.workOrderId}>
            <td><strong>ЗН {row.workOrderId}</strong><small>{row.locationId || "Вся мережа"}</small></td>
            <td>{dateTime(row.requestedAt)}<small>{row.requestedByName || "Сервіс-менеджер"}</small></td>
            <td className={styles.numberCell}>{money(row.revenue, row.currency)}</td>
            <td className={styles.numberCell}>{money(row.plannedCost, row.currency)}</td>
            <td className={styles.numberCell}><strong>{row.grossMarginPercent.toFixed(1)}%</strong><small>{money(row.grossMarginAmount, row.currency)}</small></td>
            <td>{row.warningMarginPercent.toFixed(1)}%</td>
            <td><button type="button" className={styles.primaryButton} disabled={busyId === row.workOrderId} onClick={() => void approve(row)}>{busyId === row.workOrderId ? "Погоджую…" : "Погодити маржу"}</button></td>
          </tr>)}
          {!rows.length && !loading && <tr><td colSpan={7}>Немає КП, які очікують фінансового погодження маржі.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
