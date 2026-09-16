"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./work-order-commercial-panel.module.css";

type Line = {
  id: string;
  type: string;
  status: string;
  description: string;
  article: string | null;
  brand: string | null;
  currency: string;
  plannedQuantity: string;
  plannedUnitPrice: string;
  plannedUnitCost: string;
  plannedDiscount: string;
  requiredForRepair: boolean;
  mechanicId: string | null;
  supplierId: string | null;
  supplierQuoteId: string | null;
};
type Estimate = { id: string; revision: number; status: string; currency: string; subtotal: string; discountAmount: string; totalAmount: string; sentAt: string | null; approvedAt: string | null; approvedByName: string | null };
type PartItem = { id: string; workOrderLineId: string; description: string; article: string | null; brand: string | null; quantity: string; receivedQuantity: string; installedQuantity: string; currency: string; requiredForRepair: boolean; etaAt: string | null };
type PartsRequest = { id: string; status: string; paymentRequired: boolean; paymentConfirmedAt: string | null; items: PartItem[] };
type DirectRepairMode = "SERVICE_SUPPLIED" | "CUSTOMER_SUPPLIED" | "MIXED" | "NO_PARTS";
type PartSupplySource = "SERVICE" | "CUSTOMER";
type DirectRepairState = {
  isDirectRepair: boolean;
  partsMode: DirectRepairMode | null;
  modeSelected: boolean;
  configurationComplete: boolean;
  blockers: string[];
  partSupplySources: Record<string, PartSupplySource | null>;
  customerPartConfirmedLineIds: string[];
  customerPartPendingLineIds: string[];
  servicePartCount: number;
  customerPartCount: number;
  legacy: boolean;
};
type Commercial = {
  lines: Line[];
  estimate: Estimate | null;
  partsRequest: PartsRequest | null;
  estimateIsCurrent: boolean;
  estimateApproved: boolean;
  requiredPartsCount: number;
  servicePartsCount?: number;
  customerPartsCount?: number;
  partsReady: boolean;
  mechanicAssigned: boolean;
  partsPaymentSatisfied: boolean;
  directRepair?: DirectRepairState;
};
type QcAttempt = { id: string; attempt: number; status: string; performedByName: string | null; resultNote: string | null; startedAt: string | null; completedAt: string | null };
type QualityControl = { latest: QcAttempt | null; attempts: QcAttempt[]; passed: boolean; failed: boolean; active: boolean };
type Finance = { summary: { receivable: string | null; paid: string; outstanding: string; fullyPaid: boolean; actualFinalized: boolean } };
type Account = { id: string; name: string; type: string; currency: string; isActive: boolean };
type WorkPrice = { id: string; code: string | null; name: string; unit: string; adjustedPrice: number; basePrice: number; coefficient: number; normHours: number | null };
type SupplierQuote = { id: string; article: string; brand: string | null; name: string | null; purchasePrice: string | null; currency: string | null; fetchedAt: string; supplier: { id: string; name: string; code: string; defaultMarkupPercent: string } };
type WorkOrderInfo = { origin?: string; status: string; vehicle: { brand: string | null; model: string | null; year: number | null } };

export type WorkOrderCommercialView = "overview" | "works" | "parts" | "estimate" | "qc" | "payment";
export type WorkOrderCommercialSummary = {
  estimateTotal: number | null;
  paid: number;
  outstanding: number;
  fullyPaid: boolean;
  actualFinalized: boolean;
  estimateApproved: boolean;
  partsReady: boolean;
  mechanicAssigned: boolean;
  qcPassed: boolean;
  lineCount: number;
  workCount: number;
  partCount: number;
  partsRequestStatus: string | null;
  qcStatus: string | null;
};

const DIRECT_REPAIR_MODES: Array<{ value: DirectRepairMode; title: string; description: string }> = [
  { value: "SERVICE_SUPPLIED", title: "Підбирає СТО", description: "СТО підбирає, закуповує та продає потрібні запчастини." },
  { value: "CUSTOMER_SUPPLIED", title: "Запчастини клієнта", description: "Клієнт привозить деталі. У КП вони мають 0 грн." },
  { value: "MIXED", title: "Змішаний варіант", description: "Частину деталей постачає СТО, частину — клієнт." },
  { value: "NO_PARTS", title: "Запчастини не потрібні", description: "КП складається лише з робіт, матеріалів і послуг." },
];

function money(value: string | number | null | undefined, currency = "UAH") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}
function num(value: string | number | null | undefined) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}
function date(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}
function nextLineStatus(status: string) {
  return status === "DRAFT" ? "APPROVED" : status === "APPROVED" ? "IN_PROGRESS" : status === "IN_PROGRESS" ? "COMPLETED" : null;
}
function lineAction(status: string) {
  return status === "DRAFT" ? "Погодити" : status === "APPROVED" ? "В роботу" : status === "IN_PROGRESS" ? "Виконано" : null;
}
function modeLabel(mode: DirectRepairMode | null | undefined) {
  return DIRECT_REPAIR_MODES.find((item) => item.value === mode)?.title || "Не обрано";
}

export function WorkOrderCommercialPanel({ workOrderId, view = "overview", onChanged, onSummary }: {
  workOrderId: string;
  view?: WorkOrderCommercialView;
  onChanged?: () => void;
  onSummary?: (summary: WorkOrderCommercialSummary) => void;
}) {
  const [data, setData] = useState<Commercial | null>(null);
  const [qc, setQc] = useState<QualityControl | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [workOrder, setWorkOrder] = useState<WorkOrderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [approvalName, setApprovalName] = useState("");
  const [draft, setDraft] = useState({ type: "LABOR", description: "", quantity: "1", price: "", cost: "", article: "" });
  const [customerPart, setCustomerPart] = useState({ description: "", brand: "", article: "", quantity: "1" });
  const [workQuery, setWorkQuery] = useState("");
  const [workResults, setWorkResults] = useState<WorkPrice[]>([]);
  const [quoteQuery, setQuoteQuery] = useState("");
  const [quoteResults, setQuoteResults] = useState<SupplierQuote[]>([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [qcPerson, setQcPerson] = useState("");
  const [qcNote, setQcNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const urls = [
        `/api/work-orders/${encodeURIComponent(workOrderId)}/estimate`,
        `/api/work-orders/${encodeURIComponent(workOrderId)}/qc`,
        `/api/work-orders/${encodeURIComponent(workOrderId)}/finance`,
        "/api/finance/accounts",
        `/api/work-orders/${encodeURIComponent(workOrderId)}`,
      ];
      const responses = await Promise.all(urls.map((url) => fetch(url, { cache: "no-store" })));
      const payloads = await Promise.all(responses.map((response) => response.json()));
      const firstError = responses.findIndex((response, index) => !response.ok || !payloads[index]?.ok);
      if (firstError >= 0) throw new Error(payloads[firstError]?.error || "Не вдалося завантажити дані комерційної пропозиції.");
      setData(payloads[0].commercial);
      setQc(payloads[1].qualityControl);
      setFinance(payloads[2]);
      const activeAccounts = (payloads[3].accounts || []).filter((account: Account) => account.isActive);
      setAccounts(activeAccounts);
      setAccountId((current) => current && activeAccounts.some((account: Account) => account.id === current) ? current : activeAccounts[0]?.id || "");
      setWorkOrder(payloads[4].workOrder);
      const outstanding = payloads[2]?.summary?.outstanding;
      setPaymentAmount((current) => current || (Number(outstanding) > 0 ? String(outstanding) : ""));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Помилка завантаження.");
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (view === "parts" && draft.type !== "PART") setDraft((current) => ({ ...current, type: "PART" }));
    if (view === "works" && draft.type === "PART") setDraft((current) => ({ ...current, type: "LABOR" }));
  }, [view, draft.type]);

  const workLines = useMemo(() => data?.lines.filter((line) => line.type !== "PART") || [], [data?.lines]);
  const partLines = useMemo(() => data?.lines.filter((line) => line.type === "PART") || [], [data?.lines]);
  const outstanding = Number(finance?.summary?.outstanding || 0);
  const direct = data?.directRepair?.isDirectRepair ? data.directRepair : null;
  const directMode = direct?.partsMode ?? null;
  const canUseServiceParts = !direct || directMode === "SERVICE_SUPPLIED" || directMode === "MIXED";
  const canUseCustomerParts = Boolean(direct && (directMode === "CUSTOMER_SUPPLIED" || directMode === "MIXED"));
  const noPartsMode = Boolean(direct && directMode === "NO_PARTS");
  const directSetupReady = !direct || direct.configurationComplete;
  const estimateCanSend = data ? data.lines.length > 0 && !data.estimateApproved && directSetupReady : false;
  const canMarkReady = Boolean(
    direct
      && data?.estimateApproved
      && data?.estimateIsCurrent
      && data?.partsReady
      && data?.mechanicAssigned
      && workOrder
      && !["READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "REWORK", "WAITING_PAYMENT", "READY_FOR_PICKUP", "CLOSED", "CANCELLED"].includes(workOrder.status),
  );

  useEffect(() => {
    if (!data || !finance) return;
    onSummary?.({
      estimateTotal: data.estimate ? num(data.estimate.totalAmount) : null,
      paid: num(finance.summary.paid),
      outstanding: num(finance.summary.outstanding),
      fullyPaid: finance.summary.fullyPaid,
      actualFinalized: finance.summary.actualFinalized,
      estimateApproved: data.estimateApproved,
      partsReady: data.partsReady,
      mechanicAssigned: data.mechanicAssigned,
      qcPassed: Boolean(qc?.passed),
      lineCount: data.lines.length,
      workCount: workLines.length,
      partCount: partLines.length,
      partsRequestStatus: data.partsRequest?.status || null,
      qcStatus: qc?.latest?.status || null,
    });
  }, [data, finance, qc, workLines.length, partLines.length, onSummary]);

  async function act(key: string, url: string, method = "POST", body: Record<string, unknown> = {}) {
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Дію не виконано.");
      await load();
      onChanged?.();
      return payload;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Дію не виконано.");
      return null;
    } finally {
      setBusy("");
    }
  }

  function directAct(key: string, body: Record<string, unknown>) {
    return act(key, `/api/work-orders/${encodeURIComponent(workOrderId)}/direct-repair`, "PATCH", body);
  }

  async function addLine() {
    if (!draft.description.trim()) return;
    const result = await act("line", `/api/work-orders/${encodeURIComponent(workOrderId)}/lines`, "POST", {
      type: draft.type,
      description: draft.description,
      plannedQuantity: draft.quantity || "1",
      plannedUnitPrice: draft.price || "0",
      plannedUnitCost: draft.cost || "0",
      article: draft.article || undefined,
      actorName: "CRM / WorkOrder Center",
    });
    if (result?.line?.id && direct && draft.type === "PART" && directMode === "MIXED") {
      await directAct(`source:${result.line.id}`, { action: "SET_PART_SOURCE", lineId: result.line.id, source: "SERVICE" });
    }
    if (result) setDraft({ type: view === "parts" ? "PART" : "LABOR", description: "", quantity: "1", price: "", cost: "", article: "" });
  }

  async function addSupplierQuote(quote: SupplierQuote) {
    const result = await act(`quote:${quote.id}`, `/api/work-orders/${encodeURIComponent(workOrderId)}/lines`, "POST", { supplierQuoteId: quote.id, actorName: "CRM / WorkOrder Center" });
    if (result?.line?.id && direct && directMode === "MIXED") {
      await directAct(`source:${result.line.id}`, { action: "SET_PART_SOURCE", lineId: result.line.id, source: "SERVICE" });
    }
  }

  async function addCustomerPart() {
    if (!customerPart.description.trim()) return;
    const result = await directAct("customer-part", {
      action: "ADD_CUSTOMER_PART",
      description: customerPart.description,
      brand: customerPart.brand || undefined,
      article: customerPart.article || undefined,
      quantity: customerPart.quantity || "1",
    });
    if (result) setCustomerPart({ description: "", brand: "", article: "", quantity: "1" });
  }

  async function searchWorks() {
    if (workQuery.trim().length < 2) return setWorkResults([]);
    setBusy("work-search");
    try {
      const params = new URLSearchParams({ q: workQuery.trim() });
      if (workOrder?.vehicle.brand) params.set("make", workOrder.vehicle.brand);
      if (workOrder?.vehicle.model) params.set("model", workOrder.vehicle.model);
      if (workOrder?.vehicle.year) params.set("year", String(workOrder.vehicle.year));
      const response = await fetch(`/api/work-prices?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося знайти роботу.");
      setWorkResults(payload.items || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Помилка пошуку.");
    } finally {
      setBusy("");
    }
  }

  async function searchQuotes() {
    if (quoteQuery.trim().length < 2) return setQuoteResults([]);
    setBusy("quote-search");
    try {
      const response = await fetch(`/api/supplier-quotes?q=${encodeURIComponent(quoteQuery.trim())}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося знайти деталь.");
      setQuoteResults(payload.items || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Помилка пошуку.");
    } finally {
      setBusy("");
    }
  }

  async function decide(decision: "APPROVE" | "REJECT") {
    await act(decision, `/api/work-orders/${encodeURIComponent(workOrderId)}/estimate/decision`, "POST", { decision, approvedByName: approvalName || undefined, source: "CRM", actorName: "CRM / WorkOrder Center" });
  }
  async function receive(item: PartItem) {
    await act(`receive:${item.id}`, `/api/parts-requests/${encodeURIComponent(data!.partsRequest!.id)}/items/${encodeURIComponent(item.id)}`, "PATCH", { receivedQuantity: item.quantity, actorName: "CRM / Склад" });
  }
  async function install(item: PartItem) {
    await act(`install:${item.id}`, `/api/parts-requests/${encodeURIComponent(data!.partsRequest!.id)}/items/${encodeURIComponent(item.id)}`, "PATCH", { receivedQuantity: item.quantity, installedQuantity: item.quantity, actorName: "CRM / Автомеханік" });
  }
  async function advanceParts(status: string) {
    if (!data?.partsRequest) return;
    await act(`parts:${status}`, `/api/parts-requests/${encodeURIComponent(data.partsRequest.id)}`, "PATCH", { status, actorName: "CRM / Підбір запчастин" });
  }
  async function updateLine(line: Line, status: string) {
    await act(`line:${line.id}`, `/api/work-orders/${encodeURIComponent(workOrderId)}/lines/${encodeURIComponent(line.id)}`, "PATCH", { status, actorName: "CRM / WorkOrder Center" });
  }
  async function runQc(action: string) {
    const result = await act(`qc:${action}`, `/api/work-orders/${encodeURIComponent(workOrderId)}/qc`, "POST", { action, performedByName: qcPerson || undefined, note: qcNote || undefined, actorName: "CRM / Контроль якості" });
    if (!result) return;
    const warnings = [result.transitionWarning?.message, result.issueSyncWarning].filter(Boolean).join(" ");
    if (warnings) setMessage(warnings);
    else if (action === "PASS") setMessage("Контроль якості пройдено. Комерційну пропозицію переведено у «Готовий до видачі».");
    else if (action === "FAIL") setMessage("QC не пройдено. Комерційну пропозицію переведено у «Доопрацювання».");
  }
  async function pay() {
    if (!accountId || !(Number(paymentAmount) > 0)) return;
    const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replaceAll("-", "").slice(0, 64) : `${Date.now()}-${Math.random()}`.slice(0, 64);
    const result = await act("payment", `/api/work-orders/${encodeURIComponent(workOrderId)}/payments`, "POST", { amount: paymentAmount, moneyAccountId: accountId, idempotencyKey: key, actorName: "CRM / Каса" });
    if (!result) return;
    setPaymentAmount("");
    if (result.transitionWarning?.message) setMessage(result.transitionWarning.message);
    else if (result.workOrder?.status === "READY_FOR_PICKUP") setMessage("Оплату проведено. КП у статусі «Готовий до видачі».");
    else setMessage("Оплату проведено.");
  }

  const nextParts = useMemo<[string, string] | null>(() => {
    const status = data?.partsRequest?.status;
    return status === "NEW" ? ["SELECTING", "Почати підбір"]
      : status === "SELECTING" ? ["SELECTED", "Підбір завершено"]
        : status === "SELECTED" ? ["APPROVED", "Погодити деталі"]
          : status === "APPROVED" ? ["ORDER_REQUIRED", "Потрібне замовлення"]
            : status === "ORDER_REQUIRED" ? ["ORDERED", "Замовлено"]
              : null;
  }, [data?.partsRequest?.status]);

  if (loading && !data) return <div className={styles.empty}>Завантажую дані комерційної пропозиції…</div>;
  if (!data) return <div className={styles.notice}>{message || "Дані комерційної пропозиції недоступні."}</div>;

  const directSetup = direct && !direct.legacy ? <section className={styles.directRepairBox}>
    <div className={styles.directHeader}>
      <div><span className={styles.directEyebrow}>ПРЯМИЙ РЕМОНТ · БЕЗ ДІАГНОСТИЧНОЇ КАРТИ</span><strong>Як забезпечуються запчастини?</strong><small>КП формується безпосередньо з робіт і вибраного джерела деталей.</small></div>
      <span className={direct.configurationComplete ? styles.readyPill : styles.pendingPill}>{direct.configurationComplete ? "Налаштовано" : "Потрібне рішення"}</span>
    </div>
    <div className={styles.modeGrid}>
      {DIRECT_REPAIR_MODES.map((item) => <button
        key={item.value}
        type="button"
        className={`${styles.modeCard} ${directMode === item.value ? styles.modeCardActive : ""}`}
        disabled={Boolean(busy)}
        onClick={() => void directAct(`mode:${item.value}`, { action: "SET_PARTS_MODE", mode: item.value })}
      ><b>{item.title}</b><span>{item.description}</span></button>)}
    </div>
    {!!direct.blockers.length && <div className={styles.blockers}>{direct.blockers.map((blocker) => <span key={blocker}>• {blocker}</span>)}</div>}
  </section> : null;

  return <div className={styles.panel}>
    {direct && (view === "overview" || view === "parts" || view === "estimate") && directSetup}

    {view === "overview" && <>
      <div className={styles.overviewCards}>
        <div className={styles.overviewCard}><span>Кошторис</span><strong>{data.estimate ? money(data.estimate.totalAmount, data.estimate.currency) : "Не сформовано"}</strong><small>{data.estimateApproved ? "Погоджено клієнтом" : data.estimate?.status || "Очікує формування"}</small></div>
        <div className={styles.overviewCard}><span>Роботи</span><strong>{workLines.length}</strong><small>{workLines.filter((line) => line.status === "COMPLETED").length} виконано</small></div>
        <div className={styles.overviewCard}><span>Запчастини</span><strong>{partLines.length}</strong><small>{direct ? modeLabel(directMode) : data.partsRequest?.status || (partLines.length ? "Заявку ще не відкрито" : "Немає позицій")}</small></div>
        <div className={styles.overviewCard}><span>Контроль якості</span><strong>{qc?.passed ? "Пройдено" : qc?.latest?.status || "Не розпочато"}</strong><small>{qc?.latest ? `Спроба №${qc.latest.attempt}` : "Очікує етапу QC"}</small></div>
        <div className={styles.overviewCard}><span>Оплата</span><strong>{finance?.summary?.actualFinalized ? money(finance.summary.paid, "UAH") : "Ще не фіналізовано"}</strong><small>{finance?.summary?.actualFinalized ? (finance.summary.fullyPaid ? "Оплачено повністю" : `Борг ${money(finance.summary.outstanding, "UAH")}`) : "Сума з’явиться після QC"}</small></div>
      </div>
      <div className={styles.gateGrid}>
        <div className={styles.gate}><span>КП погоджено</span><strong className={data.estimateApproved ? styles.ok : styles.bad}>{data.estimateApproved ? "ТАК" : "НІ"}</strong></div>
        <div className={styles.gate}><span>Обов'язкові деталі готові</span><strong className={data.partsReady ? styles.ok : styles.bad}>{data.partsReady ? "ТАК" : "НІ"}</strong></div>
        <div className={styles.gate}><span>Автомеханік призначений</span><strong className={data.mechanicAssigned ? styles.ok : styles.bad}>{data.mechanicAssigned ? "ТАК" : "НІ"}</strong></div>
        <div className={styles.gate}><span>QC пройдено</span><strong className={qc?.passed ? styles.ok : styles.bad}>{qc?.passed ? "ТАК" : "НІ"}</strong></div>
        <div className={styles.gate}><span>Баланс клієнта</span><strong className={finance?.summary?.actualFinalized && finance.summary.fullyPaid ? styles.ok : styles.bad}>{finance?.summary?.actualFinalized ? money(outstanding, "UAH") : "ще не фіналізовано"}</strong></div>
      </div>
    </>}

    {view === "works" && <div className={styles.block}>
      <div className={styles.blockTitle}><div><strong>Роботи та послуги</strong><small>{direct ? "Для прямого ремонту саме ці роботи є джерелом КП замість Діагностичної карти." : "Тільки роботи, матеріали та сторонні послуги. Деталі винесені в окрему вкладку."}</small></div><span className={styles.counter}>{workLines.length}</span></div>
      <div className={styles.lineList}>{workLines.map((line) => {
        const next = nextLineStatus(line.status);
        return <div className={styles.line} key={line.id}><div><strong>{line.description}</strong><small>{line.type} · {num(line.plannedQuantity)} × {money(line.plannedUnitPrice, line.currency)} · собівартість {money(line.plannedUnitCost, line.currency)}</small></div><div className={styles.lineActions}><span className={styles.amount}>{money(num(line.plannedQuantity) * num(line.plannedUnitPrice) - num(line.plannedDiscount), line.currency)}</span>{!direct && next && <button className={styles.button} disabled={Boolean(busy)} onClick={() => void updateLine(line, next)}>{lineAction(line.status)}</button>}</div></div>;
      })}</div>
      {!workLines.length && <div className={styles.empty}>Робіт ще немає. Додайте конкретну роботу, яку замовив клієнт.</div>}

      <div className={styles.searchBox}>
        <strong>Додати роботу з прайсу</strong>
        <div className={styles.searchRow}><input placeholder="Напр. заміна колодок" value={workQuery} onChange={(event) => setWorkQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchWorks(); }}/><button className={styles.button} onClick={() => void searchWorks()} disabled={busy === "work-search"}>{busy === "work-search" ? "Шукаю…" : "Знайти"}</button></div>
        {!!workResults.length && <div className={styles.results}>{workResults.slice(0, 8).map((item) => <button key={item.id} className={styles.result} disabled={Boolean(busy)} onClick={() => void act(`work:${item.id}`, `/api/work-orders/${encodeURIComponent(workOrderId)}/lines`, "POST", { catalogItemId: item.id, plannedUnitPrice: item.adjustedPrice, actorName: "CRM / WorkOrder Center" })}><span><b>{item.name}</b><small>{item.code || "Без коду"}{item.normHours ? ` · ${item.normHours} н/г` : ""}</small></span><strong>{money(item.adjustedPrice, "UAH")}</strong></button>)}</div>}
      </div>

      <div className={styles.manualForm}>
        <select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}><option value="LABOR">Робота</option><option value="EXTERNAL">Стороння</option><option value="CONSUMABLE">Матеріал</option><option value="OTHER">Інше</option></select>
        <input placeholder="Назва роботи / послуги" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}/>
        <input placeholder="К-сть" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))}/>
        <input placeholder="Продаж ₴" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}/>
        <input placeholder="Собіварт. ₴" value={draft.cost} onChange={(event) => setDraft((current) => ({ ...current, cost: event.target.value }))}/>
        <button className={styles.button} disabled={Boolean(busy) || !draft.description.trim()} onClick={() => void addLine()}>+ Додати вручну</button>
      </div>
    </div>}

    {view === "parts" && <>
      <div className={styles.block}>
        <div className={styles.blockTitle}><div><strong>Позиції запчастин</strong><small>{direct ? `Режим: ${modeLabel(directMode)}. Для кожної деталі CRM фіксує, хто її постачає.` : "Підбір, ціни та склад деталей цього ремонту."}</small></div><span className={styles.counter}>{partLines.length}</span></div>
        <div className={styles.lineList}>{partLines.map((line) => {
          const source = direct?.partSupplySources?.[line.id] ?? null;
          const customerConfirmed = Boolean(direct?.customerPartConfirmedLineIds?.includes(line.id));
          return <div className={styles.line} key={line.id}><div><strong>{line.description}</strong><small>{[line.brand, line.article].filter(Boolean).join(" · ") || line.status} · {num(line.plannedQuantity)} × {source === "CUSTOMER" ? "Надає клієнт · 0 грн" : money(line.plannedUnitPrice, line.currency)}{source !== "CUSTOMER" ? ` · закупка ${money(line.plannedUnitCost, line.currency)}` : ""}</small>{direct && <div className={styles.sourceRow}><span className={source === "CUSTOMER" ? styles.customerBadge : source === "SERVICE" ? styles.serviceBadge : styles.sourceMissing}>{source === "CUSTOMER" ? "Надає клієнт" : source === "SERVICE" ? "Постачає СТО" : "Джерело не вказано"}</span>{directMode === "MIXED" && <><button className={styles.miniButton} disabled={Boolean(busy) || source === "SERVICE"} onClick={() => void directAct(`source:${line.id}`, { action: "SET_PART_SOURCE", lineId: line.id, source: "SERVICE" })}>СТО</button><button className={styles.miniButton} disabled={Boolean(busy) || source === "CUSTOMER"} onClick={() => void directAct(`source:${line.id}`, { action: "SET_PART_SOURCE", lineId: line.id, source: "CUSTOMER" })}>Клієнт</button></>}</div>}</div><div className={styles.lineActions}><span className={styles.amount}>{source === "CUSTOMER" ? "0 грн" : money(num(line.plannedQuantity) * num(line.plannedUnitPrice) - num(line.plannedDiscount), line.currency)}</span>{source === "CUSTOMER" && <button className={customerConfirmed ? styles.confirmedButton : styles.button} disabled={Boolean(busy)} onClick={() => void directAct(`confirm:${line.id}`, { action: "CONFIRM_CUSTOMER_PART", lineId: line.id, confirmed: !customerConfirmed })}>{customerConfirmed ? "✓ Деталь на СТО" : "Підтвердити наявність"}</button>}{direct && !["IN_PROGRESS", "COMPLETED"].includes(line.status) && <button className={styles.danger} disabled={Boolean(busy)} onClick={() => void updateLine(line, "CANCELLED")}>Скасувати</button>}</div></div>;
        })}</div>
        {!partLines.length && <div className={styles.empty}>{noPartsMode ? "Для цього ремонту запчастини не потрібні." : "Запчастин у комерційній пропозиції ще немає."}</div>}

        {canUseServiceParts && !noPartsMode && <div className={styles.searchBox}>
          <strong>Запчастини, які постачає СТО</strong>
          <div className={styles.searchRow}><input placeholder="Артикул, бренд або назва" value={quoteQuery} onChange={(event) => setQuoteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchQuotes(); }}/><button className={styles.button} onClick={() => void searchQuotes()} disabled={busy === "quote-search"}>{busy === "quote-search" ? "Шукаю…" : "Знайти"}</button></div>
          {!!quoteResults.length && <div className={styles.results}>{quoteResults.map((quote) => <button key={quote.id} className={styles.result} disabled={Boolean(busy)} onClick={() => void addSupplierQuote(quote)}><span><b>{[quote.brand, quote.article].filter(Boolean).join(" · ")}</b><small>{quote.name || ""} · {quote.supplier.name} · актуально від {date(quote.fetchedAt)}</small></span><strong>{quote.purchasePrice ? money(quote.purchasePrice, quote.currency || "UAH") : "ціна не надана"}</strong></button>)}</div>}
        </div>}

        {canUseServiceParts && !noPartsMode && <div className={styles.manualPartForm}>
          <input placeholder="Артикул" value={draft.article} onChange={(event) => setDraft((current) => ({ ...current, article: event.target.value, type: "PART" }))}/>
          <input placeholder="Назва деталі СТО" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value, type: "PART" }))}/>
          <input placeholder="К-сть" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))}/>
          <input placeholder="Продаж ₴" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}/>
          <input placeholder="Закупка ₴" value={draft.cost} onChange={(event) => setDraft((current) => ({ ...current, cost: event.target.value }))}/>
          <button className={styles.button} disabled={Boolean(busy) || !draft.description.trim()} onClick={() => void addLine()}>+ Додати деталь СТО</button>
        </div>}

        {canUseCustomerParts && <div className={styles.customerPartBox}>
          <strong>Запчастина клієнта</strong><small>Фіксуємо її у складі ремонту, але не включаємо у продаж і закупівлю СТО.</small>
          <div className={styles.customerPartForm}>
            <input placeholder="Артикул (необов'язково)" value={customerPart.article} onChange={(event) => setCustomerPart((current) => ({ ...current, article: event.target.value }))}/>
            <input placeholder="Бренд (необов'язково)" value={customerPart.brand} onChange={(event) => setCustomerPart((current) => ({ ...current, brand: event.target.value }))}/>
            <input placeholder="Назва деталі *" value={customerPart.description} onChange={(event) => setCustomerPart((current) => ({ ...current, description: event.target.value }))}/>
            <input placeholder="К-сть" value={customerPart.quantity} onChange={(event) => setCustomerPart((current) => ({ ...current, quantity: event.target.value }))}/>
            <button className={styles.button} disabled={Boolean(busy) || !customerPart.description.trim()} onClick={() => void addCustomerPart()}>+ Додати деталь клієнта</button>
          </div>
        </div>}
      </div>

      {!noPartsMode && (!direct || (data.servicePartsCount ?? direct.servicePartCount) > 0) && <div className={styles.block}>
        <div className={styles.estimateTop}><div><strong>Заявка на закупівлю</strong><small>{data.partsRequest ? `${data.partsRequest.status} · ${data.partsRequest.items.length} позицій СТО` : `До закупівлі СТО: ${data.servicePartsCount ?? data.requiredPartsCount} позицій`}</small></div></div>
        {!data.partsRequest && <div className={styles.toolbar}><button className={styles.button} disabled={Boolean(busy) || (direct ? (data.servicePartsCount ?? 0) === 0 : !partLines.length)} onClick={() => void act("parts-open", `/api/work-orders/${encodeURIComponent(workOrderId)}/parts-request`, "POST", { actorName: "CRM / WorkOrder Center" })}>Створити заявку на закупівлю</button></div>}
        {data.partsRequest && <><div className={styles.toolbar}>{nextParts && <button className={styles.button} disabled={Boolean(busy)} onClick={() => void advanceParts(nextParts[0])}>{nextParts[1]}</button>}<label className={styles.check}><input type="checkbox" checked={data.partsRequest.paymentRequired} onChange={(event) => void act("payment-required", `/api/parts-requests/${encodeURIComponent(data.partsRequest!.id)}`, "PATCH", { paymentRequired: event.target.checked })}/>Передоплата деталей</label>{data.partsRequest.paymentRequired && !data.partsRequest.paymentConfirmedAt && <button className={styles.button} onClick={() => void act("payment-confirm", `/api/parts-requests/${encodeURIComponent(data.partsRequest!.id)}`, "PATCH", { paymentConfirmed: true })}>Оплату деталей підтверджено</button>}</div><div className={styles.partList}>{data.partsRequest.items.map((item) => {
          const received = Math.min(100, Math.round((num(item.receivedQuantity) / Math.max(.001, num(item.quantity))) * 100));
          const installed = Math.min(100, Math.round((num(item.installedQuantity) / Math.max(.001, num(item.quantity))) * 100));
          return <div className={styles.part} key={item.id}><div><strong>{item.brand ? `${item.brand} ` : ""}{item.article || item.description}</strong><small>Отримано {num(item.receivedQuantity)} / {num(item.quantity)} · встановлено {num(item.installedQuantity)}</small><div className={styles.progress}><i style={{ width: `${received}%` }}/></div></div><div className={styles.lineActions}><button className={styles.button} disabled={Boolean(busy) || received >= 100} onClick={() => void receive(item)}>{received >= 100 ? "Отримано" : "Прийняти"}</button><button className={styles.button} disabled={Boolean(busy) || received < 100 || installed >= 100} onClick={() => void install(item)}>{installed >= 100 ? "Встановлено" : "Встановити"}</button></div></div>;
        })}</div></>}
      </div>}
    </>}

    {view === "estimate" && <div className={styles.block}>
      <div className={styles.estimateTop}><div><strong>{direct ? "Комерційна пропозиція прямого ремонту" : "Кошторис"} {data.estimate ? `№${data.estimate.revision}` : "не сформована"}</strong><small>{data.estimate ? `${data.estimate.status} · ${money(data.estimate.totalAmount, data.estimate.currency)} · відправлено ${date(data.estimate.sentAt)}` : direct ? "Формується з робіт і джерел запчастин, без Діагностичної карти." : "Фіксує склад робіт, деталей і погоджених цін."}</small></div>{data.estimate && <span className={styles.amount}>{data.estimateIsCurrent ? "Актуальна" : "Потрібна нова ревізія"}</span>}</div>
      {direct && <div className={styles.estimateReadiness}>
        <span><b>Роботи</b>{workLines.length ? `${workLines.length} позицій` : "не додані"}</span>
        <span><b>Запчастини</b>{modeLabel(directMode)}</span>
        <span><b>КП</b>{data.estimateApproved ? "погоджена" : data.estimate?.status || "ще не сформована"}</span>
        <span><b>Готовність деталей</b>{data.partsReady ? "готові" : "ще не готові"}</span>
      </div>}
      <div className={styles.toolbar}><button className={styles.primary} disabled={Boolean(busy) || !estimateCanSend} onClick={() => void act("send", `/api/work-orders/${encodeURIComponent(workOrderId)}/estimate`, "POST", { actorName: "CRM / WorkOrder Center" })}>{busy === "send" ? "Формую…" : data.estimate && !data.estimateIsCurrent ? "Сформувати нову ревізію / відправити" : "Сформувати / відправити КП"}</button></div>
      {direct && !direct.configurationComplete && <div className={styles.notice}>Спочатку завершіть налаштування джерела запчастин. КП не буде відправлена з неоднозначним складом ремонту.</div>}
      {data.estimate?.status === "SENT" && data.estimateIsCurrent && <div className={styles.decision}><input placeholder="Хто погодив" value={approvalName} onChange={(event) => setApprovalName(event.target.value)}/><button className={styles.primary} disabled={Boolean(busy)} onClick={() => void decide("APPROVE")}>Погоджено</button><button className={styles.danger} disabled={Boolean(busy)} onClick={() => void decide("REJECT")}>Відхилено</button></div>}
      {data.estimateApproved && <div className={styles.approvedBanner}>✓ Актуальну КП погоджено клієнтом.</div>}
      {direct && data.estimateApproved && !data.partsReady && <div className={styles.notice}>КП погоджено, але ремонт ще не готовий до старту: дочекайтесь деталей СТО та/або підтвердьте наявність деталей клієнта.</div>}
      {direct && data.estimateApproved && data.partsReady && !data.mechanicAssigned && <div className={styles.notice}>Комерційна частина готова. Призначте механіка перед переведенням у «Готовий до ремонту».</div>}
      {canMarkReady && <button className={styles.readyButton} disabled={Boolean(busy)} onClick={() => void act("ready", `/api/work-orders/${encodeURIComponent(workOrderId)}`, "PATCH", { status: "READY_FOR_REPAIR" })}>✓ Все погоджено — готовий до ремонту</button>}
    </div>}

    {view === "qc" && <div className={styles.block}>
      <div className={styles.estimateTop}><div><strong>Контроль якості</strong><small>{qc?.latest ? `Спроба №${qc.latest.attempt} · ${qc.latest.status}` : "Перевірка ще не створена. Вона з’явиться на етапі контролю якості."}</small></div>{qc?.passed && <span className={styles.goodPill}>ПРОЙДЕНО</span>}</div>
      {qc?.latest && <div className={styles.qcForm}><input placeholder="Хто перевіряє" value={qcPerson} onChange={(event) => setQcPerson(event.target.value)}/><input placeholder="Коментар перевірки" value={qcNote} onChange={(event) => setQcNote(event.target.value)}/><div className={styles.toolbar}>{["PENDING", "RECHECK"].includes(qc.latest.status) && <button className={styles.primary} disabled={Boolean(busy)} onClick={() => void runQc("START")}>Почати перевірку</button>}{qc.latest.status === "IN_PROGRESS" && <><button className={styles.primary} disabled={Boolean(busy)} onClick={() => void runQc("PASS")}>Перевірку пройдено</button><button className={styles.danger} disabled={Boolean(busy)} onClick={() => void runQc("FAIL")}>Повернути на доопрацювання</button></>}{qc.latest.status === "FAILED" && <button className={styles.button} disabled={Boolean(busy)} onClick={() => void runQc("RECHECK")}>Створити повторну перевірку</button>}</div></div>}
    </div>}

    {view === "payment" && <div className={styles.block}>
      <div className={styles.estimateTop}><div><strong>Фіналізація та оплата</strong><small>{finance?.summary?.actualFinalized ? `До сплати ${finance.summary.receivable ? money(finance.summary.receivable, "UAH") : "—"} · оплачено ${money(finance.summary.paid, "UAH")}` : "Фінальна сума автоматично зафіксується після успішного контролю якості."}</small></div>{finance?.summary?.actualFinalized && <span className={styles.amount}>{finance.summary.fullyPaid ? "Оплачено" : `Борг ${money(finance.summary.outstanding, "UAH")}`}</span>}</div>
      {finance?.summary?.actualFinalized && outstanding > 0 && <div className={styles.paymentForm}>{accounts.length ? <><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type}</option>)}</select><input value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="Сума оплати"/><button className={styles.primary} disabled={Boolean(busy) || !accountId || !(Number(paymentAmount) > 0)} onClick={() => void pay()}>Прийняти оплату</button></> : <div className={styles.notice}>Немає активної каси або рахунку. Створіть Money Account у Фінансовому центрі. <button className={styles.button} type="button" onClick={() => navigateCrm("Фінансовий центр")}>Відкрити фінансовий центр</button></div>}</div>}
    </div>}

    {message && <div className={styles.notice}>{message}</div>}
  </div>;
}