"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkOrderCommercialPanel } from "./work-order-commercial-panel";
import styles from "./work-orders.module.css";

type GateItem = { code: string; label: string };
type ActionItem = { code: string; label: string };
type Transition = {
  to: string;
  label: string;
  allowed: boolean;
  code: string;
  requiredGates: GateItem[];
  missingGates: GateItem[];
  actions: ActionItem[];
  unsupportedActions: ActionItem[];
};

type WorkOrderRow = {
  id: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  stage: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  client: { id: string; name: string | null; phone: string };
  vehicle: {
    id: string;
    brand: string | null;
    model: string | null;
    year: number | null;
    plateNumber: string | null;
    vin: string | null;
    mileageKm: number | null;
    turboLevClass: string | null;
  };
  diagnosticRequest: {
    id: string;
    status: string;
    technicalConclusion: string | null;
    confirmedAt: string | null;
    leadId: string | null;
    createdAt: string;
  };
  transitions: Transition[];
};

type WorkOrderDetail = WorkOrderRow & {
  appointment: null | {
    id: string;
    status: string;
    plannedStartAt: string;
    actualArrivalAt: string | null;
    post: { name: string } | null;
    mechanic: { name: string } | null;
  };
  recentCalls: Array<{
    id: string;
    type: string;
    status: string | null;
    duration: number;
    startedAt: string | null;
    recordingUrl: string | null;
  }>;
};

const FILTERS = [
  ["ALL", "Усі"],
  ["PARTS_REVIEW", "Опрацювання"],
  ["WAITING_APPROVAL", "Погодження"],
  ["WAITING_PARTS", "Очікують деталі"],
  ["READY_FOR_REPAIR", "Готові до ремонту"],
  ["IN_REPAIR", "У ремонті"],
  ["WAITING_QC", "QC"],
  ["READY_FOR_PICKUP", "До видачі"],
  ["CLOSED", "Закриті"],
] as const;

function vehicleName(item: WorkOrderRow) {
  return [item.vehicle.brand, item.vehicle.model, item.vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function transitionReason(item: Transition) {
  if (item.missingGates.length) return item.missingGates.map((gate) => gate.label).join(" · ");
  if (item.unsupportedActions.length) return `Спочатку потрібно реалізувати: ${item.unsupportedActions.map((action) => action.label).join(", ")}`;
  if (!item.allowed) return "Перехід заборонений Workflow Runtime.";
  if (item.actions.length) return item.actions.map((action) => action.label).join(" · ");
  return "Перехід дозволено системними правилами.";
}

export function WorkOrders() {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyTransition, setBusyTransition] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/work-orders", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити замовлення-наряди.");
      const nextRows = Array.isArray(payload.workOrders) ? payload.workOrders : [];
      setRows(nextRows);
      setSelectedId((current) => current && nextRows.some((row: WorkOrderRow) => row.id === current) ? current : nextRows[0]?.id ?? null);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Помилка завантаження." });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/work-orders/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити наряд.");
      setDetail(payload.workOrder);
    } catch (error) {
      setDetail(null);
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Помилка завантаження картки." });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadRows(); }, [loadRows]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  const filtered = useMemo(() => filter === "ALL" ? rows : rows.filter((row) => row.status === filter), [rows, filter]);
  const counts = useMemo(() => ({
    active: rows.filter((row) => !["CLOSED", "CANCELLED"].includes(row.status)).length,
    repair: rows.filter((row) => row.status === "IN_REPAIR").length,
    blocked: rows.filter((row) => row.transitions.some((transition) => !transition.allowed && (transition.missingGates.length || transition.unsupportedActions.length))).length,
    ready: rows.filter((row) => row.status === "READY_FOR_PICKUP").length,
  }), [rows]);

  async function runTransition(transition: Transition) {
    if (!detail || !transition.allowed || busyTransition) return;
    setBusyTransition(transition.to);
    setMessage(null);
    try {
      const response = await fetch(`/api/work-orders/${encodeURIComponent(detail.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: transition.to, actorName: "CRM / WorkOrder Center" }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        const missing = payload.workflowDecision?.missingGates as string[] | undefined;
        throw new Error(missing?.length ? `${payload.error} ${missing.join(", ")}` : payload.error || "Перехід не виконано.");
      }
      setMessage({ kind: "success", text: `Статус змінено: ${payload.workOrder.statusLabel}.` });
      await Promise.all([loadRows(), loadDetail(detail.id)]);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Не вдалося змінити статус." });
    } finally {
      setBusyTransition(null);
    }
  }

  return <div className={styles.page}>
    <header className={styles.head}>
      <div>
        <p className={styles.eyebrow}>СЕРВІС · WORKFLOW RUNTIME</p>
        <h1>Замовлення-наряди</h1>
        <p>Фактичний виробничий контур після підтвердженої діагностики. Кошторис, запчастини й переходи працюють на реальних даних, а Hard Gates не можна обійти ручною зміною статусу.</p>
      </div>
      <button className={styles.refresh} type="button" onClick={() => void loadRows()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
    </header>

    <section className={styles.kpis}>
      <div><span>Активні наряди</span><strong>{counts.active}</strong></div>
      <div><span>У ремонті</span><strong>{counts.repair}</strong></div>
      <div><span>Є блокуючий Gate/Action</span><strong>{counts.blocked}</strong></div>
      <div><span>Готові до видачі</span><strong>{counts.ready}</strong></div>
    </section>

    <nav className={styles.filters}>
      {FILTERS.map(([code, label]) => {
        const count = code === "ALL" ? rows.length : rows.filter((row) => row.status === code).length;
        return <button type="button" className={filter === code ? styles.activeFilter : ""} key={code} onClick={() => setFilter(code)}>{label}<b>{count}</b></button>;
      })}
    </nav>

    {message && <div className={`${styles.notice} ${message.kind === "error" ? styles.error : styles.success}`}>{message.text}</div>}

    <div className={styles.layout}>
      <section className={styles.list}>
        {loading && !rows.length ? <div className={styles.empty}>Завантажую замовлення-наряди…</div> : !filtered.length ? <div className={styles.empty}>У цьому статусі нарядів немає.</div> : filtered.map((item) => <button type="button" key={item.id} className={`${styles.row} ${selectedId === item.id ? styles.rowActive : ""}`} onClick={() => setSelectedId(item.id)}>
          <div>
            <div className={styles.rowTitle}><strong>{vehicleName(item)}</strong>{item.vehicle.plateNumber && <span className={styles.plate}>{item.vehicle.plateNumber}</span>}</div>
            <div className={styles.rowMeta}>{item.client.name || "Клієнт без імені"} · {item.client.phone}<br/>Оновлено {formatDate(item.updatedAt)}</div>
          </div>
          <span className={styles.status}>{item.statusLabel}</span>
        </button>)}
      </section>

      <aside className={styles.detail}>
        {detailLoading && !detail ? <div className={styles.empty}>Завантажую картку…</div> : !detail ? <div className={styles.empty}>Оберіть замовлення-наряд зі списку.</div> : <>
          <div className={styles.detailHead}>
            <div><p className={styles.eyebrow}>WORKORDER</p><h2>{vehicleName(detail)}</h2><p>{detail.client.name || "Клієнт без імені"} · {detail.client.phone}</p></div>
            <div><span className={styles.status}>{detail.statusLabel}</span><div className={styles.id}>{detail.id}</div></div>
          </div>

          <div className={styles.grid}>
            <div className={styles.field}><span>Держномер</span><strong>{detail.vehicle.plateNumber || "—"}</strong></div>
            <div className={styles.field}><span>VIN</span><strong>{detail.vehicle.vin || "—"}</strong></div>
            <div className={styles.field}><span>Пробіг</span><strong>{detail.vehicle.mileageKm ? `${detail.vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}</strong></div>
            <div className={styles.field}><span>Клас Turbo LEV</span><strong>{detail.vehicle.turboLevClass || "—"}</strong></div>
            <div className={styles.field}><span>Підтверджено діагностику</span><strong>{formatDate(detail.diagnosticRequest.confirmedAt)}</strong></div>
            <div className={styles.field}><span>Планувальник</span><strong>{detail.appointment ? `${detail.appointment.post?.name || "Без поста"} · ${detail.appointment.mechanic?.name || "Без механіка"}` : "Не зв'язано"}</strong></div>
          </div>

          <section className={styles.section}>
            <h3>Технічний висновок</h3>
            <div className={styles.conclusion}>{detail.diagnosticRequest.technicalConclusion || "Технічний висновок відсутній."}</div>
          </section>

          <section className={styles.section}>
            <h3>Кошторис · погодження · запчастини</h3>
            <WorkOrderCommercialPanel workOrderId={detail.id} onChanged={() => { void loadDetail(detail.id); void loadRows(); }}/>
          </section>

          <section className={styles.section}>
            <h3>Наступні переходи</h3>
            {!detail.transitions.length ? <div className={styles.empty}>Статус термінальний — наступних переходів немає.</div> : <div className={styles.transitions}>{detail.transitions.map((transition) => <div className={styles.transition} key={transition.to}>
              <div><strong>→ {transition.label}</strong><small>{transitionReason(transition)}</small></div>
              <button type="button" disabled={!transition.allowed || Boolean(busyTransition)} onClick={() => void runTransition(transition)}>{busyTransition === transition.to ? "Змінюю…" : transition.allowed ? "Перевести" : "Заблоковано"}</button>
            </div>)}</div>}
          </section>

          <section className={styles.section}>
            <h3>Останні дзвінки клієнта</h3>
            {!detail.recentCalls.length ? <div className={styles.empty}>Пов'язаних дзвінків поки немає.</div> : <div className={styles.calls}>{detail.recentCalls.map((call) => <div className={styles.call} key={call.id}><span>{call.type === "INCOMING" ? "Вхідний" : "Вихідний"} · {call.status || "—"}</span><span>{formatDate(call.startedAt)} · {call.duration} c</span></div>)}</div>}
          </section>
        </>}
      </aside>
    </div>
  </div>;
}
