"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DiagnosticReportSharePanel } from "./diagnostic-report-share-panel";
import { StructuredDiagnosticReviewPanel } from "./structured-diagnostic-review-panel";
import { navigateCrm, readCrmRoute } from "./crm-route";
import styles from "./diagnostics.module.css";
import registryStyles from "./diagnostics-registry.module.css";

type DiagnosticStatus = "PENDING" | "IN_PROGRESS" | "CONFIRMED" | "CANCELLED";
type WorkflowState = DiagnosticStatus | "SUBMITTED" | "RETURNED";
type CommercialStage = "PARTS_SELECTION" | "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "SUPERSEDED";
type Diagnostic = {
  id: string;
  status: DiagnosticStatus;
  workflowState?: Exclude<WorkflowState, "RETURNED">;
  reviewState?: string;
  technicalConclusion: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string | null; phone: string };
  vehicle: { id: string; brand: string | null; model: string | null; year: number | null; plateNumber: string | null; vin: string | null; mileageKm: number | null };
  lead: { id: string; need: string | null; comment: string | null; assignedUserId: string | null } | null;
  workOrder: { id: string; status: string; createdAt: string; updatedAt: string } | null;
  assignedMechanic?: { id: string; name: string | null } | null;
  reportShare?: { id: string; active: boolean; createdAt: string; expiresAt: string | null; revokedAt: string | null } | null;
  diagnosticCard?: { id: string; number: string; currentRevision: number; finalizedAt: string | null; confirmedByUserId: string | null } | null;
  commercialProposal?: {
    workOrderId: string;
    stage: CommercialStage;
    estimate: { id: string; revision: number; status: string } | null;
    partsRequest: { id: string; status: string } | null;
  } | null;
  structured?: { inspections: number; checked: number; defects: number; attention: number };
};
type ApiResponse = { ok: boolean; diagnostics?: Diagnostic[]; diagnostic?: Diagnostic; workOrder?: Diagnostic["workOrder"]; error?: string; message?: string };
type Filter = "ALL" | "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "CONFIRMED" | "COMMERCIAL" | "CANCELLED";

const statusMeta: Record<WorkflowState, { label: string; note: string }> = {
  PENDING: { label: "Очікує", note: "Діагностика підготовлена до старту" },
  IN_PROGRESS: { label: "В роботі", note: "Механік проводить діагностику; CRM зберігає результати" },
  SUBMITTED: { label: "На перевірці", note: "Механік завершив діагностику; сервіс-менеджер перевіряє ДК" },
  RETURNED: { label: "В роботі", note: "ДК повернено механіку з коментарем; діагностика знову в роботі" },
  CONFIRMED: { label: "Підтверджена", note: "Діагностична карта зафіксована та доступна для комерційного етапу" },
  CANCELLED: { label: "Скасована", note: "Діагностику закрито без підтвердженої ДК" },
};
const filters: Array<{ value: Filter; label: string }> = [
  { value: "ALL", label: "Усі" },
  { value: "PENDING", label: "Очікують" },
  { value: "IN_PROGRESS", label: "В роботі" },
  { value: "SUBMITTED", label: "На перевірці" },
  { value: "CONFIRMED", label: "Підтверджені" },
  { value: "COMMERCIAL", label: "Комерційна пропозиція" },
  { value: "CANCELLED", label: "Скасовані" },
];
const commercialLabels: Record<CommercialStage, string> = {
  PARTS_SELECTION: "Підбір запчастин",
  DRAFT: "КП · Чернетка",
  SENT: "КП · Відправлена",
  APPROVED: "КП · Погоджена",
  REJECTED: "КП · Відхилена",
  SUPERSEDED: "КП · Нова ревізія",
};

function vehicleName(row: Diagnostic) {
  return [row.vehicle.brand, row.vehicle.model, row.vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}
function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function workflowState(row: Diagnostic): WorkflowState {
  if (row.reviewState === "RETURNED") return "RETURNED";
  return row.workflowState || row.status;
}
function stateClass(row: Diagnostic) {
  const state = workflowState(row);
  if (state === "SUBMITTED" || state === "RETURNED") return styles.IN_PROGRESS;
  return styles[row.status];
}
function matchesFilter(row: Diagnostic, filter: Filter) {
  if (filter === "ALL") return true;
  if (filter === "COMMERCIAL") return Boolean(row.status === "CONFIRMED" && row.commercialProposal);
  if (filter === "SUBMITTED") return workflowState(row) === "SUBMITTED";
  if (filter === "IN_PROGRESS") return workflowState(row) === "IN_PROGRESS" || workflowState(row) === "RETURNED";
  return row.status === filter;
}
function matchesSearch(row: Diagnostic, query: string) {
  const q = query.trim().toLocaleLowerCase("uk-UA");
  if (!q) return true;
  return [
    row.vehicle.plateNumber,
    row.vehicle.vin,
    vehicleName(row),
    row.client.name,
    row.client.phone,
    row.diagnosticCard?.number,
    row.assignedMechanic?.name,
  ].filter(Boolean).join(" ").toLocaleLowerCase("uk-UA").includes(q);
}

export function Diagnostics() {
  const [rows, setRows] = useState<Diagnostic[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [mechanic, setMechanic] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conclusion, setConclusion] = useState("");

  const applyRoute = useCallback((nextRows: Diagnostic[]) => {
    const route = readCrmRoute();
    const diagnosticId = route.diagnosticId || null;
    const vehicleId = route.vehicleId || null;
    setSelectedId((current) => {
      if (diagnosticId && nextRows.some((row) => row.id === diagnosticId)) return diagnosticId;
      if (vehicleId) {
        const vehicleDiagnostic = nextRows.find((row) => row.vehicle.id === vehicleId);
        return vehicleDiagnostic?.id ?? null;
      }
      if (current && nextRows.some((row) => row.id === current)) return current;
      return nextRows[0]?.id ?? null;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/diagnostics?limit=500", { cache: "no-store", credentials: "include" });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.ok || !data.diagnostics) throw new Error(data.message || data.error || "Не вдалося завантажити діагностики");
      setRows(data.diagnostics);
      applyRoute(data.diagnostics);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [applyRoute]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const sync = () => applyRoute(rows);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [applyRoute, rows]);

  const mechanics = useMemo(() => Array.from(new Set(rows.map((row) => row.assignedMechanic?.name).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, "uk")), [rows]);
  const visible = useMemo(() => rows.filter((row) => matchesFilter(row, filter) && matchesSearch(row, search) && (mechanic === "ALL" || row.assignedMechanic?.name === mechanic)), [rows, filter, search, mechanic]);
  const selected = rows.find((item) => item.id === selectedId) ?? null;
  useEffect(() => { setConclusion(selected?.technicalConclusion ?? ""); setMessage(""); }, [selectedId, selected?.technicalConclusion]);

  const counts = useMemo(() => ({
    waiting: rows.filter((row) => row.status === "PENDING").length,
    inWork: rows.filter((row) => workflowState(row) === "IN_PROGRESS" || workflowState(row) === "RETURNED").length,
    submitted: rows.filter((row) => workflowState(row) === "SUBMITTED").length,
    confirmed: rows.filter((row) => row.status === "CONFIRMED").length,
  }), [rows]);

  async function transition(status: DiagnosticStatus) {
    if (!selected) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${selected.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, technicalConclusion: conclusion }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.ok || !data.diagnostic) throw new Error(data.message || data.error || "Не вдалося змінити статус");
      await load();
      setMessage(status === "CONFIRMED" ? "Діагностичну карту підтверджено." : "Статус діагностики оновлено.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка зміни статусу");
    } finally {
      setSaving(false);
    }
  }

  const filterCount = (value: Filter) => rows.filter((row) => matchesFilter(row, value)).length;

  return <div className={styles.page}>
    <header className={styles.head}><div><p className={styles.eyebrow}>СЕРВІС · ДІАГНОСТИКА</p><h1>Всі діагностики</h1><p>Єдиний реєстр усіх діагностик СТО. Основний процес: Очікує → В роботі → На перевірці → Підтверджена. Повернення ДК механіку не створює окремого статусу — вона знову відображається «В роботі». Комерційна пропозиція відображається окремо й не змінює статус ДК.</p></div><button className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button></header>

    <section className={styles.kpis}><div><span>Очікують</span><strong>{counts.waiting}</strong></div><div><span>В роботі</span><strong>{counts.inWork}</strong></div><div><span>На перевірці</span><strong>{counts.submitted}</strong></div><div><span>Підтверджені</span><strong>{counts.confirmed}</strong></div></section>

    <nav className={styles.filters}>{filters.map((item) => <button key={item.value} className={filter === item.value ? styles.activeFilter : ""} onClick={() => setFilter(item.value)}>{item.label}<span>{filterCount(item.value)}</span></button>)}</nav>

    <div className={registryStyles.toolbar}>
      <label className={registryStyles.search}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер авто, VIN, клієнт, телефон, № ДК або механік..." />{search && <button type="button" onClick={() => setSearch("")} aria-label="Очистити пошук">×</button>}</label>
      <select className={registryStyles.select} value={mechanic} onChange={(event) => setMechanic(event.target.value)} aria-label="Фільтр за механіком"><option value="ALL">Усі механіки</option>{mechanics.map((name) => <option key={name} value={name}>{name}</option>)}</select>
    </div>

    {(readCrmRoute().diagnosticId || readCrmRoute().vehicleId) && <div className={registryStyles.routeHint}>
      {readCrmRoute().diagnosticId
        ? "Відкрито Діагностичну карту з історії автомобіля."
        : readCrmRoute().workflowFocus === "proposal"
          ? "Для цього автомобіля Комерційна пропозиція стане доступною після підтвердження Діагностичної карти."
          : readCrmRoute().workflowFocus === "repair"
            ? "Ремонт відкриється після погодження Комерційної пропозиції та створення замовлення-наряду."
            : "Відкрито процес Діагностичної карти для цього автомобіля."}
    </div>}
    {error && <div className={styles.error}>{error}</div>}{message && <div className={styles.success}>{message}</div>}

    <div className={styles.layout}>
      <section className={styles.list}>{loading && !rows.length ? <div className={styles.empty}>Завантажую діагностики…</div> : visible.length ? visible.map((row) => {
        const state = workflowState(row);
        return <button key={row.id} className={`${styles.row} ${selectedId === row.id ? styles.selected : ""}`} onClick={() => setSelectedId(row.id)}>
          <div className={styles.rowTop}><span className={`${styles.status} ${stateClass(row)}`}>{statusMeta[state].label}</span><time>{dateTime(row.updatedAt)}</time></div>
          <strong>{vehicleName(row)}</strong><span className={styles.plate}>{row.vehicle.plateNumber || "Без номера"}</span>
          <small>{row.client.name || row.client.phone}</small>
          {row.assignedMechanic?.name && <span className={registryStyles.mechanic}>Механік: {row.assignedMechanic.name}</span>}
          {row.lead?.need && <p>{row.lead.need}</p>}
          {row.structured && row.structured.inspections > 0 && <small>Чекліст: {row.structured.checked} перевірено · {row.structured.defects} деф. · {row.structured.attention} увага</small>}
          {row.diagnosticCard?.number ? <span className={styles.workOrderBadge}>{row.diagnosticCard.number}{row.diagnosticCard.finalizedAt ? " · фінальна" : " · REVIEW"}</span> : row.status === "CONFIRMED" ? <span className={styles.workOrderBadge}>Історична діагностика</span> : null}
          {row.commercialProposal && <span className={registryStyles.commercialBadge}>{commercialLabels[row.commercialProposal.stage]}</span>}
        </button>;
      }) : <div className={styles.empty}>За цими умовами діагностик немає.</div>}</section>

      <aside className={styles.detail}>{selected ? <>
        <div className={styles.detailHead}><div><span className={`${styles.status} ${stateClass(selected)}`}>{statusMeta[workflowState(selected)].label}</span><h2>{vehicleName(selected)}</h2><p>{selected.vehicle.plateNumber || "Без держномера"} · {selected.vehicle.vin || "VIN не вказано"}</p></div></div>
        <div className={styles.infoGrid}>
          <div><span>Клієнт</span><strong>{selected.client.name || "Без імені"}</strong><small>{selected.client.phone}</small></div>
          <div><span>Механік</span><strong>{selected.assignedMechanic?.name || "Не призначено"}</strong></div>
          <div><span>Створено</span><strong>{dateTime(selected.createdAt)}</strong></div>
          <div><span>Діагностична карта</span><strong>{selected.diagnosticCard?.number || (selected.status === "CONFIRMED" ? "Історична ДК" : "Ще не сформована")}</strong><small>{selected.diagnosticCard?.currentRevision ? `ревізія ${selected.diagnosticCard.currentRevision}` : ""}</small></div>
        </div>
        {selected.lead?.need && <div className={styles.problem}><span>Скарга / завдання</span><p>{selected.lead.need}</p></div>}
        <label className={styles.conclusion}><span>Технічний висновок</span><textarea rows={selected.structured?.inspections ? 5 : 8} value={conclusion} disabled={selected.status === "CANCELLED" || Boolean(selected.structured?.inspections) || selected.status === "CONFIRMED"} placeholder={selected.structured?.inspections ? "Висновок перевіряється у Діагностичній карті нижче." : "Опишіть підтверджені дефекти, результати перевірки та рекомендовані роботи…"} onChange={(event) => setConclusion(event.target.value)} /><small>{selected.structured?.inspections ? "Для структурованої діагностики висновок та ДК формуються у блоці нижче." : "Для старої діагностики заповніть висновок вручну."}</small></label>
        {selected.commercialProposal && <div className={styles.woCard}><div><span>Комерційний етап</span><strong>{commercialLabels[selected.commercialProposal.stage]}</strong></div><button className={styles.secondary} type="button" onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: selected.commercialProposal!.workOrderId, workOrderTab: "estimate" })}>Відкрити КП →</button></div>}
        {!selected.structured?.inspections && selected.reviewState === "CONFIRMED" && <DiagnosticReportSharePanel diagnosticId={selected.id} reviewState={selected.reviewState} workOrder={selected.workOrder} />}
        {selected.structured?.inspections ? <StructuredDiagnosticReviewPanel diagnosticId={selected.id} onChanged={load} /> : <div className={styles.actions}>{selected.status === "PENDING" && <><button className={styles.primary} disabled={saving} onClick={() => void transition("IN_PROGRESS")}>Почати стару діагностику</button><button className={styles.secondary} disabled={saving} onClick={() => void transition("CANCELLED")}>Скасувати</button></>}{selected.status === "IN_PROGRESS" && <><button className={styles.primary} disabled={saving || !conclusion.trim()} onClick={() => void transition("CONFIRMED")}>{saving ? "Зберігаю…" : "Підтвердити стару діагностику"}</button><button className={styles.secondary} disabled={saving} onClick={() => void transition("CANCELLED")}>Скасувати</button></>}{selected.status === "CONFIRMED" && <span className={styles.lockNote}>✓ Діагностику зафіксовано. Для нового циклу потрібна нова заявка на діагностику.</span>}{selected.status === "CANCELLED" && <span className={styles.lockNote}>Діагностику скасовано. Історія збережена.</span>}</div>}
      </> : readCrmRoute().vehicleId ? <div className={styles.empty}>
        <h2>Діагностична карта для автомобіля</h2>
        <p>Для цього автомобіля ще немає створеної діагностики. Карта зʼявиться після прибуття автомобіля на діагностику та призначення механіка.</p>
        <button className={styles.secondary} type="button" onClick={() => navigateCrm("Авто", { vehicleId: readCrmRoute().vehicleId })}>← Повернутися до картки авто</button>
      </div> : <div className={styles.empty}>Оберіть діагностику зі списку.</div>}</aside>
    </div>
  </div>;
}