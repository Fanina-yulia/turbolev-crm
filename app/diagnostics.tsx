"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DiagnosticReportSharePanel } from "./diagnostic-report-share-panel";
import { StructuredDiagnosticReviewPanel } from "./structured-diagnostic-review-panel";
import { VehiclePlate } from "./vehicle-plate";
import { navigateCrm, readCrmRoute } from "./crm-route";
import styles from "./diagnostics.module.css";
import registryStyles from "./diagnostics-registry.module.css";

type DiagnosticStatus = "PENDING" | "IN_PROGRESS" | "CONFIRMED" | "CANCELLED";
type WorkflowState = DiagnosticStatus | "SUBMITTED" | "RETURNED";
type CommercialStage = "PARTS_SELECTION" | "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "SUPERSEDED";
type Diagnostic = {
  id: string;
  status: DiagnosticStatus;
  workflowState?: WorkflowState;
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
  visit?: {
    appointmentId: string | null;
    plannedStartAt: string | null;
    plannedEndAt: string | null;
    actualArrivalAt: string | null;
    actualStartAt: string | null;
    actualEndAt: string | null;
    postName: string | null;
    locationName: string | null;
  } | null;
  structured?: { inspections: number; checked: number; defects: number; attention: number };
};
type ApiResponse = { ok: boolean; diagnostics?: Diagnostic[]; diagnostic?: Diagnostic; workOrder?: Diagnostic["workOrder"]; error?: string; message?: string };
type Filter = "ALL" | "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "CONFIRMED" | "COMMERCIAL" | "CANCELLED";
type Scope = "CURRENT" | "HISTORY";

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
function routeFilter(value: string | null | undefined): Filter | null {
  const normalized = (value || "").trim().toUpperCase();
  return filters.some((item) => item.value === normalized) ? normalized as Filter : null;
}
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
function timeRange(row: Diagnostic) {
  const start = row.visit?.plannedStartAt;
  const end = row.visit?.plannedEndAt;
  if (!start) return `Створено ${dateTime(row.createdAt)}`;
  if (!end) return dateTime(start);
  const startText = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(start));
  const endText = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" }).format(new Date(end));
  return `${startText}–${endText}`;
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
function isHistory(row: Diagnostic) {
  return workflowState(row) === "CONFIRMED" || workflowState(row) === "CANCELLED";
}

export function Diagnostics() {
  const [rows, setRows] = useState<Diagnostic[]>([]);
  const [scope, setScope] = useState<Scope>("CURRENT");
  const [filter, setFilter] = useState<Filter>(() => routeFilter(readCrmRoute().filter) || "ALL");
  const [search, setSearch] = useState("");
  const [mechanic, setMechanic] = useState("ALL");
  const [vehicleIdFilter, setVehicleIdFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [routeDiagnosticId, setRouteDiagnosticId] = useState<string | null>(() => readCrmRoute().diagnosticId || null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conclusion, setConclusion] = useState("");

  const applyRoute = useCallback((nextRows: Diagnostic[]) => {
    const route = readCrmRoute();
    const diagnosticId = route.diagnosticId || null;
    const vehicleId = route.vehicleId || null;
    const nextFilter = routeFilter(route.filter);
    setRouteDiagnosticId(diagnosticId);
    setVehicleIdFilter(vehicleId);
    if (nextFilter) {
      setFilter(nextFilter);
      if (nextFilter === "CONFIRMED" || nextFilter === "CANCELLED" || nextFilter === "COMMERCIAL") setScope("HISTORY");
      else setScope("CURRENT");
    }
    const matchingRows = nextRows.filter((row) => !vehicleId || row.vehicle.id === vehicleId);
    setSelectedId((current) => {
      if (diagnosticId && matchingRows.some((row) => row.id === diagnosticId)) return diagnosticId;
      if (!diagnosticId) return null;
      return current && matchingRows.some((row) => row.id === current) ? current : null;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const route = readCrmRoute();
      const params = new URLSearchParams({ limit: "500" });
      if (route.vehicleId) params.set("vehicleId", route.vehicleId);
      const response = await fetch(`/api/diagnostics?${params.toString()}`, { cache: "no-store", credentials: "include" });
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
    if (!routeDiagnosticId || loading || !rows.length) return;
    const row = rows.find((item) => item.id === routeDiagnosticId);
    if (!row) return;
    navigateCrm("Авто", { vehicleId: row.vehicle.id, vehiclePage: "diagnostic-card", diagnosticId: row.id });
  }, [loading, routeDiagnosticId, rows]);
  useEffect(() => {
    const sync = () => applyRoute(rows);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [applyRoute, rows]);

  const mechanics = useMemo(() => Array.from(new Set(rows.map((row) => row.assignedMechanic?.name).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, "uk")), [rows]);
  const scopedRows = useMemo(() => rows.filter((row) => isHistory(row) === (scope === "HISTORY")), [rows, scope]);
  const visible = useMemo(() => scopedRows
    .filter((row) => (!vehicleIdFilter || row.vehicle.id === vehicleIdFilter) && matchesFilter(row, filter) && matchesSearch(row, search) && (mechanic === "ALL" || row.assignedMechanic?.name === mechanic))
    .sort((a, b) => new Date(a.visit?.plannedStartAt || a.updatedAt).getTime() - new Date(b.visit?.plannedStartAt || b.updatedAt).getTime()), [scopedRows, vehicleIdFilter, filter, search, mechanic]);
  const selected = rows.find((item) => item.id === selectedId) ?? null;
  useEffect(() => { setConclusion(selected?.technicalConclusion ?? ""); setMessage(""); }, [selectedId, selected?.technicalConclusion]);

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

  const filterCount = (value: Filter) => scopedRows.filter((row) => matchesFilter(row, value)).length;
  const openDiagnostic = (row: Diagnostic) => {
    setSelectedId(row.id);
    navigateCrm("Авто", { vehicleId: row.vehicle.id, vehiclePage: "diagnostic-card", diagnosticId: row.id });
  };

  return <div className={`${styles.page} ${routeDiagnosticId ? styles.focusPage : ""}`}>
    {!routeDiagnosticId && <header className={styles.head}><div><p className={styles.eyebrow}>СЕРВІС · ДІАГНОСТИКА</p><h1>Всі діагностики</h1></div><div className={styles.headActions}><label className={`${registryStyles.search} ${registryStyles.headerSearch}`}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер авто, VIN, клієнт, телефон, № ДК або механік..." />{search && <button type="button" onClick={() => setSearch("")} aria-label="Очистити пошук">×</button>}</label><select className={`${registryStyles.select} ${registryStyles.headerMechanic}`} value={mechanic} onChange={(event) => setMechanic(event.target.value)} aria-label="Фільтр за механіком"><option value="ALL">Усі механіки</option>{mechanics.map((name) => <option key={name} value={name}>{name}</option>)}</select><button className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button></div></header>}

    {!routeDiagnosticId && <section className={styles.summary} aria-label="Підсумок діагностик">
      <button type="button" className={styles.summaryCard} onClick={() => { setScope("CURRENT"); setFilter("ALL"); }}><span>Поточні</span><strong>{rows.filter((row) => !isHistory(row)).length}</strong><small>записів у роботі</small></button>
      <button type="button" className={`${styles.summaryCard} ${styles.summaryAttention}`} onClick={() => { setScope("CURRENT"); setFilter("PENDING"); }}><span>Очікують</span><strong>{rows.filter((row) => workflowState(row) === "PENDING").length}</strong><small>ще не розпочаті</small></button>
      <button type="button" className={`${styles.summaryCard} ${styles.summaryProgress}`} onClick={() => { setScope("CURRENT"); setFilter("IN_PROGRESS"); }}><span>В роботі</span><strong>{rows.filter((row) => matchesFilter(row, "IN_PROGRESS")).length}</strong><small>механік перевіряє</small></button>
      <button type="button" className={`${styles.summaryCard} ${styles.summaryAttention}`} onClick={() => { setScope("CURRENT"); setFilter("SUBMITTED"); }}><span>На перевірці</span><strong>{rows.filter((row) => workflowState(row) === "SUBMITTED").length}</strong><small>очікують сервіс-менеджера</small></button>
      <button type="button" className={`${styles.summaryCard} ${styles.summaryDone}`} onClick={() => { setScope("HISTORY"); setFilter("CONFIRMED"); }}><span>Завершені</span><strong>{rows.filter((row) => workflowState(row) === "CONFIRMED").length}</strong><small>карта сформована</small></button>
    </section>}
    {!routeDiagnosticId && <nav className={styles.filters} aria-label="Фільтр за етапом">{filters.map((item) => <button type="button" key={item.value} className={filter === item.value ? styles.activeFilter : ""} onClick={() => setFilter(item.value)}>{item.label}<span>{filterCount(item.value)}</span></button>)}</nav>}

    {!routeDiagnosticId && (readCrmRoute().diagnosticId || readCrmRoute().vehicleId) && <div className={registryStyles.routeHint}>
      {readCrmRoute().diagnosticId
        ? "Відкрито Діагностичну карту з історії автомобіля."
        : readCrmRoute().workflowFocus === "proposal"
          ? "Для цього автомобіля Комерційна пропозиція стане доступною після підтвердження Діагностичної карти."
          : readCrmRoute().workflowFocus === "repair"
            ? "Ремонт відкриється після погодження Комерційної пропозиції та створення замовлення-наряду."
            : "Відкрито процес Діагностичної карти для цього автомобіля."}
    </div>}
    {!routeDiagnosticId && error && <div className={styles.error}>{error}</div>}{!routeDiagnosticId && message && <div className={styles.success}>{message}</div>}

    <div className={`${styles.layout} ${routeDiagnosticId ? styles.detailOnly : styles.registryOnly}`}>
      {!routeDiagnosticId && <section className={styles.list}>{loading && !rows.length ? <div className={styles.empty}>Завантажую діагностики…</div> : visible.length ? visible.map((row) => {
        const state = workflowState(row);
        return <button type="button" key={row.id} className={`${styles.row} ${styles[`row${state}`] || ""} ${selectedId === row.id ? styles.selected : ""}`} onClick={() => openDiagnostic(row)} aria-label={`Відкрити діагностичну карту: ${vehicleName(row)}`}>
          <div className={styles.rowStatus}><span className={`${styles.status} ${stateClass(row)}`}><i aria-hidden="true" />{statusMeta[state].label}</span></div>
          <div className={styles.rowVehicle}><strong>{vehicleName(row)}</strong><VehiclePlate value={row.vehicle.plateNumber} size="sm" /></div>
          <div className={styles.rowCell}><span>Клієнт</span><small>{row.client.name || row.client.phone}</small></div>
          <div className={styles.rowCell}><span>Механік</span><small>{row.assignedMechanic?.name || "Не призначено"}</small></div>
          <div className={styles.rowCell}><span>Прогрес</span><small>{row.structured && row.structured.inspections > 0 ? `${row.structured.checked} перевірено · ${row.structured.defects} деф. · ${row.structured.attention} увага` : row.lead?.need || "Структурованих даних ще немає"}</small></div>
          <div className={styles.rowDate}><span>Візит</span><time>{timeRange(row)}</time></div>
          <div className={styles.rowBottom}>{row.diagnosticCard?.number ? <span className={styles.workOrderBadge}>{row.diagnosticCard.number}{row.diagnosticCard.finalizedAt ? " · фінальна" : " · REVIEW"}</span> : row.status === "CONFIRMED" ? <span className={styles.workOrderBadge}>Історична діагностика</span> : <span />}{row.commercialProposal && <span className={registryStyles.commercialBadge}>{commercialLabels[row.commercialProposal.stage]}</span>}<span className={styles.openLink}>Відкрити ДК →</span></div>
        </button>;
      }) : <div className={styles.empty}>За цими умовами діагностик немає.</div>}</section>}

      <aside className={styles.detail}>{selected ? <>
        {!routeDiagnosticId && <div className={styles.detailBack}><button className={styles.secondary} type="button" onClick={() => navigateCrm("Діагностика")}>← До всіх діагностик</button></div>}
        {selected.structured?.inspections ? <StructuredDiagnosticReviewPanel diagnosticId={selected.id} onChanged={load} /> : <>
          <div className={styles.detailHead}><div><span className={`${styles.status} ${stateClass(selected)}`}>{statusMeta[workflowState(selected)].label}</span><h2>{vehicleName(selected)}</h2><p><VehiclePlate value={selected.vehicle.plateNumber} size="sm" /> · {selected.vehicle.vin || "VIN не вказано"}</p></div></div>
          <div className={styles.infoGrid}>
            <div><span>Клієнт</span><strong>{selected.client.name || "Без імені"}</strong><small>{selected.client.phone}</small></div>
            <div><span>Механік</span><strong>{selected.assignedMechanic?.name || "Не призначено"}</strong></div>
            <div><span>Створено</span><strong>{dateTime(selected.createdAt)}</strong></div>
            <div><span>Діагностична карта</span><strong>{selected.diagnosticCard?.number || (selected.status === "CONFIRMED" ? "Історична ДК" : "Ще не сформована")}</strong><small>{selected.diagnosticCard?.currentRevision ? `ревізія ${selected.diagnosticCard.currentRevision}` : ""}</small></div>
          </div>
          {selected.lead?.need && <div className={styles.problem}><span>Скарга / завдання</span><p>{selected.lead.need}</p></div>}
          <label className={styles.conclusion}><span>Технічний висновок</span><textarea rows={8} value={conclusion} disabled={selected.status === "CANCELLED" || selected.status === "CONFIRMED"} placeholder="Опишіть підтверджені дефекти, результати перевірки та рекомендовані роботи…" onChange={(event) => setConclusion(event.target.value)} /><small>Для старої діагностики заповніть висновок вручну.</small></label>
          {selected.commercialProposal && <div className={styles.woCard}><div><span>Комерційний етап</span><strong>{commercialLabels[selected.commercialProposal.stage]}</strong></div><button className={styles.secondary} type="button" onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: selected.commercialProposal!.workOrderId, workOrderTab: "estimate" })}>Відкрити КП →</button></div>}
          {selected.reviewState === "CONFIRMED" && <DiagnosticReportSharePanel diagnosticId={selected.id} reviewState={selected.reviewState} workOrder={selected.workOrder} />}
          <div className={styles.actions}>{selected.status === "PENDING" && <><button className={styles.primary} disabled={saving} onClick={() => void transition("IN_PROGRESS")}>Почати стару діагностику</button><button className={styles.secondary} disabled={saving} onClick={() => void transition("CANCELLED")}>Скасувати</button></>}{selected.status === "IN_PROGRESS" && <><button className={styles.primary} disabled={saving || !conclusion.trim()} onClick={() => void transition("CONFIRMED")}>{saving ? "Зберігаю…" : "Підтвердити стару діагностику"}</button><button className={styles.secondary} disabled={saving} onClick={() => void transition("CANCELLED")}>Скасувати</button></>}{selected.status === "CONFIRMED" && <span className={styles.lockNote}>✓ Діагностику зафіксовано. Для нового циклу потрібна нова заявка на діагностику.</span>}{selected.status === "CANCELLED" && <span className={styles.lockNote}>Діагностику скасовано. Історія збережена.</span>}</div>
        </>}
      </> : readCrmRoute().vehicleId ? <div className={styles.empty}>
        <h2>Діагностична карта для автомобіля</h2>
        <p>Для цього автомобіля ще немає створеної діагностики. Карта зʼявиться після прибуття автомобіля на діагностику та призначення механіка.</p>
        <button className={styles.secondary} type="button" onClick={() => navigateCrm("Авто", { vehicleId: readCrmRoute().vehicleId })}>← Повернутися до картки авто</button>
      </div> : <div className={styles.empty}>Оберіть діагностику зі списку.</div>}</aside>
    </div>
  </div>;
}
