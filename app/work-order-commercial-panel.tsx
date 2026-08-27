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
type Commercial = {
  lines: Line[];
  estimate: Estimate | null;
  partsRequest: PartsRequest | null;
  estimateIsCurrent: boolean;
  estimateApproved: boolean;
  requiredPartsCount: number;
  partsReady: boolean;
  mechanicAssigned: boolean;
  partsPaymentSatisfied: boolean;
};
type QcAttempt = { id: string; attempt: number; status: string; performedByName: string | null; resultNote: string | null; startedAt: string | null; completedAt: string | null };
type QualityControl = { latest: QcAttempt | null; attempts: QcAttempt[]; passed: boolean; failed: boolean; active: boolean };
type Finance = { summary: { receivable: string | null; paid: string; outstanding: string; fullyPaid: boolean; actualFinalized: boolean } };
type Account = { id: string; name: string; type: string; currency: string; isActive: boolean };
type WorkPrice = { id: string; code: string | null; name: string; unit: string; adjustedPrice: number; basePrice: number; coefficient: number; normHours: number | null };
type SupplierQuote = { id: string; article: string; brand: string | null; name: string | null; purchasePrice: string | null; currency: string | null; fetchedAt: string; supplier: { id: string; name: string; code: string; defaultMarkupPercent: string } };
type WorkOrderInfo = { status: string; vehicle: { brand: string | null; model: string | null; year: number | null } };

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

  async function addLine() {
    if (!draft.description.trim()) return;
    const ok = await act("line", `/api/work-orders/${encodeURIComponent(workOrderId)}/lines`, "POST", {
      type: draft.type,
      description: draft.description,
      plannedQuantity: draft.quantity || "1",
      plannedUnitPrice: draft.price || "0",
      plannedUnitCost: draft.cost || "0",
      article: draft.article || undefined,
      actorName: "CRM / WorkOrder Center",
    });
    if (ok) setDraft({ type: view === "parts" ? "PART" : "LABOR", description: "", quantity: "1", price: "", cost: "", article: "" });
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

  return <div className={styles.panel}>
    {view === "overview" && <>
      <div className={styles.overviewCards}>
        <div className={styles.overviewCard}><span>Кошторис</span><strong>{data.estimate ? money(data.estimate.totalAmount, data.estimate.currency) : "Не сформовано"}</strong><small>{data.estimateApproved ? "Погоджено клієнтом" : data.estimate?.status || "Очікує формування"}</small></div>
        <div className={styles.overviewCard}><span>Роботи</span><strong>{workLines.length}</strong><small>{workLines.filter((line) => line.status === "COMPLETED").length} виконано</small></div>
        <div className={styles.overviewCard}><span>Запчастини</span><strong>{partLines.length}</strong><small>{data.partsRequest?.status || (partLines.length ? "Заявку ще не відкрито" : "Немає позицій")}</small></div>
        <div className={styles.overviewCard}><span>Контроль якості</span><strong>{qc?.passed ? "Пройдено" : qc?.latest?.status || "Не розпочато"}</strong><small>{qc?.latest ? `Спроба №${qc.latest.attempt}` : "Очікує етапу QC"}</small></div>
        <div className={styles.overviewCard}><span>Оплата</span><strong>{finance?.summary?.actualFinalized ? money(finance.summary.paid, "UAH") : "Ще не фіналізовано"}</strong><small>{finance?.summary?.actualFinalized ? (finance.summary.fullyPaid ? "Оплачено повністю" : `Борг ${money(finance.summary.outstanding, "UAH")}`) : "Сума з’явиться після QC"}</small></div>
      </div>
      <div className={styles.gateGrid}>
        <div className={styles.gate}><span>Кошторис погоджено</span><strong className={data.estimateApproved ? styles.ok : styles.bad}>{data.estimateApproved ? "ТАК" : "НІ"}</strong></div>
        <div className={styles.gate}><span>Обов'язкові деталі готові</span><strong className={data.partsReady ? styles.ok : styles.bad}>{data.partsReady ? "ТАК" : "НІ"}</strong></div>
        <div className={styles.gate}><span>Автомеханік призначений</span><strong className={data.mechanicAssigned ? styles.ok : styles.bad}>{data.mechanicAssigned ? "ТАК" : "НІ"}</strong></div>
        <div className={styles.gate}><span>QC пройдено</span><strong className={qc?.passed ? styles.ok : styles.bad}>{qc?.passed ? "ТАК" : "НІ"}</strong></div>
        <div className={styles.gate}><span>Баланс клієнта</span><strong className={finance?.summary?.actualFinalized && finance.summary.fullyPaid ? styles.ok : styles.bad}>{finance?.summary?.actualFinalized ? money(outstanding, "UAH") : "ще не фіналізовано"}</strong></div>
      </div>
    </>}

    {view === "works" && <div className={styles.block}>
      <div className={styles.blockTitle}><div><strong>Роботи та послуги</strong><small>Тільки роботи, матеріали та сторонні послуги. Деталі винесені в окрему вкладку.</small></div><span className={styles.counter}>{workLines.length}</span></div>
      <div className={styles.lineList}>{workLines.map((line) => {
        const next = nextLineStatus(line.status);
        return <div className={styles.line} key={line.id}><div><strong>{line.description}</strong><small>{line.type} · {num(line.plannedQuantity)} × {money(line.plannedUnitPrice, line.currency)} · собівартість {money(line.plannedUnitCost, line.currency)}</small></div><div className={styles.lineActions}><span className={styles.amount}>{money(num(line.plannedQuantity) * num(line.plannedUnitPrice) - num(line.plannedDiscount), line.currency)}</span>{next && <button className={styles.button} disabled={Boolean(busy)} onClick={() => void updateLine(line, next)}>{lineAction(line.status)}</button>}</div></div>;
      })}</div>
      {!workLines.length && <div className={styles.empty}>Робіт ще немає.</div>}

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
        <div className={styles.blockTitle}><div><strong>Позиції запчастин</strong><small>Підбір, ціни та склад деталей цього ремонту.</small></div><span className={styles.counter}>{partLines.length}</span></div>
        <div className={styles.lineList}>{partLines.map((line) => <div className={styles.line} key={line.id}><div><strong>{line.description}</strong><small>{[line.brand, line.article].filter(Boolean).join(" · ") || line.status} · {num(line.plannedQuantity)} × {money(line.plannedUnitPrice, line.currency)} · закупка {money(line.plannedUnitCost, line.currency)}</small></div><div className={styles.lineActions}><span className={styles.amount}>{money(num(line.plannedQuantity) * num(line.plannedUnitPrice) - num(line.plannedDiscount), line.currency)}</span></div></div>)}</div>
        {!partLines.length && <div className={styles.empty}>Запчастин у комерційній пропозиції ще немає.</div>}

        <div className={styles.searchBox}>
          <strong>Додати деталь із пропозицій постачальників</strong>
          <div className={styles.searchRow}><input placeholder="Артикул, бренд або назва" value={quoteQuery} onChange={(event) => setQuoteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchQuotes(); }}/><button className={styles.button} onClick={() => void searchQuotes()} disabled={busy === "quote-search"}>{busy === "quote-search" ? "Шукаю…" : "Знайти"}</button></div>
          {!!quoteResults.length && <div className={styles.results}>{quoteResults.map((quote) => <button key={quote.id} className={styles.result} disabled={Boolean(busy)} onClick={() => void act(`quote:${quote.id}`, `/api/work-orders/${encodeURIComponent(workOrderId)}/lines`, "POST", { supplierQuoteId: quote.id, actorName: "CRM / WorkOrder Center" })}><span><b>{[quote.brand, quote.article].filter(Boolean).join(" · ")}</b><small>{quote.name || ""} · {quote.supplier.name} · актуально від {date(quote.fetchedAt)}</small></span><strong>{quote.purchasePrice ? money(quote.purchasePrice, quote.currency || "UAH") : "ціна не надана"}</strong></button>)}</div>}
        </div>

        <div className={styles.manualPartForm}>
          <input placeholder="Артикул" value={draft.article} onChange={(event) => setDraft((current) => ({ ...current, article: event.target.value, type: "PART" }))}/>
          <input placeholder="Назва деталі" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value, type: "PART" }))}/>
          <input placeholder="К-сть" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))}/>
          <input placeholder="Продаж ₴" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}/>
          <input placeholder="Закупка ₴" value={draft.cost} onChange={(event) => setDraft((current) => ({ ...current, cost: event.target.value }))}/>
          <button className={styles.button} disabled={Boolean(busy) || !draft.description.trim()} onClick={() => void addLine()}>+ Додати деталь</button>
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.estimateTop}><div><strong>Заявка на запчастини</strong><small>{data.partsRequest ? `${data.partsRequest.status} · ${data.partsRequest.items.length} позицій` : `У комерційній пропозиції ${data.requiredPartsCount} обов'язкових позицій`}</small></div></div>
        {!data.partsRequest && <div className={styles.toolbar}><button className={styles.button} disabled={Boolean(busy) || !partLines.length} onClick={() => void act("parts-open", `/api/work-orders/${encodeURIComponent(workOrderId)}/parts-request`, "POST", { actorName: "CRM / WorkOrder Center" })}>Створити заявку на закупівлю</button></div>}
        {data.partsRequest && <><div className={styles.toolbar}>{nextParts && <button className={styles.button} disabled={Boolean(busy)} onClick={() => void advanceParts(nextParts[0])}>{nextParts[1]}</button>}<label className={styles.check}><input type="checkbox" checked={data.partsRequest.paymentRequired} onChange={(event) => void act("payment-required", `/api/parts-requests/${encodeURIComponent(data.partsRequest!.id)}`, "PATCH", { paymentRequired: event.target.checked })}/>Передоплата деталей</label>{data.partsRequest.paymentRequired && !data.partsRequest.paymentConfirmedAt && <button className={styles.button} onClick={() => void act("payment-confirm", `/api/parts-requests/${encodeURIComponent(data.partsRequest!.id)}`, "PATCH", { paymentConfirmed: true })}>Оплату деталей підтверджено</button>}</div><div className={styles.partList}>{data.partsRequest.items.map((item) => {
          const received = Math.min(100, Math.round((num(item.receivedQuantity) / Math.max(.001, num(item.quantity))) * 100));
          const installed = Math.min(100, Math.round((num(item.installedQuantity) / Math.max(.001, num(item.quantity))) * 100));
          return <div className={styles.part} key={item.id}><div><strong>{item.brand ? `${item.brand} ` : ""}{item.article || item.description}</strong><small>Отримано {num(item.receivedQuantity)} / {num(item.quantity)} · встановлено {num(item.installedQuantity)}</small><div className={styles.progress}><i style={{ width: `${received}%` }}/></div></div><div className={styles.lineActions}><button className={styles.button} disabled={Boolean(busy) || received >= 100} onClick={() => void receive(item)}>{received >= 100 ? "Отримано" : "Прийняти"}</button><button className={styles.button} disabled={Boolean(busy) || received < 100 || installed >= 100} onClick={() => void install(item)}>{installed >= 100 ? "Встановлено" : "Встановити"}</button></div></div>;
        })}</div></>}
      </div>
    </>}

    {view === "estimate" && <div className={styles.block}>
      <div className={styles.estimateTop}><div><strong>Кошторис {data.estimate ? `№${data.estimate.revision}` : "не сформований"}</strong><small>{data.estimate ? `${data.estimate.status} · ${money(data.estimate.totalAmount, data.estimate.currency)} · відправлено ${date(data.estimate.sentAt)}` : "Фіксує склад робіт, деталей і погоджених цін."}</small></div>{data.estimate && <span className={styles.amount}>{data.estimateIsCurrent ? "Актуальний" : "Потрібна нова ревізія"}</span>}</div>
      <div className={styles.toolbar}><button className={styles.primary} disabled={Boolean(busy) || !data.lines.length || data.estimateApproved} onClick={() => void act("send", `/api/work-orders/${encodeURIComponent(workOrderId)}/estimate`, "POST", { actorName: "CRM / WorkOrder Center" })}>{busy === "send" ? "Формую…" : "Сформувати / відправити"}</button></div>
      {data.estimate?.status === "SENT" && <div className={styles.decision}><input placeholder="Хто погодив" value={approvalName} onChange={(event) => setApprovalName(event.target.value)}/><button className={styles.primary} disabled={Boolean(busy)} onClick={() => void decide("APPROVE")}>Погоджено</button><button className={styles.danger} disabled={Boolean(busy)} onClick={() => void decide("REJECT")}>Відхилено</button></div>}
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
