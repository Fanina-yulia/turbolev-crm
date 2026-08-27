"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  WorkOrderDetailContract,
  WorkOrderListItemContract,
  WorkOrderTransitionContract,
} from "@/src/lib/contracts/crm-core";
import {
  parseWorkOrderDetailPayload,
  parseWorkOrderListPayload,
  parseWorkOrderNumbersPayload,
  parseWorkOrderTransitionFailurePayload,
  parseWorkOrderTransitionPayload,
  payloadMessage,
} from "@/src/lib/contracts/work-order-payload.parsers";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { navigateCrm, readCrmRoute, type CrmRouteParams } from "./crm-route";
import { WorkOrderCommercialPanel, type WorkOrderCommercialSummary, type WorkOrderCommercialView } from "./work-order-commercial-panel";
import { VehiclePlate } from "./vehicle-plate";
import styles from "./work-orders.module.css";

type WorkOrderRow = WorkOrderListItemContract;
type WorkOrderDetail = WorkOrderDetailContract;
type Transition = WorkOrderTransitionContract;

type WorkOrderTab = "overview" | "diagnostic" | "works" | "parts" | "estimate" | "qc" | "payment" | "history";

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

const WORK_ORDER_TABS: Array<[WorkOrderTab, string]> = [
  ["overview", "Огляд"],
  ["diagnostic", "Діагностика"],
  ["works", "Роботи"],
  ["parts", "Запчастини"],
  ["estimate", "Кошторис"],
  ["qc", "QC"],
  ["payment", "Оплата"],
  ["history", "Історія"],
];

const FILTER_CODES = new Set<string>(FILTERS.map(([code]) => code));
const TAB_CODES = new Set<string>(WORK_ORDER_TABS.map(([code]) => code));

function vehicleName(item: WorkOrderRow | WorkOrderDetail) {
  return [item.vehicle.brand, item.vehicle.model, item.vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}

function transitionReason(item: Transition) {
  if (item.missingGates.length) return item.missingGates.map((gate) => gate.label).join(" · ");
  if (item.unsupportedActions.length) return `Потрібна дія: ${item.unsupportedActions.map((action) => action.label).join(", ")}`;
  if (!item.allowed) return "Перехід поки недоступний.";
  if (item.actions.length) return item.actions.map((action) => action.label).join(" · ");
  return "Умови переходу виконані.";
}

function transitionActionLabel(item: Transition) {
  if (!item.allowed) return "Заблоковано";
  if (item.to === "CLOSED") return "Видати авто та закрити КП";
  return "Перевести";
}

function normalize(value: string | null | undefined) {
  return (value || "").trim().toUpperCase().replace(/\s/g, "");
}

function matchesRoute(row: WorkOrderRow, route: CrmRouteParams) {
  if (route.scope === "qc" && !["WAITING_QC", "READY_FOR_PICKUP"].includes(row.status)) return false;
  if (route.workOrderId && row.id !== route.workOrderId) return false;
  if (route.vehicleId && row.vehicle.id !== route.vehicleId) return false;
  if (route.clientId && row.client.id !== route.clientId) return false;
  if (route.plate && normalize(row.vehicle.plateNumber) !== normalize(route.plate)) return false;
  if (route.vin && normalize(row.vehicle.vin) !== normalize(route.vin)) return false;
  return true;
}

function statusFromRoute(route: CrmRouteParams) {
  return route.status && FILTER_CODES.has(route.status) ? route.status : "ALL";
}

function tabFromRoute(route: CrmRouteParams): WorkOrderTab {
  if (route.workOrderTab && TAB_CODES.has(route.workOrderTab)) return route.workOrderTab as WorkOrderTab;
  if (route.scope === "qc") return "qc";
  return "overview";
}

function matchesSearch(row: WorkOrderRow, query: string) {
  const q = query.trim().toLocaleLowerCase("uk-UA");
  if (!q) return true;
  return [
    formatWorkOrderNumber(row.number),
    String(row.number || ""),
    row.client.name,
    row.client.phone,
    row.vehicle.plateNumber,
    row.vehicle.vin,
    vehicleName(row),
  ].filter(Boolean).join(" ").toLocaleLowerCase("uk-UA").includes(q);
}

export function WorkOrders() {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [route, setRoute] = useState<CrmRouteParams>({});
  const [activeTab, setActiveTab] = useState<WorkOrderTab>("overview");
  const [commercialSummary, setCommercialSummary] = useState<WorkOrderCommercialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyTransition, setBusyTransition] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const applyRoute = useCallback((nextRows: WorkOrderRow[]) => {
    const nextRoute = readCrmRoute();
    const nextFilter = statusFromRoute(nextRoute);
    setRoute(nextRoute);
    setFilter(nextFilter);
    setActiveTab(tabFromRoute(nextRoute));
    const matchingRows = nextRows.filter((row) => (nextFilter === "ALL" || row.status === nextFilter) && matchesRoute(row, nextRoute));
    setSelectedId((current) => {
      if (nextRoute.workOrderId) return matchingRows.find((row) => row.id === nextRoute.workOrderId)?.id ?? null;
      if (current && matchingRows.some((row) => row.id === current)) return current;
      return matchingRows[0]?.id ?? null;
    });
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/work-orders", { cache: "no-store" });
      const rawPayload: unknown = await response.json();
      const payload = parseWorkOrderListPayload(rawPayload);
      if (!response.ok || !payload) throw new Error(payloadMessage(rawPayload, "Не вдалося завантажити комерційні пропозиції."));
      const rawRows = payload.workOrders;
      let numberMap = new Map<string, number>();
      if (rawRows.length) {
        const numberResponse = await fetch(`/api/work-orders/numbers?ids=${encodeURIComponent(rawRows.map((row) => row.id).join(","))}`, { cache: "no-store" });
        const rawNumberPayload: unknown = await numberResponse.json();
        const numberPayload = parseWorkOrderNumbersPayload(rawNumberPayload);
        if (numberResponse.ok && numberPayload) {
          numberMap = new Map(numberPayload.rows.map((item) => [item.workOrderId, item.number]));
        }
      }
      const nextRows: WorkOrderRow[] = rawRows.map((row) => ({ ...row, number: numberMap.get(row.id) ?? null }));
      setRows(nextRows);
      applyRoute(nextRows);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Помилка завантаження." });
    } finally {
      setLoading(false);
    }
  }, [applyRoute]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/work-orders/${encodeURIComponent(id)}`, { cache: "no-store" });
      const rawPayload: unknown = await response.json();
      const workOrder = parseWorkOrderDetailPayload(rawPayload);
      if (!response.ok || !workOrder) throw new Error(payloadMessage(rawPayload, "Не вдалося завантажити комерційну пропозицію."));
      setDetail(workOrder);
    } catch (error) {
      setDetail(null);
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Помилка завантаження картки." });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadRows(); }, [loadRows]);
  useEffect(() => {
    setCommercialSummary(null);
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);
  useEffect(() => {
    const sync = () => applyRoute(rows);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [rows, applyRoute]);

  const filtered = useMemo(() => rows.filter((row) => (filter === "ALL" || row.status === filter) && matchesRoute(row, route) && matchesSearch(row, search)), [rows, filter, route, search]);
  const selectedNumber = useMemo(() => rows.find((row) => row.id === selectedId)?.number ?? null, [rows, selectedId]);
  const counts = useMemo(() => ({
    active: rows.filter((row) => !["CLOSED", "CANCELLED"].includes(row.status)).length,
    repair: rows.filter((row) => row.status === "IN_REPAIR").length,
    blocked: rows.filter((row) => row.transitions.some((transition) => !transition.allowed && (transition.missingGates.length || transition.unsupportedActions.length))).length,
    ready: rows.filter((row) => row.status === "READY_FOR_PICKUP").length,
  }), [rows]);

  function routeForWorkOrder(workOrderId: string, tab: WorkOrderTab = activeTab): CrmRouteParams {
    const params: CrmRouteParams = { workOrderId, workOrderTab: tab };
    if (filter !== "ALL") params.status = filter;
    if (route.clientId) params.clientId = route.clientId;
    if (route.vehicleId) params.vehicleId = route.vehicleId;
    if (route.plate) params.plate = route.plate;
    if (route.vin) params.vin = route.vin;
    if (route.scope) params.scope = route.scope;
    return params;
  }

  function chooseFilter(code: string) {
    navigateCrm("Комерційна пропозиція", code === "ALL" ? {} : { status: code });
  }

  function chooseWorkOrder(item: WorkOrderRow) {
    navigateCrm("Комерційна пропозиція", routeForWorkOrder(item.id));
  }

  function chooseTab(tab: WorkOrderTab) {
    if (!detail) return;
    navigateCrm("Комерційна пропозиція", routeForWorkOrder(detail.id, tab));
  }

  function openDocuments() {
    if (!detail) return;
    window.open(`/work-order-documents/${encodeURIComponent(detail.id)}`, "_blank", "noopener,noreferrer");
  }

  const handleCommercialChanged = useCallback(() => {
    if (selectedId) void loadDetail(selectedId);
    void loadRows();
  }, [selectedId, loadDetail, loadRows]);

  const handleCommercialSummary = useCallback((summary: WorkOrderCommercialSummary) => {
    setCommercialSummary(summary);
  }, []);

  async function runTransition(transition: Transition) {
    if (!detail || !transition.allowed || busyTransition) return;
    if (transition.to === "CLOSED" && !window.confirm("Підтвердити видачу авто клієнту та закриття комерційної пропозиції?")) return;
    setBusyTransition(transition.to);
    setMessage(null);
    try {
      const response = await fetch(`/api/work-orders/${encodeURIComponent(detail.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: transition.to, actorName: "CRM / WorkOrder Center" }),
      });
      const rawPayload: unknown = await response.json();
      if (!response.ok) {
        const failure = parseWorkOrderTransitionFailurePayload(rawPayload);
        const errorText = failure?.error || payloadMessage(rawPayload, "Перехід не виконано.");
        throw new Error(failure?.missingGates.length ? `${errorText} ${failure.missingGates.join(", ")}` : errorText);
      }
      const workOrder = parseWorkOrderTransitionPayload(rawPayload);
      if (!workOrder) throw new Error(payloadMessage(rawPayload, "Перехід не виконано."));
      setMessage({ kind: "success", text: transition.to === "CLOSED" ? "Авто видано клієнту. Комерційну пропозицію закрито." : `Статус змінено: ${workOrder.statusLabel}.` });
      await Promise.all([loadRows(), loadDetail(detail.id)]);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Не вдалося змінити статус." });
    } finally {
      setBusyTransition(null);
    }
  }

  const commercialView = (["overview", "works", "parts", "estimate", "qc", "payment"] as WorkOrderTab[]).includes(activeTab) ? activeTab as WorkOrderCommercialView : null;

  return <div className={styles.page}>
    <header className={styles.head}>
      <div>
        <p className={styles.eyebrow}>СЕРВІС · ЗАМОВЛЕННЯ-НАРЯДИ</p>
        <h1>Комерційна пропозиція</h1>
        <p>Одна комерційна пропозиція веде автомобіль від підтвердженої діагностики до ремонту, контролю якості та оплати. Усі дії зібрані в одній картці без дублювання даних.</p>
      </div>
      <button className={styles.refresh} type="button" onClick={() => void loadRows()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
    </header>

    <section className={styles.kpis}>
      <div><span>Активні комерційні пропозиції</span><strong>{counts.active}</strong></div>
      <div><span>У ремонті</span><strong>{counts.repair}</strong></div>
      <div><span>Є блокуючі умови</span><strong>{counts.blocked}</strong></div>
      <div><span>Готові до видачі</span><strong>{counts.ready}</strong></div>
    </section>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) auto", gap: 10, alignItems: "center", marginBottom: 12 }}>
      <label style={{ display: "grid", gridTemplateColumns: "24px 1fr auto", alignItems: "center", gap: 7, minHeight: 42, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)" }}>
        <span style={{ color: "var(--muted)" }}>⌕</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="КП-000124, клієнт, телефон, номер авто або VIN..." style={{ border: 0, outline: 0, minWidth: 0, background: "transparent", color: "var(--text)" }}/>
        {search && <button type="button" onClick={() => setSearch("")} aria-label="Очистити пошук" style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 18 }}>×</button>}
      </label>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>{filtered.length} з {rows.length}</span>
    </div>

    <nav className={styles.filters}>
      {FILTERS.map(([code, label]) => {
        const count = code === "ALL" ? rows.length : rows.filter((row) => row.status === code).length;
        return <button type="button" className={filter === code ? styles.activeFilter : ""} key={code} onClick={() => chooseFilter(code)}>{label}<b>{count}</b></button>;
      })}
    </nav>

    {message && <div className={`${styles.notice} ${message.kind === "error" ? styles.error : styles.success}`}>{message.text}</div>}

    <div className={styles.layout}>
      <section className={styles.list}>
        {loading && !rows.length ? <div className={styles.empty}>Завантажую комерційні пропозиції…</div> : !filtered.length ? <div className={styles.empty}>За вибраним статусом або пошуком комерційних пропозицій немає.</div> : filtered.map((item) => <button type="button" key={item.id} className={`${styles.row} ${selectedId === item.id ? styles.rowActive : ""}`} onClick={() => chooseWorkOrder(item)}>
          <div>
            <div className={styles.rowTitle}><span style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontWeight: 850, fontSize: 12, color: "var(--orange)" }}>{formatWorkOrderNumber(item.number)}</span><strong>{vehicleName(item)}</strong>{item.vehicle.plateNumber && <VehiclePlate value={item.vehicle.plateNumber} size="xs" />}</div>
            <div className={styles.rowMeta}>{item.client.name || "Клієнт без імені"} · {item.client.phone}<br/>Оновлено {formatDate(item.updatedAt)}</div>
          </div>
          <span className={styles.status}>{item.statusLabel}</span>
        </button>)}
      </section>

      <aside className={styles.detail}>
        {detailLoading && !detail ? <div className={styles.empty}>Завантажую картку…</div> : !detail ? <div className={styles.empty}>Оберіть комерційну пропозицію зі списку.</div> : <>
          <div className={styles.detailSticky}>
            <div className={styles.summaryTop}>
              <div className={styles.summaryIdentity}>
                <div className={styles.summaryPlate}><VehiclePlate value={detail.vehicle.plateNumber} size="md" /></div>
                <div><small>{formatWorkOrderNumber(selectedNumber)}</small><h2>{vehicleName(detail)}</h2><button type="button" onClick={() => navigateCrm("Клієнти", { clientId: detail.client.id })}>{detail.client.name || detail.client.phone}</button></div>
              </div>
              <div className={styles.summaryStatus}>
                <span className={styles.status}>{detail.statusLabel}</span>
                <small>{detail.appointment ? `${detail.appointment.post?.name || "Без поста"} · ${detail.appointment.mechanic?.name || "Без механіка"}` : "Пост / механік не призначені"}</small>
                <button type="button" onClick={openDocuments} style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: 8, background: "var(--panel)", color: "var(--text)", padding: "7px 10px", fontSize: 12, fontWeight: 750, cursor: "pointer" }}>Документи / друк</button>
              </div>
            </div>
            <div className={styles.summaryMoney}>
              <span><small>Кошторис</small><b>{commercialSummary ? money(commercialSummary.estimateTotal) : "…"}</b></span>
              <span><small>Оплачено</small><b>{commercialSummary ? money(commercialSummary.paid) : "…"}</b></span>
              <span><small>Борг</small><b className={commercialSummary?.outstanding ? styles.debt : ""}>{commercialSummary ? money(commercialSummary.outstanding) : "…"}</b></span>
            </div>
            <nav className={styles.tabs} aria-label="Розділи комерційної пропозиції">
              {WORK_ORDER_TABS.map(([code, label]) => <button type="button" key={code} className={activeTab === code ? styles.activeTab : ""} onClick={() => chooseTab(code)}>{label}</button>)}
            </nav>
          </div>

          <div className={styles.detailBody}>
            {activeTab === "overview" && <div className={styles.tabContent}>
              <div className={styles.grid}>
                <div className={styles.field}><span>Номер КП</span><strong>{formatWorkOrderNumber(selectedNumber)}</strong></div>
                <div className={styles.field}><span>Клієнт</span><button type="button" onClick={() => navigateCrm("Клієнти", { clientId: detail.client.id })}><strong>{detail.client.name || detail.client.phone}</strong></button></div>
                <div className={styles.field}><span>Автомобіль</span><button type="button" onClick={() => navigateCrm("Авто", { vehicleId: detail.vehicle.id })}><strong>{vehicleName(detail)}</strong></button></div>
                <div className={styles.field}><span>Держномер</span><VehiclePlate value={detail.vehicle.plateNumber} size="sm" /></div>
                <div className={styles.field}><span>VIN</span><strong>{detail.vehicle.vin || "—"}</strong></div>
                <div className={styles.field}><span>Пробіг</span><strong>{detail.vehicle.mileageKm ? `${detail.vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}</strong></div>
                <div className={styles.field}><span>Планувальник</span><strong>{detail.appointment ? `${formatDate(detail.appointment.plannedStartAt)} · ${detail.appointment.post?.name || "Без поста"}` : "Не зв'язано"}</strong></div>
              </div>
              {commercialView && <section className={styles.sectionCard}><h3>Стан комерційної пропозиції</h3><WorkOrderCommercialPanel key={detail.id} workOrderId={detail.id} view="overview" onChanged={handleCommercialChanged} onSummary={handleCommercialSummary}/></section>}
              <section className={styles.sectionCard}>
                <h3>Наступний крок</h3>
                {!detail.transitions.length ? <div className={styles.emptyInline}>Комерційна пропозиція завершена — наступних переходів немає.</div> : <div className={styles.transitions}>{detail.transitions.map((transition) => <div className={styles.transition} key={transition.to}><div><strong>→ {transition.label}</strong><small>{transitionReason(transition)}</small></div><button type="button" disabled={!transition.allowed || Boolean(busyTransition)} onClick={() => void runTransition(transition)}>{busyTransition === transition.to ? (transition.to === "CLOSED" ? "Закриваю…" : "Змінюю…") : transitionActionLabel(transition)}</button></div>)}</div>}
              </section>
            </div>}

            {activeTab === "diagnostic" && <div className={styles.tabContent}>
              <section className={styles.sectionCard}><div className={styles.sectionHead}><div><h3>Технічний висновок</h3><p>Результат підтвердженої діагностики, з якої створено цю комерційну пропозицію.</p></div><span>{detail.diagnosticRequest.status}</span></div><div className={styles.conclusion}>{detail.diagnosticRequest.technicalConclusion || "Технічний висновок відсутній."}</div></section>
              <div className={styles.grid}>
                <div className={styles.field}><span>Підтверджено</span><strong>{formatDate(detail.diagnosticRequest.confirmedAt)}</strong></div>
                <div className={styles.field}><span>Створено діагностику</span><strong>{formatDate(detail.diagnosticRequest.createdAt)}</strong></div>
                <div className={styles.field}><span>Пробіг</span><strong>{detail.vehicle.mileageKm ? `${detail.vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}</strong></div>
                <div className={styles.field}><span>Клас Turbo LEV</span><strong>{detail.vehicle.turboLevClass || "—"}</strong></div>
              </div>
            </div>}

            {commercialView && activeTab !== "overview" && <div className={styles.tabContent}><WorkOrderCommercialPanel key={detail.id} workOrderId={detail.id} view={commercialView} onChanged={handleCommercialChanged} onSummary={handleCommercialSummary}/></div>}

            {activeTab === "history" && <div className={styles.tabContent}>
              <section className={styles.sectionCard}><h3>Контрольні дати</h3><div className={styles.timeline}>
                <div><span>Номер КП</span><strong>{formatWorkOrderNumber(selectedNumber)}</strong></div>
                <div><span>Пропозицію створено</span><strong>{formatDate(detail.createdAt)}</strong></div>
                <div><span>Остання зміна</span><strong>{formatDate(detail.updatedAt)}</strong></div>
                <div><span>Діагностику підтверджено</span><strong>{formatDate(detail.diagnosticRequest.confirmedAt)}</strong></div>
                <div><span>Запис на СТО</span><strong>{formatDate(detail.appointment?.plannedStartAt)}</strong></div>
                <div><span>Фактичний приїзд</span><strong>{formatDate(detail.appointment?.actualArrivalAt)}</strong></div>
                <div><span>Пропозицію закрито</span><strong>{formatDate(detail.closedAt)}</strong></div>
              </div></section>
              <section className={styles.sectionCard}><h3>Останні дзвінки клієнта</h3>{!detail.recentCalls.length ? <div className={styles.emptyInline}>Пов'язаних дзвінків поки немає.</div> : <div className={styles.calls}>{detail.recentCalls.map((call) => <div className={styles.call} key={call.id}><span>{call.type === "INCOMING" ? "Вхідний" : "Вихідний"} · {call.status || "—"}</span><span>{formatDate(call.startedAt)} · {call.duration} c</span></div>)}</div>}</section>
              <div className={styles.internalId}>Внутрішній ID: {detail.id}</div>
            </div>}
          </div>
        </>}
      </aside>
    </div>
  </div>;
}
