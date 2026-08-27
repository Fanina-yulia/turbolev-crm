"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./vehicle-diagnostics-tab.module.css";

type WorkflowState = "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "RETURNED" | "CONFIRMED" | "CANCELLED";
type Row = {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "CONFIRMED" | "CANCELLED";
  workflowState?: Exclude<WorkflowState, "RETURNED">;
  reviewState?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  vehicle: { id: string; plateNumber: string | null; vin: string | null };
  assignedMechanic?: { id: string; name: string | null } | null;
  diagnosticCard?: { number: string; finalizedAt: string | null } | null;
  structured?: { inspections: number; checked: number; defects: number; attention: number };
  commercialProposal?: { workOrderId: string; stage: string } | null;
};

type Props = {
  vehicleId: string;
  plateNumber?: string | null;
  vin?: string | null;
};

const labels: Record<WorkflowState, string> = {
  PENDING: "Очікує",
  IN_PROGRESS: "В роботі",
  SUBMITTED: "На перевірці",
  RETURNED: "В роботі",
  CONFIRMED: "Підтверджена",
  CANCELLED: "Скасована",
};
const commercialLabels: Record<string, string> = {
  PARTS_SELECTION: "Підбір запчастин",
  DRAFT: "КП · Чернетка",
  SENT: "КП · Відправлена",
  APPROVED: "КП · Погоджена",
  REJECTED: "КП · Відхилена",
  SUPERSEDED: "КП · Нова ревізія",
};

function stateOf(row: Row): WorkflowState {
  if (row.reviewState === "RETURNED") return "RETURNED";
  return row.workflowState || row.status;
}
function stateClass(state: WorkflowState) {
  if (state === "PENDING") return styles.waiting;
  if (state === "IN_PROGRESS" || state === "RETURNED") return styles.working;
  if (state === "SUBMITTED") return styles.review;
  if (state === "CONFIRMED") return styles.confirmed;
  return styles.cancelled;
}
function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function VehicleDiagnosticsTab({ vehicleId, plateNumber, vin }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshTick((current) => current + 1);
    window.addEventListener("turbolev:data-changed", refresh);
    return () => window.removeEventListener("turbolev:data-changed", refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/diagnostics?vehicleId=${encodeURIComponent(vehicleId)}&limit=100`, { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { ok?: boolean; diagnostics?: Row[]; error?: string } | null;
        if (!response.ok || !body?.ok || !Array.isArray(body.diagnostics)) throw new Error(body?.error || "Не вдалося завантажити діагностики автомобіля");
        if (!controller.signal.aborted) setRows(body.diagnostics);
      })
      .catch((cause) => {
        if (!controller.signal.aborted && cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [vehicleId, refreshTick]);

  const summary = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => ["PENDING", "IN_PROGRESS", "SUBMITTED", "RETURNED"].includes(stateOf(row))).length,
    confirmed: rows.filter((row) => stateOf(row) === "CONFIRMED").length,
    defects: rows.reduce((sum, row) => sum + (row.structured?.defects || 0), 0),
  }), [rows]);

  function bookDiagnostic() {
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", { detail: { source: "VEHICLE", plate: plateNumber || "", vin: vin || "" } }));
  }

  async function createCommercialProposal(row: Row) {
    setBusyId(row.id);
    setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(row.id)}/commercial-proposal`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null) as { ok?: boolean; workOrder?: { id?: string }; error?: string; message?: string } | null;
      if (!response.ok || !body?.ok || !body.workOrder?.id) throw new Error(body?.message || body?.error || "Не вдалося створити Комерційну пропозицію");
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      navigateCrm("Комерційна пропозиція", { workOrderId: body.workOrder.id, workOrderTab: "estimate" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося створити Комерційну пропозицію");
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <div className={styles.loading}>Завантажую історію діагностик…</div>;
  if (error && !rows.length) return <div className={styles.error}>{error}</div>;
  if (!rows.length) return <div className={styles.empty}>Для цього автомобіля діагностики ще не проводились.<div className={styles.actions}><button type="button" className={styles.primary} onClick={bookDiagnostic}>+ Записати на діагностику</button></div></div>;

  return <div className={styles.wrap}>
    <div className={styles.summary}>
      <div><span>Усього діагностик</span><strong>{summary.total}</strong></div>
      <div><span>Активні</span><strong>{summary.active}</strong></div>
      <div><span>Підтверджені ДК</span><strong>{summary.confirmed}</strong></div>
      <div><span>Виявлено дефектів</span><strong>{summary.defects}</strong></div>
    </div>
    {error ? <div className={styles.error}>{error}</div> : null}
    <div className={styles.list}>{rows.map((row) => {
      const state = stateOf(row);
      const title = row.diagnosticCard?.number || (state === "CONFIRMED" ? "Історична діагностика" : "Діагностика в процесі");
      return <article className={styles.card} key={row.id}>
        <div className={styles.top}><span className={`${styles.status} ${stateClass(state)}`}>{labels[state]}</span><time>{dateText(row.confirmedAt || row.updatedAt || row.createdAt)}</time></div>
        <h4>{title}</h4>
        <p>{row.assignedMechanic?.name ? `Механік: ${row.assignedMechanic.name}` : "Механік не вказаний"}</p>
        <div className={styles.meta}>
          {row.structured?.inspections ? <span>{row.structured.checked} перевірено</span> : null}
          {row.structured?.defects ? <span>{row.structured.defects} деф.</span> : null}
          {row.structured?.attention ? <span>{row.structured.attention} увага</span> : null}
          {row.commercialProposal ? <span className={styles.commercial}>{commercialLabels[row.commercialProposal.stage] || "Комерційна пропозиція"}</span> : state === "CONFIRMED" ? <span>КП не створена</span> : null}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => navigateCrm("Діагностика", { diagnosticId: row.id })}>Відкрити ДК</button>
          {state === "CONFIRMED" && <button type="button" onClick={() => navigateCrm("Підбір запчастин", { diagnosticId: row.id, vehicleId, plate: plateNumber || "", vin: vin || "" })}>Підібрати запчастини</button>}
          {row.commercialProposal ? <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: row.commercialProposal!.workOrderId, workOrderTab: "estimate" })}>Відкрити КП</button> : state === "CONFIRMED" ? <button type="button" disabled={busyId === row.id} onClick={() => void createCommercialProposal(row)}>{busyId === row.id ? "Створюю…" : "Створити КП"}</button> : null}
        </div>
      </article>;
    })}</div>
  </div>;
}
