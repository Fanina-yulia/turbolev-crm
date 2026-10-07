"use client";

import { CrmPageHeader } from "./crm-page-header";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";
import { FinanceExpensesV2 } from "./finance-expenses-v2";
import { FinanceOperationDrawer } from "./finance-operation-drawer";
import { FinanceInfoTooltip } from "./finance-info-tooltip";
import {
  FinanceOwnerCommandCenter,
  OwnerProfitPlanDialog,
  findOwnerProfitPlan,
  type FinanceManagementPulse,
} from "./finance-owner-command-center";
import {
  FinanceAccrualBridge,
  FinanceCashClosePanel,
  FinanceContextKpis,
  FinanceDrilldown,
  FinanceForecastReasons,
  FinanceMarginControl,
  FinanceOverviewControl,
  FinancePlanPace,
  FinanceProfitabilityHighlights,
  type FinanceDrilldownMetric,
} from "./financial-center-v3-control";
import type { FinanceGlossaryKey } from "@/src/domain/finance-glossary";
import styles from "./financial-center-v2.module.css";

type Tab = "overview" | "pnl" | "cash" | "calendar" | "debts" | "profitability" | "expenses" | "accounts";
type ProfitTab = "workOrders" | "services" | "mechanics" | "parts" | "suppliers";
type Preset = "today" | "week" | "month" | "quarter" | "year" | "custom";
type OperationType = "EXPENSE" | "INCOME" | "TRANSFER";

type Category = { id: string; code: string; name: string; pnlSection: string | null; cashFlowSection: string | null; parentId: string | null; isSystem: boolean; sortOrder: number };
type CostCenter = { id: string; code: string; name: string; locationId: string | null; sortOrder: number };
type Account = { id: string; name: string; type: string; locationId: string | null; openingBalance: number; balance: number };
type Budget = { id: string; name: string; metric: string; amount: number; actual: number; variance: number; completionPercent: number | null; categoryName: string | null; periodStart: string; periodEnd: string; notes?: string | null };
type Obligation = { id: string; direction: "RECEIVABLE" | "PAYABLE"; status: string; amount: number; settledAmount: number; outstanding: number; issuedAt: string; dueAt: string | null; counterpartyName: string | null; description: string | null; workOrderId: string | null; sourceEntity: string | null; overdueDays: number; isOverdue: boolean };
type CalendarItem = { id: string; sourceType: string; direction: "INFLOW" | "OUTFLOW"; amount: number; weightedAmount: number; expectedAt: string; status: string; counterparty: string | null; description: string | null; sourceId: string | null };
type Alert = { level: "INFO" | "WARNING" | "CRITICAL"; code: string; title: string; message: string; amount?: number; date?: string };

type FinanceV2 = {
  ok: boolean;
  currency: string;
  viewer?: { persona: "OWNER" | "CASHIER" | "STATION_MANAGER" | "FINANCE" | "STANDARD"; primaryRole: string | null; userName: string | null; roles: Array<{ code: string; name: string; isPrimary: boolean }> };
  range: { from: string; to: string; timezone: string };
  settings: { scopeKey: string; locationId: string | null; defaultCurrency: string; minimumCashReserve: number; fixedMonthlyCosts: number; targetGrossMarginPercent: number; warningGrossMarginPercent: number; forecastHorizonDays: number };
  kpi: { currentCash: number; revenue: number; grossProfit: number; directCosts: number; opex: number; netProfit: number; cashFlow: number; grossMarginPercent: number | null; receivables: number; payables: number; overdueReceivables: number; overduePayables: number };
  comparison: { revenue: { previous: number; changePercent: number | null }; grossProfit: { previous: number; changePercent: number | null }; netProfit: { previous: number; changePercent: number | null }; opex: { previous: number; changePercent: number | null } };
  pnl: { revenue: number; cogs: number; grossProfit: number; grossMarginPercent: number | null; opex: number; operatingProfit: number; otherIncome: number; otherExpense: number; tax: number; netProfit: number; netMarginPercent: number | null; categories: Array<{ id: string; code: string; name: string; section: string; amount: number; count: number }>; events: Array<{ id: string; pnlSection: string; amount: number; recognizedAt: string; description: string | null; workOrderId: string | null; categoryId?: string | null; supplierId?: string | null; employeeId?: string | null; sourceEntity?: string | null; sourceEntityId?: string | null; category: { name: string; code?: string | null } | null }> };
  cashFlow: { inflow: number; outflow: number; net: number; operating: number; investing: number; financing: number; internalTransfer: number; transactions: Array<{ id: string; kind: string; flowSection: string; amount: number; occurredAt: string; description: string | null; fromAccountId: string | null; toAccountId: string | null; categoryId?: string | null; supplierId?: string | null; workOrderId?: string | null; sourceEntity?: string | null; sourceEntityId?: string | null }> };
  accounts: Account[];
  obligations: Obligation[];
  aging: { receivables: { total: number; overdue: number; buckets: Record<string, number> }; payables: { total: number; overdue: number; buckets: Record<string, number> } };
  categories: Category[];
  costCenters: CostCenter[];
  budgets: Budget[];
  recurring: Array<{ id: string; name: string; direction: string; amount: number; frequency: string; nextOccurrenceAt: string; counterpartyName: string | null; isActive: boolean }>;
  calendar: CalendarItem[];
  forecast: { horizonDays: number; minimumReserve: number; minimumForecastCash: number; firstGap: { date: string; closingCash: number } | null; firstReserveWarning: { date: string; closingCash: number } | null; points: Array<{ date: string; inflow: number; outflow: number; net: number; closingCash: number; belowReserve: boolean }> };
  breakEven: { fixedCosts: number; grossMarginPercent: number | null; breakEvenRevenue: number | null; currentRevenue: number; remainingRevenue: number | null; remainingWorkingDays: number; requiredRevenuePerDay: number | null };
  profitability: {
    workOrders: Array<{ workOrderId: string; client: string | null; vehicle: string | null; plateNumber: string | null; status: string | null; closedAt: string | null; revenue: number; directCost: number; grossProfit: number; marginPercent: number | null; laborRevenue: number; partsRevenue: number; partsCost: number; laborCost: number; consumablesCost: number }>;
    services: Array<{ type: string; name: string; revenue: number; directCost: number; profit: number; count: number; marginPercent: number | null }>;
    parts: Array<{ name: string; brand: string | null; article: string | null; supplierId: string | null; quantity: number; revenue: number; directCost: number; profit: number; markupPercent: number | null; marginPercent: number | null }>;
    mechanics: Array<{ mechanicId: string; name: string; position: string | null; revenue: number; directCost: number; profit: number; laborHours: number; lines: number; marginPercent: number | null }>;
    suppliers: Array<{ supplierId: string; name: string; revenue: number; directCost: number; profit: number; parts: number; markupPercent: number | null; marginPercent: number | null }>;
  };
  control?: {
    today?: { date: string; revenue: number; cashIn: number; cashOut: number; netCashFlow: number; receivablesCreated: number; receivablesCollected: number };
    forecast?: { currentCash: number; in7Days: number; in30Days: number; minimum: { date: string; closingCash: number } | null; firstGap: { date: string; closingCash: number } | null; firstReserveWarning: { date: string; closingCash: number } | null };
  };
  ownerSummary?: {
    netIncome: number;
    serviceTurnover: number;
    partsMargin: number;
    payrollAccrued: number;
    payrollDue: number;
    grossIncome: number;
    totalExpenses: number;
    cash: number;
    partsRevenue: number;
    partsCost: number;
    serviceBreakdown: { labor: number; diagnostics: number; external: number; other: number };
    expenseBreakdown: { payroll: number; otherDirect: number; otherOperating: number; otherExpense: number; tax: number };
    payrollEmployees: Array<{ employeeId: string; name: string; position: string | null; accrued: number; due: number; labor: number; sales: number; baseAndOther: number; profitShare: number }>;
  };
  financeCompleteness: {
    score: number;
    status: "COMPLETE" | "PARTIAL" | "LOW";
    preliminaryNetProfit: boolean;
    issues: Array<{ code: string; level: "INFO" | "WARNING" | "CRITICAL"; title: string; message: string; count: number }>;
    checks: { missingLaborAccruals: number; missingWalkInLabor: number; missingPartCosts: number; missingBaseAccrualEmployees: number };
  };
  alerts: Alert[];
};

type FinancePersona = NonNullable<FinanceV2["viewer"]>["persona"];
const TAB_LABEL: Record<Tab, string> = { overview: "Огляд", pnl: "Прибуток (P&L)", cash: "Рух грошей", calendar: "Платіжний календар", debts: "Борги", profitability: "Прибутковість", expenses: "Витрати", accounts: "Рахунки" };
function financeTabsForPersona(persona: FinancePersona | undefined): Tab[] {
  if (persona === "CASHIER" || persona === "STANDARD") return ["overview", "cash", "debts", "accounts"];
  if (persona === "STATION_MANAGER") return ["overview", "cash", "debts", "profitability", "expenses", "accounts"];
  return Object.keys(TAB_LABEL) as Tab[];
}
function canSeeFullFinance(persona: FinancePersona | undefined) { return persona === "OWNER" || persona === "FINANCE"; }
const AGING_LABEL: Record<string, string> = { "0_7": "0–7", "8_14": "8–14", "15_30": "15–30", "31_60": "31–60", "60_PLUS": "60+" };

const SECTION_META: Partial<Record<Tab, { eyebrow: string; title: string; description: string }>> = {
  pnl: {
    eyebrow: "PROFIT & LOSS",
    title: "Прибуток і збитки",
    description: "Виручка, прямі та операційні витрати, валовий і чистий прибуток за вибраний період.",
  },
  cash: {
    eyebrow: "CASH FLOW",
    title: "Рух грошей",
    description: "Фактичні надходження, виплати, внутрішні перекази та структура руху коштів.",
  },
  calendar: {
    eyebrow: "PAYMENT CALENDAR",
    title: "Платіжний календар і прогноз",
    description: "Майбутні платежі, регулярні операції та прогноз залишку коштів.",
  },
  debts: {
    eyebrow: "DEBTS",
    title: "Дебіторка та кредиторка",
    description: "Хто винен нам, кому винні ми, строки та прострочені зобов’язання.",
  },
  profitability: {
    eyebrow: "PROFITABILITY",
    title: "Прибутковість",
    description: "Маржинальність замовлень, послуг, механіків, запчастин і постачальників.",
  },
  accounts: {
    eyebrow: "MONEY ACCOUNTS",
    title: "Рахунки та каси",
    description: "Поточні управлінські залишки по касах, банківських рахунках і POS.",
  },
};

function money(value: number | null | undefined, currency = "UAH") { return value == null ? "—" : new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
function percent(value: number | null | undefined) { return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`; }
function dateText(value: string | null | undefined) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date); }
function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function isIsoDate(value: string | undefined) { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
function rangeFor(preset: Exclude<Preset, "custom">) {
  const today = new Date(); const to = isoDate(today); const from = new Date(today);
  if (preset === "today") return { from: to, to };
  if (preset === "week") { const day = (from.getDay() + 6) % 7; from.setDate(from.getDate() - day); return { from: isoDate(from), to }; }
  if (preset === "month") return { from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`, to };
  if (preset === "quarter") { const month = Math.floor(today.getMonth() / 3) * 3; return { from: `${today.getFullYear()}-${String(month + 1).padStart(2, "0")}-01`, to }; }
  return { from: `${today.getFullYear()}-01-01`, to };
}
function deltaClass(value: number | null | undefined) { return value == null ? "" : value >= 0 ? styles.deltaUp : styles.deltaDown; }
function sourceLabel(source: string) { return ({ OBLIGATION: "Зобов'язання", RECURRING: "Регулярний", FORECAST: "Прогноз", WORK_ORDER_FINANCE: "Замовлення" } as Record<string, string>)[source] || source; }
function accountShortLabel(account: Account) {
  if (account.type === "CASH") return "Каса";
  if (["ACQUIRING", "CARD"].includes(account.type)) return "POS";
  if (account.type === "BANK") return "Банк";
  return account.name;
}
function currentCashNote(data: FinanceV2) {
  const breakdown = data.accounts.slice(0, 3).map((account) => `${accountShortLabel(account)} ${money(account.balance)}`).join(" · ");
  return `${breakdown || `${data.accounts.length} рахунків`} · не залежить від періоду`;
}

function KpiCard({ label, value, note, delta, onClick, term }: { label: string; value: string; note?: string; delta?: number | null; onClick?: () => void; term?: FinanceGlossaryKey }) {
  const content = <><span>{term ? <FinanceInfoTooltip term={term} label={label} compact /> : label}</span><strong>{value}</strong><small>{delta != null ? <span className={deltaClass(delta)}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}% · </span> : null}{note || ""}</small></>;
  if (!onClick) return <div className={styles.kpi}>{content}</div>;
  return <div
    className={styles.kpi}
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    }}
  >{content}</div>;
}

export function FinancialCenter() {
  const initial = useMemo(() => rangeFor("month"), []);
  const [data, setData] = useState<FinanceV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [profitTab, setProfitTab] = useState<ProfitTab>("workOrders");
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [locationId, setLocationId] = useState("");
  const [operationOpen, setOperationOpen] = useState(false);
  const [operationType, setOperationType] = useState<OperationType>("EXPENSE");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHubOpen, setSettingsHubOpen] = useState(false);
  const [drilldown, setDrilldown] = useState<FinanceDrilldownMetric | null>(null);
  const [profitPlanOpen, setProfitPlanOpen] = useState(false);
  const [profitPlanData, setProfitPlanData] = useState<FinanceV2 | null>(null);
  const [managementPulse, setManagementPulse] = useState<FinanceManagementPulse | null>(null);

  const query = useMemo(() => { const q = new URLSearchParams({ from, to }); if (locationId) q.set("locationId", locationId); return q.toString(); }, [from, to, locationId]);
  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) { setLoading(true); setError(""); }
    try {
      const response = await fetch(`/api/finance/v2?${query}`, { cache: "no-store" });
      const next = await response.json();
      if (!response.ok || !next.ok) throw new Error(next.error || "Не вдалося завантажити фінансовий центр.");
      setData(next);
      if (silent) setError("");
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : "Помилка фінансового центру.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const route = readCrmRoute();
    if (isIsoDate(route.from)) setFrom(route.from!);
    if (isIsoDate(route.to)) setTo(route.to!);
    if (isIsoDate(route.from) || isIsoDate(route.to)) setPreset("custom");
    if (route.locationId) setLocationId(route.locationId);
    const routeTab = route.scope as string | undefined;
    if (routeTab === "plan") {
      setTab("overview");
      navigateCrm("Фінансовий центр", { from: isIsoDate(route.from) ? route.from : initial.from, to: isIsoDate(route.to) ? route.to : initial.to, scope: "overview", ...(route.locationId ? { locationId: route.locationId } : {}) });
    } else if (routeTab && Object.hasOwn(TAB_LABEL, routeTab)) {
      setTab(routeTab as Tab);
    }
  }, []);
  useEffect(() => {
    void load();

    const refresh = () => void load({ silent: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5000);

    window.addEventListener("turbolev:data-changed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("turbolev:data-changed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const selectedProfitPlan = useMemo(() => findOwnerProfitPlan(data?.budgets), [data?.budgets]);
  useEffect(() => {
    if (!selectedProfitPlan) { setProfitPlanData(null); return; }
    let cancelled = false;
    const planFrom = selectedProfitPlan.periodStart.slice(0, 10);
    const planTo = selectedProfitPlan.periodEnd.slice(0, 10);
    const loadPlan = async () => {
      try {
        const params = new URLSearchParams({ from: planFrom, to: planTo });
        if (locationId) params.set("locationId", locationId);
        const response = await fetch(`/api/finance/v2?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && response.ok && payload.ok) setProfitPlanData(payload);
      } catch {
        // Main finance refresh remains authoritative; plan-period refresh is best-effort.
      }
    };
    void loadPlan();
    const timer = window.setInterval(() => void loadPlan(), 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selectedProfitPlan?.id, selectedProfitPlan?.periodStart, selectedProfitPlan?.periodEnd, locationId]);

  useEffect(() => {
    if (data?.viewer?.persona !== "OWNER") { setManagementPulse(null); return; }
    let cancelled = false;
    const loadManagement = async () => {
      try {
        const params = new URLSearchParams({ week: isoDate(new Date()) });
        if (locationId) params.set("locationId", locationId);
        const response = await fetch(`/api/management/result?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && response.ok && payload.ok !== false) setManagementPulse(payload);
      } catch {
        // Financial Center must stay usable even if operational intelligence is temporarily unavailable.
      }
    };
    void loadManagement();
    const timer = window.setInterval(() => void loadManagement(), 30000);
    const refresh = () => void loadManagement();
    window.addEventListener("turbolev:data-changed", refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("turbolev:data-changed", refresh); };
  }, [data?.viewer?.persona, locationId]);

  const locations = useMemo(() => {
    const map = new Map<string, string>();
    data?.costCenters.forEach((item) => { if (item.locationId) map.set(item.locationId, item.name); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);
  const visibleTabs = useMemo(() => financeTabsForPersona(data?.viewer?.persona), [data?.viewer?.persona]);
  const fullFinance = canSeeFullFinance(data?.viewer?.persona);
  useEffect(() => {
    if (!data || visibleTabs.includes(tab)) return;
    setTab("overview");
    navigateCrm("Фінансовий центр", { from, to, scope: "overview", ...(locationId ? { locationId } : {}) });
  }, [data, tab, visibleTabs, from, to, locationId]);
  const periodLabel = `${dateText(`${from}T12:00:00+03:00`)} — ${dateText(`${to}T12:00:00+03:00`)}`;

  function route(nextTab = tab, nextFrom = from, nextTo = to, nextLocation = locationId) { navigateCrm("Фінансовий центр", { from: nextFrom, to: nextTo, scope: nextTab, ...(nextLocation ? { locationId: nextLocation } : {}) }); }
  function choosePreset(next: Exclude<Preset, "custom">) { const range = rangeFor(next); setPreset(next); setFrom(range.from); setTo(range.to); route(tab, range.from, range.to); }
  function chooseTab(next: Tab) { setTab(next); route(next); }
  function openOperation(next: OperationType) { setOperationType(next); setOperationOpen(true); }
  async function v2Action(action: string, payload: Record<string, unknown>) {
    const response = await fetch("/api/finance/v2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload, ...(locationId ? { locationId } : {}) }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Не вдалося виконати фінансову дію.");
    return result;
  }

  return <div className={styles.shell}>
    <CrmPageHeader
      eyebrow="TURBO LEV · ФІНАНСОВИЙ ЦЕНТР"
      title="Фінансовий центр"
      description={loading ? "Оновлюю фінансову картину…" : `${tab === "accounts" ? "Поточні залишки" : periodLabel} · прибуток · рух грошей · план/факт · прогноз`}
      actions={<>{fullFinance && <button type="button" className={styles.secondaryButton} onClick={() => setSettingsHubOpen(true)}>⚙ Налаштування</button>}<button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>Оновити</button>{data?.viewer?.persona !== "CASHIER" && data?.viewer?.persona !== "STANDARD" && <button type="button" className={styles.primaryButton} onClick={() => openOperation("EXPENSE")}>+ Додати операцію</button>}</>}
      tabs={<div className={styles.financeToolbar}>
        <nav className={styles.financeSections} aria-label="Фінансові розділи">{visibleTabs.map((item) => <button type="button" key={item} className={tab === item ? styles.activeTab : ""} onClick={() => chooseTab(item)}>{TAB_LABEL[item]}</button>)}</nav>
        {tab !== "accounts" && <>
          <div className={styles.financePeriods}>{(["today", "week", "month"] as const).map((item) => <button key={item} type="button" className={preset === item ? styles.activeTab : ""} onClick={() => choosePreset(item)}>{{ today: "Сьогодні", week: "Тиждень", month: "Місяць" }[item]}</button>)}</div>
          <label className={styles.financeDate}><input aria-label="Від" title="Від" type="date" value={from} max={to} onChange={(event) => { setPreset("custom"); setFrom(event.target.value); route(tab, event.target.value, to); }} /></label>
          <label className={styles.financeDate}><input aria-label="До" title="До" type="date" value={to} min={from} onChange={(event) => { setPreset("custom"); setTo(event.target.value); route(tab, from, event.target.value); }} /></label>
        </>}
        <label className={styles.financeLocation}><select aria-label="СТО" title="СТО" value={locationId} onChange={(event) => { setLocationId(event.target.value); route(tab, from, to, event.target.value); }}><option value="">Уся мережа</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>}
    />

    {error && <div className={styles.errorBox}><strong>Фінансовий центр не оновлено.</strong> {error}</div>}
    {message && <div className={styles.success}>{message}</div>}

    {data && tab === "overview" && fullFinance && <OwnerOverview data={data} profitPlanData={profitPlanData} managementPulse={managementPulse} onCreatePlan={() => setBudgetOpen(true)} onCreateProfitPlan={() => setProfitPlanOpen(true)} onMetric={setDrilldown} />}
    {data && tab === "overview" && !fullFinance && <><FinanceContextKpis data={data} tab={tab} onMetric={setDrilldown} /><FinanceOverviewControl data={data} /><FinanceAccrualBridge data={data} /></>}

    {!data && !loading && <div className={styles.empty}>Фінансові дані недоступні.</div>}
    {data && tab !== "overview" && tab !== "expenses" && <FinanceSectionHero tab={tab} />}
    {data && tab === "pnl" && <PnlView data={data} />}
    {data && tab === "cash" && <CashFlowView data={data} onOperation={openOperation} />}
    {data && tab === "calendar" && <><FinanceForecastReasons data={data} /><CalendarView data={data} onNewRecurring={() => setRecurringOpen(true)} onDebts={() => chooseTab("debts")} onSettings={() => setSettingsHubOpen(true)} /></>}
    {data && tab === "debts" && <DebtView data={data} />}
    {data && tab === "profitability" && <><FinanceMarginControl data={data} /><FinanceProfitabilityHighlights data={data} /><ProfitabilityView data={data} active={profitTab} onChange={setProfitTab} /></>}
    {data && tab === "expenses" && <FinanceExpensesV2
      from={from}
      to={to}
      locationId={locationId}
      categories={data.categories}
      accounts={data.accounts}
      finance={{
        revenue: data.pnl.revenue,
        cogs: data.pnl.cogs,
        opex: data.pnl.opex,
        otherExpense: data.pnl.otherExpense,
        tax: data.pnl.tax,
        operatingProfit: data.pnl.operatingProfit,
        netProfit: data.pnl.netProfit,
        events: data.pnl.events,
        cashOutflow: data.cashFlow.outflow,
        cashInflow: data.cashFlow.inflow,
        cashNet: data.cashFlow.net,
        transactions: data.cashFlow.transactions,
        obligations: data.obligations,
        budgets: data.budgets,
        alerts: data.alerts,
        financeCompleteness: data.financeCompleteness,
        profitabilityParts: data.profitability.parts,
      }}
      onCreate={() => openOperation("EXPENSE")}
      onChanged={() => void load()}
    />}
    {data && tab === "accounts" && <><AccountsView data={data} onOperation={openOperation} /><FinanceCashClosePanel data={data} onCloseDay={async (payload) => { try { await v2Action("CLOSE_CASH_DAY", payload); setMessage("Касовий день збережено."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося закрити касовий день."); } }} /></>}

    {data && <FinanceOperationDrawer open={operationOpen} initialType={operationType} locationId={locationId} categories={data.categories} accounts={data.accounts} costCenters={data.costCenters} onClose={() => setOperationOpen(false)} onChanged={() => void load()} />}
    {data && profitPlanOpen && <OwnerProfitPlanDialog budgets={data.budgets} onClose={() => setProfitPlanOpen(false)} onSave={async (payload) => { await v2Action("SAVE_BUDGET", payload); setProfitPlanOpen(false); setMessage("План чистого прибутку збережено та автоматично розкладено по періодах і підйомниках."); await load(); }} />}
    {data && budgetOpen && <BudgetDialog data={data} locationId={locationId} onClose={() => setBudgetOpen(false)} onSave={async (payload) => { try { await v2Action("SAVE_BUDGET", payload); setBudgetOpen(false); setMessage("Бюджет збережено."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося зберегти бюджет."); } }} />}
    {data && recurringOpen && <RecurringDialog data={data} locationId={locationId} onClose={() => setRecurringOpen(false)} onSave={async (payload) => { try { await v2Action("SAVE_RECURRING", payload); setRecurringOpen(false); setMessage("Регулярну операцію збережено."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося зберегти регулярну операцію."); } }} />}
    {data && categoryOpen && <CategoryDialog data={data} onClose={() => setCategoryOpen(false)} onSave={async (payload) => { try { await v2Action("CREATE_CATEGORY", payload); setCategoryOpen(false); setMessage("Категорію створено."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося створити категорію."); } }} />}
    {data && settingsOpen && <SettingsDialog data={data} locationId={locationId} onClose={() => setSettingsOpen(false)} onSave={async (payload) => { try { await v2Action("SAVE_SETTINGS", payload); setSettingsOpen(false); setMessage("Фінансові налаштування збережено."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося зберегти налаштування."); } }} />}
    {data && settingsHubOpen && <Modal title="Налаштування фінансів" onClose={() => setSettingsHubOpen(false)} wide><SettingsView data={data} onCategory={() => { setSettingsHubOpen(false); setCategoryOpen(true); }} onRecurring={() => { setSettingsHubOpen(false); setRecurringOpen(true); }} onSettings={() => { setSettingsHubOpen(false); setSettingsOpen(true); }} /></Modal>}
    {data && <FinanceDrilldown data={data} metric={drilldown} onClose={() => setDrilldown(null)} />}
  </div>;
}

function FinanceSectionHero({ tab }: { tab: Tab }) {
  const meta = SECTION_META[tab];
  if (!meta) return null;
  return <section className={styles.expenseHero}>
    <div>
      <span className={styles.eyebrow}>{meta.eyebrow}</span>
      <h2>{meta.title}</h2>
      <p>{meta.description}</p>
    </div>
  </section>;
}


function budgetFor(data: FinanceV2, ...metrics: string[]) {
  for (const metric of metrics) {
    const item = data.budgets.find((row) => row.metric === metric);
    if (item) return item;
  }
  return null;
}

function managementFacts(data: FinanceV2) {
  if (data.ownerSummary) return {
    serviceTurnover: data.ownerSummary.serviceTurnover,
    partsMargin: data.ownerSummary.partsMargin,
    payroll: data.ownerSummary.payrollAccrued,
    payrollDue: data.ownerSummary.payrollDue,
    grossIncome: data.ownerSummary.grossIncome,
    allExpenses: data.ownerSummary.totalExpenses,
    netIncome: data.ownerSummary.netIncome,
    cash: data.ownerSummary.cash,
  };

  const serviceTurnover = data.pnl.events
    .filter((row) => row.pnlSection === "REVENUE" && ["REV_LABOR", "REV_DIAGNOSTIC", "REV_DIAGNOSTICS", "REV_EXTERNAL"].includes(row.category?.code || ""))
    .reduce((sum, row) => sum + row.amount, 0);
  const partsRevenue = data.pnl.events.filter((row) => row.pnlSection === "REVENUE" && row.category?.code === "REV_PARTS").reduce((sum, row) => sum + row.amount, 0);
  const partsCost = data.pnl.events.filter((row) => row.pnlSection === "COGS" && row.category?.code === "COGS_PARTS").reduce((sum, row) => sum + row.amount, 0);
  const partsMargin = partsRevenue - partsCost;
  const payrollEvents = data.pnl.events.filter((row) => {
    const source = (row.sourceEntity || "").toUpperCase();
    return source === "SALARY_ACCRUAL" || source.startsWith("PAYROLL_PERIOD_EMPLOYEE") || source.includes("PAYROLL");
  });
  const payroll = payrollEvents.reduce((sum, row) => sum + row.amount, 0);
  const nonPartsDirectCosts = Math.max(0, data.pnl.cogs - partsCost);
  const allExpenses = nonPartsDirectCosts + data.pnl.opex + data.pnl.otherExpense + data.pnl.tax;
  const grossIncome = serviceTurnover + partsMargin;
  const netIncome = grossIncome - allExpenses;
  return { serviceTurnover, partsMargin, payroll, payrollDue: 0, grossIncome, allExpenses, netIncome, cash: data.kpi.currentCash };
}

function managementActualForBudget(metric: string, facts: ReturnType<typeof managementFacts>) {
  const values: Record<string, number> = {
    NET_INCOME: facts.netIncome,
    SERVICE_REVENUE: facts.serviceTurnover,
    PARTS_MARGIN: facts.partsMargin,
    PAYROLL: facts.payroll,
    GROSS_INCOME: facts.grossIncome,
    TOTAL_EXPENSES: facts.allExpenses,
    CASH_BALANCE: facts.cash,
  };
  return Object.prototype.hasOwnProperty.call(values, metric) ? values[metric] : null;
}

function OwnerOverview({ data, profitPlanData, managementPulse, onCreatePlan, onCreateProfitPlan, onMetric }: { data: FinanceV2; profitPlanData: FinanceV2 | null; managementPulse: FinanceManagementPulse | null; onCreatePlan: () => void; onCreateProfitPlan: () => void; onMetric: (metric: FinanceDrilldownMetric) => void }) {
  const facts = managementFacts(data);
  const cards = [
    { key: "NET_INCOME", label: "Чистий дохід", value: facts.netIncome, plan: budgetFor(data, "NET_INCOME", "NET_PROFIT"), mode: "HIGHER" as const, metric: "ownerNetIncome" as FinanceDrilldownMetric, note: "валовий дохід − всі витрати" },
    { key: "SERVICE_REVENUE", label: "Оборотка з послуг", value: facts.serviceTurnover, plan: budgetFor(data, "SERVICE_REVENUE"), mode: "HIGHER" as const, metric: "serviceTurnover" as FinanceDrilldownMetric, note: "роботи та діагностики, без продажу деталей" },
    { key: "PARTS_MARGIN", label: "Маржа по деталях", value: facts.partsMargin, plan: budgetFor(data, "PARTS_MARGIN"), mode: "HIGHER" as const, metric: "partsMargin" as FinanceDrilldownMetric, note: "продаж деталей − їх собівартість" },
    { key: "PAYROLL", label: "ЗП персоналу", value: facts.payroll, plan: budgetFor(data, "PAYROLL"), mode: "LOWER" as const, metric: "payroll" as FinanceDrilldownMetric, note: "нараховано за період · до виплати " + money(facts.payrollDue) },
    { key: "GROSS_INCOME", label: "Валовий дохід", value: facts.grossIncome, plan: budgetFor(data, "GROSS_INCOME"), mode: "HIGHER" as const, metric: "ownerGrossIncome" as FinanceDrilldownMetric, note: "послуги + маржа деталей" },
    { key: "TOTAL_EXPENSES", label: "Всі витрати", value: facts.allExpenses, plan: budgetFor(data, "TOTAL_EXPENSES"), mode: "LOWER" as const, metric: "totalExpenses" as FinanceDrilldownMetric, note: "зарплати + прямі + операційні + інші витрати + податки; без собівартості деталей" },
    { key: "CASH_BALANCE", label: "Грошей у касі", value: facts.cash, plan: budgetFor(data, "CASH_BALANCE"), mode: "MINIMUM" as const, metric: "currentCash" as FinanceDrilldownMetric, note: currentCashNote(data) },
  ];

  return <>
    <section className={styles.ownerOverview}>
      <div className={styles.ownerOverviewHeader}>
        <div><span className={styles.eyebrow}>ГОЛОВНІ ЦИФРИ ВЛАСНИКА</span><h2>Факт і план на одному екрані</h2><p>Сім показників, які відповідають на питання: скільки заробили, де заробили, скільки витратили та скільки грошей є зараз.</p></div>
        <button type="button" className={styles.primaryButton} onClick={onCreatePlan}>+ Задати план</button>
      </div>
      <div className={styles.ownerKpiGrid}>
        {cards.map((card, index) => {
          const planValue = card.plan?.amount ?? (card.key === "CASH_BALANCE" && data.settings.minimumCashReserve > 0 ? data.settings.minimumCashReserve : null);
          const ratio = planValue && planValue > 0 ? card.value / planValue * 100 : null;
          const good = ratio == null ? false : card.mode === "LOWER" ? ratio <= 100 : ratio >= 100;
          const warning = ratio == null ? false : card.mode === "LOWER" ? ratio > 100 && ratio <= 115 : ratio >= 80 && ratio < 100;
          const planLabel = card.key === "CASH_BALANCE" && !card.plan && planValue ? "Мінімум" : "План";
          return <button type="button" key={card.key} className={`${styles.ownerKpi} ${index === 0 ? styles.ownerKpiPrimary : ""}`} onClick={() => onMetric(card.metric)}>
            <span>{card.label}</span>
            <strong className={card.key === "NET_INCOME" && card.value < 0 ? styles.negative : ""}>{money(card.value)}</strong>
            <small>{card.note}</small>
            <div className={styles.ownerKpiPlan}>
              <span>{planLabel}: <b>{planValue == null ? "не задано" : money(planValue)}</b></span>
              <span className={ratio == null ? styles.ownerPlanNeutral : good ? styles.ownerPlanGood : warning ? styles.ownerPlanWarn : styles.ownerPlanBad}>{ratio == null ? "—" : `${ratio.toFixed(0)}%`}</span>
            </div>
            {ratio != null && <div className={styles.ownerProgress}><i className={good ? styles.ownerProgressGood : warning ? styles.ownerProgressWarn : styles.ownerProgressBad} style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }} /></div>}
          </button>;
        })}
      </div>
    </section>

    <FinanceOwnerCommandCenter data={data} planData={profitPlanData} management={managementPulse} onCreatePlan={onCreateProfitPlan} onMetric={onMetric} />

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>ІНШІ БЮДЖЕТИ / ФАКТ</span><h2>Додаткові фінансові бюджети</h2><p>Окремого екрана «План / факт» більше немає. Усі бюджети та відхилення контролюються тут.</p></div><button type="button" className={styles.primaryButton} onClick={onCreatePlan}>+ Додати бюджет</button></div>
      {data.budgets.length ? <div className={styles.grid3}>{data.budgets.map((item) => <BudgetCard key={item.id} item={item} actualOverride={managementActualForBudget(item.metric, facts)}/>)}</div> : <div className={styles.empty}>План на цей період ще не заданий.<div style={{marginTop:10}}><button type="button" className={styles.primaryButton} onClick={onCreatePlan}>Створити перший план</button></div></div>}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>ТЕМП МІСЯЦЯ</span><h2>Точка беззбитковості та темп</h2><p>Скільки ще потрібно заробити, щоб перекрити постійні витрати.</p></div></div>
      <div className={styles.miniCards}><div className={styles.miniCard}><span>Точка беззбитковості</span><strong>{money(data.breakEven.breakEvenRevenue)}</strong></div><div className={styles.miniCard}><span>Факт виручки</span><strong>{money(data.breakEven.currentRevenue)}</strong></div><div className={styles.miniCard}><span>Залишилось</span><strong>{money(data.breakEven.remainingRevenue)}</strong></div><div className={styles.miniCard}><span>Робочих днів</span><strong>{data.breakEven.remainingWorkingDays}</strong></div><div className={styles.miniCard}><span>Потрібно / день</span><strong>{money(data.breakEven.requiredRevenuePerDay)}</strong></div></div>
    </section>
  </>;
}

function Overview({ data, onTab }: { data: FinanceV2; onTab: (tab: Tab) => void }) {
  const topAlerts = data.alerts.slice(0, 5);
  if (!canSeeFullFinance(data.viewer?.persona)) return null;
  return <>
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>DATA QUALITY</span><h2>Повнота фінансових даних</h2><p>CRM перевіряє, чи всі витрати, що впливають на прибуток, потрапили у фінансовий результат.</p></div><span className={`${styles.completenessBadge} ${data.financeCompleteness.status === "COMPLETE" ? styles.completenessGood : data.financeCompleteness.status === "LOW" ? styles.completenessBad : styles.completenessWarn}`}>{data.financeCompleteness.score}%</span></div>
      <div className={styles.completenessBar}><span style={{ width: `${data.financeCompleteness.score}%` }} /></div>
      {data.financeCompleteness.issues.length ? <div className={styles.qualityIssues}>{data.financeCompleteness.issues.map((issue) => <div key={issue.code} className={issue.level === "CRITICAL" ? styles.qualityCritical : styles.qualityWarning}><strong>{issue.title}</strong><span>{issue.message}</span></div>)}</div> : <div className={styles.qualityComplete}>✓ Фінансові дані за доступними контрольними правилами повні.</div>}
      {data.financeCompleteness.preliminaryNetProfit && <p className={styles.hint}><strong>Чистий прибуток зараз попередній.</strong> Після усунення пунктів вище CRM перерахує його автоматично.</p>}
    </section>

    <div className={styles.grid2}>
      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>FINANCIAL PULSE</span><h2>Що потребує уваги</h2><p>Найкритичніші фінансові сигнали за поточними даними.</p></div></div><div className={styles.alertStack}>{topAlerts.length ? topAlerts.map((alert) => <div key={`${alert.code}:${alert.date || ""}`} className={`${styles.alert} ${alert.level === "CRITICAL" ? styles.alertCritical : alert.level === "WARNING" ? styles.alertWarning : styles.alertInfo}`}><span className={styles.alertDot}/><div><strong>{alert.title}</strong><div className={styles.hint}>{alert.message}{alert.date ? ` · ${dateText(alert.date)}` : ""}</div></div>{alert.amount != null && <strong>{money(alert.amount)}</strong>}</div>) : <div className={styles.empty}>Критичних фінансових сигналів немає.</div>}</div></section>
      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ТОЧКА БЕЗЗБИТКОВОСТІ</span><h2><FinanceInfoTooltip term="breakEven" label="Точка беззбитковості" /></h2><p>Скільки виручки потрібно для покриття постійних витрат.</p></div></div><div className={styles.summaryRow}><span>Постійні витрати</span><strong>{money(data.breakEven.fixedCosts)}</strong></div><div className={styles.summaryRow}><span>Валова маржа</span><strong>{percent(data.breakEven.grossMarginPercent)}</strong></div><div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span>Точка беззбитковості</span><strong>{money(data.breakEven.breakEvenRevenue)}</strong></div><div className={styles.summaryRow}><span>Поточна виручка</span><strong>{money(data.breakEven.currentRevenue)}</strong></div><div className={styles.summaryRow}><span>Залишилося</span><strong>{money(data.breakEven.remainingRevenue)}</strong></div><div className={styles.summaryRow}><span>Потрібно на робочий день</span><strong>{money(data.breakEven.requiredRevenuePerDay)}</strong></div></section>
    </div>
    <div className={styles.grid2}>
      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>P&L</span><h2><FinanceInfoTooltip term="pnl" label="Прибуток за період" /></h2></div><button className={styles.secondaryButton} onClick={() => onTab("pnl")}>Детально</button></div><PnlSummary data={data} /></section>
      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ПРОГНОЗ ГРОШЕЙ</span><h2>Що буде з грошима</h2><p>Зобов'язання + регулярні платежі + прогнозні операції.</p></div><button className={styles.secondaryButton} onClick={() => onTab("calendar")}>Календар</button></div><ForecastStrip data={data} /></section>
    </div>
    <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>PLAN / FACT</span><h2><FinanceInfoTooltip term="planFact" label="Виконання фінансового плану" /></h2></div><button className={styles.secondaryButton} onClick={() => onTab("overview")}>План на огляді</button></div>{data.budgets.length ? <div className={styles.grid3}>{data.budgets.slice(0, 6).map((item) => <BudgetCard item={item} key={item.id} />)}</div> : <div className={styles.empty}>Бюджети ще не задані. Додайте план безпосередньо на «Огляді».</div>}</section>
  </>;
}

function PnlSummary({ data }: { data: FinanceV2 }) {
  return <div><div className={styles.summaryRow}><span>Виручка</span><strong>{money(data.pnl.revenue)}</strong></div><div className={styles.summaryRow}><span>− COGS</span><strong>{money(data.pnl.cogs)}</strong></div><div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span>= Валовий прибуток</span><strong>{money(data.pnl.grossProfit)}</strong></div><div className={styles.summaryRow}><span>− OPEX</span><strong>{money(data.pnl.opex)}</strong></div><div className={styles.summaryRow}><span>= Операційний прибуток</span><strong>{money(data.pnl.operatingProfit)}</strong></div><div className={styles.summaryRow}><span>+ Інші доходи</span><strong>{money(data.pnl.otherIncome)}</strong></div><div className={styles.summaryRow}><span>− Інші витрати</span><strong>{money(data.pnl.otherExpense)}</strong></div><div className={styles.summaryRow}><span>− Податки</span><strong>{money(data.pnl.tax)}</strong></div><div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span>= Чистий прибуток</span><strong>{money(data.pnl.netProfit)}</strong></div></div>;
}

function PnlView({ data }: { data: FinanceV2 }) {
  const sections = ["REVENUE", "COGS", "OPEX", "OTHER_INCOME", "OTHER_EXPENSE", "TAX"];
  return <div className={styles.grid2}><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ПРИБУТОК І ЗБИТКИ</span><h2><FinanceInfoTooltip term="pnl" label="P&L" /></h2><p>Визнані POSTED-факти; оплата сама по собі не змінює P&L.</p></div></div><PnlSummary data={data} /></section><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>СТРУКТУРА</span><h2>Статті P&L</h2></div></div><div className={styles.metricList}>{sections.flatMap((section) => data.pnl.categories.filter((item) => item.section === section).map((item) => <div className={styles.metricItem} key={item.id}><span><strong>{item.name}</strong><small>{section} · {item.count} фактів</small></span><strong>{money(item.amount)}</strong><span>{data.pnl.revenue > 0 ? percent(item.amount / data.pnl.revenue * 100) : "—"}</span></div>))}</div></section><section className={`${styles.panel} ${styles.grid2}`} style={{gridColumn:"1 / -1"}}><div><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ПОРІВНЯННЯ</span><h2>Динаміка</h2></div></div><div className={styles.miniCards}><Mini label="Виручка" value={data.kpi.revenue} change={data.comparison.revenue.changePercent}/><Mini label="Валовий прибуток" value={data.kpi.grossProfit} change={data.comparison.grossProfit.changePercent}/><Mini label="Чистий прибуток" value={data.kpi.netProfit} change={data.comparison.netProfit.changePercent}/><Mini label="OPEX" value={data.pnl.opex} change={data.comparison.opex.changePercent}/></div></div><div><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ОСТАННІ ФАКТИ</span><h2>Останні проведення</h2></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Дата</th><th>Категорія</th><th>Опис</th><th className={styles.numberCell}>Сума</th></tr></thead><tbody>{data.pnl.events.slice(0,20).map((item) => <tr key={item.id}><td>{dateText(item.recognizedAt)}</td><td>{item.category?.name || item.pnlSection}</td><td>{item.description || "—"}<small>{item.workOrderId ? `ЗН ${item.workOrderId}` : ""}</small></td><td className={styles.numberCell}>{money(item.amount)}</td></tr>)}</tbody></table></div></div></section></div>;
}

function Mini({ label, value, change }: { label: string; value: number; change: number | null }) { return <div className={styles.miniCard}><span>{label}</span><strong>{money(value)}</strong><small className={deltaClass(change)}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</small></div>; }

function CashFlowView({ data, onOperation }: { data: FinanceV2; onOperation: (type: OperationType) => void }) {
  return <><div className={styles.grid3}><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>РУХ ГРОШЕЙ</span><h2><FinanceInfoTooltip term="cashFlow" label="Рух грошей" /></h2></div></div><div className={styles.summaryRow}><span><FinanceInfoTooltip term="inflow" label="Надходження" compact /></span><strong className={styles.positive}>{money(data.cashFlow.inflow)}</strong></div><div className={styles.summaryRow}><span><FinanceInfoTooltip term="outflow" label="Виплати" compact /></span><strong className={styles.negative}>{money(data.cashFlow.outflow)}</strong></div><div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span><FinanceInfoTooltip term="cashFlow" label="Net Cash Flow" compact /></span><strong>{money(data.cashFlow.net)}</strong></div></section><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ЗА ВИДАМИ ДІЯЛЬНОСТІ</span><h2>За видами діяльності</h2></div></div><div className={styles.summaryRow}><span><FinanceInfoTooltip term="operatingCashFlow" label="Операційна" compact /></span><strong>{money(data.cashFlow.operating)}</strong></div><div className={styles.summaryRow}><span><FinanceInfoTooltip term="investingCashFlow" label="Інвестиційна" compact /></span><strong>{money(data.cashFlow.investing)}</strong></div><div className={styles.summaryRow}><span><FinanceInfoTooltip term="financingCashFlow" label="Фінансова" compact /></span><strong>{money(data.cashFlow.financing)}</strong></div><div className={styles.summaryRow}><span><FinanceInfoTooltip term="internalTransfer" label="Внутрішні перекази" compact /></span><strong>{money(data.cashFlow.internalTransfer)}</strong></div></section><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ОПЕРАЦІЇ</span><h2>Швидкі дії</h2></div></div><div className={styles.quickActions}><button className={styles.primaryButton} onClick={() => onOperation("INCOME")}>+ Надходження</button><button className={styles.secondaryButton} onClick={() => onOperation("EXPENSE")}>+ Витрата</button><button className={styles.secondaryButton} onClick={() => onOperation("TRANSFER")}>↔ Переказ</button></div><p className={styles.hint}>Внутрішній переказ не впливає на P&L і загальну суму грошей компанії.</p></section></div><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ФАКТИЧНІ РУХИ</span><h2>Фактичні рухи</h2></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Дата</th><th>Тип</th><th>Секція</th><th>Опис</th><th className={styles.numberCell}>Сума</th></tr></thead><tbody>{data.cashFlow.transactions.map((tx) => <tr key={tx.id}><td>{dateText(tx.occurredAt)}</td><td>{tx.kind}</td><td>{tx.flowSection}</td><td>{tx.description || "—"}</td><td className={`${styles.numberCell} ${tx.kind === "INFLOW" ? styles.positive : tx.kind === "OUTFLOW" ? styles.negative : ""}`}>{tx.kind === "OUTFLOW" ? "−" : tx.kind === "INFLOW" ? "+" : ""}{money(tx.amount)}</td></tr>)}</tbody></table></div></section></>;
}

function BudgetCard({ item, actualOverride = null }: { item: Budget; actualOverride?: number | null }) { const actual = actualOverride == null ? item.actual : actualOverride; const variance = actual - item.amount; const rawPct = item.amount > 0 ? actual / item.amount * 100 : null; const pct = Math.max(0, Math.min(160, rawPct || 0)); const isExpense = ["OPEX","COGS","CATEGORY","PAYROLL","TOTAL_EXPENSES"].includes(item.metric); const tone = rawPct == null ? "" : isExpense ? rawPct > 100 ? styles.bad : rawPct >= 90 ? styles.warn : styles.good : rawPct >= 100 ? styles.good : rawPct >= 80 ? styles.warn : ""; return <div className={styles.panel}><div className={styles.sectionTitle}><h3>{item.name}</h3><span className={`${styles.badge} ${tone}`}>{rawPct == null ? "—" : `${rawPct.toFixed(0)}%`}</span></div><div className={styles.statPair}><span>План</span><strong>{money(item.amount)}</strong></div><div className={styles.statPair}><span>Факт</span><strong>{money(actual)}</strong></div><div className={styles.statPair}><span>Відхилення</span><strong className={isExpense && variance > 0 ? styles.negative : !isExpense && variance >= 0 ? styles.positive : ""}>{money(variance)}</strong></div><div className={styles.progress}><span style={{width:`${Math.min(100,pct)}%`}} /></div></div>; }
function PlanFactView({ data, onNewBudget }: { data: FinanceV2; onNewBudget: () => void }) { return <><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>КОНТРОЛЬ БЮДЖЕТУ</span><h2>План / факт</h2><p>Бюджети компанії, СТО або окремої категорії.</p></div><button className={styles.primaryButton} onClick={onNewBudget}>+ Додати бюджет</button></div>{data.budgets.length ? <div className={styles.grid3}>{data.budgets.map((item) => <BudgetCard key={item.id} item={item}/>)}</div> : <div className={styles.empty}>План на цей період ще не заданий. Створіть бюджет, щоб CRM могла прогнозувати виконання.<div style={{marginTop:10}}><button type="button" className={styles.primaryButton} onClick={onNewBudget}>Створити план</button></div></div>}</section><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ТОЧКА БЕЗЗБИТКОВОСТІ</span><h2>План до беззбитковості</h2></div></div><div className={styles.miniCards}><div className={styles.miniCard}><span>Точка беззбитковості</span><strong>{money(data.breakEven.breakEvenRevenue)}</strong></div><div className={styles.miniCard}><span>Факт виручки</span><strong>{money(data.breakEven.currentRevenue)}</strong></div><div className={styles.miniCard}><span>Залишилось</span><strong>{money(data.breakEven.remainingRevenue)}</strong></div><div className={styles.miniCard}><span>Робочих днів</span><strong>{data.breakEven.remainingWorkingDays}</strong></div><div className={styles.miniCard}><span>Потрібно / день</span><strong>{money(data.breakEven.requiredRevenuePerDay)}</strong></div></div></section></>; }

function ForecastStrip({ data }: { data: FinanceV2 }) { const points = data.forecast.points.filter((_, index) => index % Math.max(1, Math.floor(data.forecast.points.length / 10)) === 0).slice(0,12); return <div className={styles.forecastLine}>{points.map((point) => <div key={point.date} className={`${styles.forecastPoint} ${point.closingCash < 0 ? styles.cashGap : point.belowReserve ? styles.belowReserve : ""}`}><span>{dateText(point.date)}</span><strong>{money(point.closingCash)}</strong><small>{point.net >= 0 ? "+" : ""}{money(point.net)}</small></div>)}</div>; }
function CalendarView({ data, onNewRecurring, onDebts, onSettings }: { data: FinanceV2; onNewRecurring: () => void; onDebts: () => void; onSettings: () => void }) {
  const grouped = new Map<string, CalendarItem[]>(); data.calendar.forEach((item) => { const day = item.expectedAt.slice(0,10); grouped.set(day, [...(grouped.get(day)||[]), item]); });
  return <><div className={styles.grid2}><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ПРОГНОЗ ГРОШЕЙ</span><h2>Прогноз залишку</h2><p>Горизонт {data.forecast.horizonDays} днів.</p></div></div><ForecastStrip data={data}/><div className={styles.miniCards}><div className={styles.miniCard}><span>Зараз</span><strong>{money(data.kpi.currentCash)}</strong></div><div className={styles.miniCard}><span>Мінімум прогнозу</span><strong className={data.forecast.minimumForecastCash < 0 ? styles.negative : ""}>{money(data.forecast.minimumForecastCash)}</strong></div><div className={styles.miniCard}><span>Резерв</span><strong>{money(data.forecast.minimumReserve)}</strong></div>{data.forecast.firstGap && <div className={styles.miniCard}><span>Касовий розрив</span><strong className={styles.negative}>{dateText(data.forecast.firstGap.date)}</strong></div>}</div></section><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>РЕГУЛЯРНІ ОПЕРАЦІЇ</span><h2>Регулярні операції</h2></div><button className={styles.primaryButton} onClick={onNewRecurring}>+ Додати</button></div>{data.recurring.length ? data.recurring.slice(0,10).map((row) => <div className={styles.summaryRow} key={row.id}><span><strong>{row.name}</strong><small>{row.frequency} · {dateText(row.nextOccurrenceAt)}</small></span><strong className={row.direction === "OUTFLOW" ? styles.negative : styles.positive}>{money(row.amount)}</strong></div>) : <div className={styles.empty}>Регулярні платежі не налаштовані.</div>}</section></div><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ПЛАТІЖНИЙ КАЛЕНДАР</span><h2>Платіжний календар</h2><p>Зобов'язання, регулярні та прогнозні операції.</p></div></div><div className={styles.grid3}>{Array.from(grouped.entries()).slice(0,90).map(([day, items]) => { const inflow=items.filter(i=>i.direction==="INFLOW").reduce((s,i)=>s+i.weightedAmount,0); const outflow=items.filter(i=>i.direction==="OUTFLOW").reduce((s,i)=>s+i.weightedAmount,0); return <div className={styles.calendarDay} key={day}><div className={styles.calendarHeader}><strong>{dateText(day)}</strong><span className={inflow-outflow>=0?styles.positive:styles.negative}>{money(inflow-outflow)}</span></div>{items.map(item=><div className={styles.calendarItem} key={item.id}><span className={item.direction==="INFLOW"?styles.positive:styles.negative}>{item.direction==="INFLOW"?"Очікуємо":"Оплатити"}</span><span><strong>{item.counterparty||item.description||sourceLabel(item.sourceType)}</strong><small>{sourceLabel(item.sourceType)} · {item.status}</small>{item.sourceType==="OBLIGATION"&&<button type="button" className={styles.linkButton} onClick={onDebts}>Відкрити борги</button>}{item.sourceType==="RECURRING"&&<button type="button" className={styles.linkButton} onClick={onSettings}>Відкрити правило</button>}</span><strong>{money(item.weightedAmount)}</strong></div>)}</div>; })}</div></section></>;
}

function DebtView({ data }: { data: FinanceV2 }) {
  const [direction,setDirection]=useState<"RECEIVABLE"|"PAYABLE">("RECEIVABLE"); const target=direction==="RECEIVABLE"?data.aging.receivables:data.aging.payables; const rows=data.obligations.filter(item=>item.direction===direction);
  return <><div className={styles.subTabs}><button className={direction==="RECEIVABLE"?styles.activeTab:""} onClick={()=>setDirection("RECEIVABLE")}>Дебіторка · {money(data.aging.receivables.total)}</button><button className={direction==="PAYABLE"?styles.activeTab:""} onClick={()=>setDirection("PAYABLE")}>Кредиторка · {money(data.aging.payables.total)}</button></div><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>AGING</span><h2>{direction==="RECEIVABLE"?<FinanceInfoTooltip term="receivables" label="Хто винен нам" />:<FinanceInfoTooltip term="payables" label="Кому винні ми" />}</h2><p>Прострочено: {money(target.overdue)}</p></div></div><div className={styles.miniCards}>{Object.entries(target.buckets).map(([key,value])=><div className={styles.miniCard} key={key}><span>{AGING_LABEL[key]} днів</span><strong>{money(value)}</strong></div>)}</div><div className={styles.tableWrap} style={{marginTop:12}}><table className={styles.table}><thead><tr><th>Контрагент</th><th>Джерело</th><th>Виникло</th><th>Строк</th><th>Прострочення</th><th className={styles.numberCell}>Сума</th><th className={styles.numberCell}>Залишок</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.counterpartyName||"Без контрагента"}</strong><small>{row.description||"—"}</small></td><td>{row.workOrderId?`ЗН ${row.workOrderId}`:row.sourceEntity||"—"}</td><td>{dateText(row.issuedAt)}</td><td>{dateText(row.dueAt)}</td><td>{row.isOverdue?<span className={`${styles.badge} ${styles.bad}`}>{row.overdueDays} дн.</span>:<span className={`${styles.badge} ${styles.good}`}>в строк</span>}</td><td className={styles.numberCell}>{money(row.amount)}</td><td className={styles.numberCell}><strong>{money(row.outstanding)}</strong></td></tr>)}</tbody></table></div></section></>;
}

function ProfitabilityView({ data, active, onChange }: { data: FinanceV2; active: ProfitTab; onChange: (tab: ProfitTab)=>void }) { const available = data.viewer?.persona === "STATION_MANAGER" ? (["workOrders"] as ProfitTab[]) : (["workOrders","services","mechanics","parts","suppliers"] as ProfitTab[]); const safeActive = available.includes(active) ? active : "workOrders"; return <><div className={styles.subTabs}>{available.map(profit=><button key={profit} className={safeActive===profit?styles.activeTab:""} onClick={()=>onChange(profit)}>{{workOrders:"Замовлення",services:"Послуги",mechanics:"Механіки",parts:"Запчастини",suppliers:"Постачальники"}[profit]}</button>)}</div><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ПРИБУТКОВІСТЬ</span><h2><FinanceInfoTooltip term="profitability" label="Прибутковість" /></h2><p>Виручка, прямі витрати, прибуток та маржа без штучного розподілу OPEX.</p></div></div><ProfitTable data={data} active={safeActive}/></section></>; }
function ProfitTable({data,active}:{data:FinanceV2;active:ProfitTab}) {
  if(active==="workOrders") return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Замовлення / авто</th><th>Клієнт</th><th className={styles.numberCell}>Виручка</th><th className={styles.numberCell}>Прямі витрати</th><th className={styles.numberCell}>GP</th><th>Маржа</th></tr></thead><tbody>{data.profitability.workOrders.map(row=><tr key={row.workOrderId}><td><strong>{row.vehicle||row.workOrderId}</strong><small>{row.plateNumber||row.workOrderId}</small></td><td>{row.client||"—"}</td><td className={styles.numberCell}>{money(row.revenue)}</td><td className={styles.numberCell}>{money(row.directCost)}</td><td className={styles.numberCell}><strong>{money(row.grossProfit)}</strong></td><td><Margin value={row.marginPercent} settings={data.settings}/></td></tr>)}</tbody></table></div>;
  if(active==="services") return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Послуга</th><th>Тип</th><th>К-сть</th><th className={styles.numberCell}>Виручка</th><th className={styles.numberCell}>Собівартість</th><th className={styles.numberCell}>Прибуток</th><th>Маржа</th></tr></thead><tbody>{data.profitability.services.map((row,index)=><tr key={`${row.type}:${row.name}:${index}`}><td>{row.name}</td><td>{row.type}</td><td>{row.count}</td><td className={styles.numberCell}>{money(row.revenue)}</td><td className={styles.numberCell}>{money(row.directCost)}</td><td className={styles.numberCell}>{money(row.profit)}</td><td><Margin value={row.marginPercent} settings={data.settings}/></td></tr>)}</tbody></table></div>;
  if(active==="mechanics") return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Механік</th><th>Робіт</th><th>Години</th><th className={styles.numberCell}>Виручка робіт</th><th className={styles.numberCell}>Прямі витрати</th><th className={styles.numberCell}>Внесок</th><th>Маржа</th></tr></thead><tbody>{data.profitability.mechanics.map(row=><tr key={row.mechanicId}><td><strong>{row.name}</strong><small>{row.position||"—"}</small></td><td>{row.lines}</td><td>{row.laborHours.toFixed(1)}</td><td className={styles.numberCell}>{money(row.revenue)}</td><td className={styles.numberCell}>{money(row.directCost)}</td><td className={styles.numberCell}>{money(row.profit)}</td><td><Margin value={row.marginPercent} settings={data.settings}/></td></tr>)}</tbody></table></div>;
  if(active==="parts") return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Запчастина</th><th>Артикул</th><th>К-сть</th><th className={styles.numberCell}>Продаж</th><th className={styles.numberCell}>Закупка</th><th className={styles.numberCell}>GP</th><th>Націнка</th><th>Маржа</th></tr></thead><tbody>{data.profitability.parts.map((row,index)=><tr key={`${row.article||row.name}:${index}`}><td><strong>{row.name}</strong><small>{row.brand||"—"}</small></td><td>{row.article||"—"}</td><td>{row.quantity}</td><td className={styles.numberCell}>{money(row.revenue)}</td><td className={styles.numberCell}>{money(row.directCost)}</td><td className={styles.numberCell}>{money(row.profit)}</td><td>{percent(row.markupPercent)}</td><td><Margin value={row.marginPercent} settings={data.settings}/></td></tr>)}</tbody></table></div>;
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Постачальник</th><th>Позицій</th><th className={styles.numberCell}>Продаж</th><th className={styles.numberCell}>Закупка</th><th className={styles.numberCell}>GP</th><th>Націнка</th><th>Маржа</th></tr></thead><tbody>{data.profitability.suppliers.map(row=><tr key={row.supplierId}><td>{row.name}</td><td>{row.parts}</td><td className={styles.numberCell}>{money(row.revenue)}</td><td className={styles.numberCell}>{money(row.directCost)}</td><td className={styles.numberCell}>{money(row.profit)}</td><td>{percent(row.markupPercent)}</td><td><Margin value={row.marginPercent} settings={data.settings}/></td></tr>)}</tbody></table></div>;
}
function Margin({value,settings}:{value:number|null;settings:FinanceV2["settings"]}) { const cls=value==null?"":value<settings.warningGrossMarginPercent?styles.bad:value<settings.targetGrossMarginPercent?styles.warn:styles.good; return <span className={`${styles.badge} ${cls}`}>{percent(value)}</span>; }

function AccountsView({data,onOperation}:{data:FinanceV2;onOperation:(type:OperationType)=>void}) { return <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>РАХУНКИ ТА КАСИ</span><h2><FinanceInfoTooltip term="accounts" label="Рахунки та каси" /></h2><p>Поточний управлінський залишок по кожному рахунку.</p></div><div className={styles.quickActions}><button className={styles.primaryButton} onClick={()=>onOperation("INCOME")}>+ Надходження</button><button className={styles.secondaryButton} onClick={()=>onOperation("TRANSFER")}>↔ Переказ</button></div></div><div className={styles.grid3}>{data.accounts.map(account=><div className={styles.panel} key={account.id}><div className={styles.sectionTitle}><h3>{account.name}</h3><span className={styles.badge}>{account.type}</span></div><strong style={{fontSize:24}}>{money(account.balance)}</strong><div className={styles.hint}>Стартовий залишок {money(account.openingBalance)}</div></div>)}</div></section>; }

function SettingsView({data,onCategory,onRecurring,onSettings}:{data:FinanceV2;onCategory:()=>void;onRecurring:()=>void;onSettings:()=>void}) { return <><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>ФІНАНСОВІ ПРАВИЛА</span><h2>Правила управління</h2></div><button className={styles.primaryButton} onClick={onSettings}>Змінити</button></div><div className={styles.settingsGrid}><div className={styles.miniCard}><span>Мінімальний резерв</span><strong>{money(data.settings.minimumCashReserve)}</strong></div><div className={styles.miniCard}><span>Постійні витрати / міс.</span><strong>{money(data.settings.fixedMonthlyCosts)}</strong></div><div className={styles.miniCard}><span>Цільова маржа</span><strong>{percent(data.settings.targetGrossMarginPercent)}</strong></div><div className={styles.miniCard}><span>Поріг уваги</span><strong>{percent(data.settings.warningGrossMarginPercent)}</strong></div><div className={styles.miniCard}><span>Прогноз</span><strong>{data.settings.forecastHorizonDays} днів</strong></div></div></section><div className={styles.grid2}><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>КАТЕГОРІЇ</span><h2>Категорії та підкатегорії</h2></div><button className={styles.primaryButton} onClick={onCategory}>+ Категорія</button></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Назва</th><th>P&L</th><th>Cash Flow</th><th>Тип</th></tr></thead><tbody>{data.categories.map(row=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.code}{row.parentId?" · підкатегорія":""}</small></td><td>{row.pnlSection||"—"}</td><td>{row.cashFlowSection||"—"}</td><td>{row.isSystem?"Системна":"Власна"}</td></tr>)}</tbody></table></div></section><section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>РЕГУЛЯРНІ ОПЕРАЦІЇ</span><h2>Регулярні операції</h2></div><button className={styles.primaryButton} onClick={onRecurring}>+ Правило</button></div>{data.recurring.map(row=><div className={styles.summaryRow} key={row.id}><span><strong>{row.name}</strong><small>{row.frequency} · наступна {dateText(row.nextOccurrenceAt)}</small></span><strong>{money(row.amount)}</strong></div>)}</section></div></>; }

function BudgetDialog({data,locationId,onClose,onSave}:{data:FinanceV2;locationId:string;onClose:()=>void;onSave:(payload:Record<string,unknown>)=>void}) { const [name,setName]=useState(""); const [metric,setMetric]=useState("REVENUE"); const [amount,setAmount]=useState(""); const [categoryId,setCategoryId]=useState(""); const [start,setStart]=useState(data.range.from.slice(0,10)); const [end,setEnd]=useState(data.range.to.slice(0,10)); return <Modal title="Новий бюджет" onClose={onClose}><div className={styles.modalGrid}><label>Назва<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Показник<select value={metric} onChange={e=>setMetric(e.target.value)}><option value="NET_INCOME">Чистий дохід</option><option value="SERVICE_REVENUE">Оборотка з послуг</option><option value="PARTS_MARGIN">Маржа по деталях</option><option value="PAYROLL">ЗП персоналу</option><option value="GROSS_INCOME">Валовий дохід</option><option value="TOTAL_EXPENSES">Всі витрати</option><option value="CASH_BALANCE">Грошей у касі</option><option value="REVENUE">Загальна виручка (P&L)</option><option value="COGS">COGS</option><option value="OPEX">OPEX</option><option value="GROSS_PROFIT">Валовий прибуток (P&L)</option><option value="NET_PROFIT">Чистий прибуток (P&L)</option><option value="CASH_FLOW">Cash Flow</option><option value="CATEGORY">Категорія</option></select></label><label>План, грн<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/></label>{metric==="CATEGORY"&&<label>Категорія<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Оберіть</option>{data.categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>}<label>Початок<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Кінець<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label></div><div className={styles.modalActions}><button className={styles.primaryButton} onClick={()=>onSave({name,metric,amount:Number(amount.replace(",",".")),categoryId:categoryId||null,locationId:locationId||null,periodStart:start,periodEnd:end})}>Зберегти бюджет</button></div></Modal>; }
function RecurringDialog({data,locationId,onClose,onSave}:{data:FinanceV2;locationId:string;onClose:()=>void;onSave:(payload:Record<string,unknown>)=>void}) { const [name,setName]=useState(""); const [direction,setDirection]=useState("OUTFLOW"); const [amount,setAmount]=useState(""); const [frequency,setFrequency]=useState("MONTHLY"); const [categoryId,setCategoryId]=useState(""); const [date,setDate]=useState(isoDate(new Date())); const [counterparty,setCounterparty]=useState(""); return <Modal title="Регулярна операція" onClose={onClose}><div className={styles.modalGrid}><label>Назва<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Напрям<select value={direction} onChange={e=>setDirection(e.target.value)}><option value="OUTFLOW">Виплата</option><option value="INFLOW">Надходження</option></select></label><label>Сума<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/></label><label>Періодичність<select value={frequency} onChange={e=>setFrequency(e.target.value)}><option value="WEEKLY">Щотижня</option><option value="MONTHLY">Щомісяця</option><option value="QUARTERLY">Щокварталу</option><option value="YEARLY">Щороку</option></select></label><label>Наступна дата<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Категорія<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Без категорії</option>{data.categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Контрагент<input value={counterparty} onChange={e=>setCounterparty(e.target.value)}/></label></div><div className={styles.modalActions}><button className={styles.primaryButton} onClick={()=>onSave({name,direction,amount:Number(amount.replace(",",".")),frequency,startAt:date,nextOccurrenceAt:date,categoryId:categoryId||null,counterpartyName:counterparty||null,locationId:locationId||null})}>Зберегти правило</button></div></Modal>; }
function CategoryDialog({data,onClose,onSave}:{data:FinanceV2;onClose:()=>void;onSave:(payload:Record<string,unknown>)=>void}) { const [name,setName]=useState(""); const [pnl,setPnl]=useState("OPEX"); const [cash,setCash]=useState("OPERATING"); const [parent,setParent]=useState(""); return <Modal title="Нова категорія" onClose={onClose}><div className={styles.modalGrid}><label>Назва<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Батьківська<select value={parent} onChange={e=>setParent(e.target.value)}><option value="">Немає</option>{data.categories.filter(c=>!c.parentId).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Секція P&L<select value={pnl} onChange={e=>setPnl(e.target.value)}><option value="">Не впливає на P&L</option><option value="COGS">COGS</option><option value="OPEX">OPEX</option><option value="OTHER_EXPENSE">Інші витрати</option><option value="TAX">Податки</option><option value="REVENUE">Виручка</option><option value="OTHER_INCOME">Інші доходи</option></select></label><label>Секція Cash Flow<select value={cash} onChange={e=>setCash(e.target.value)}><option value="OPERATING">Operating</option><option value="INVESTING">Investing</option><option value="FINANCING">Financing</option><option value="INTERNAL_TRANSFER">Internal transfer</option></select></label></div><div className={styles.modalActions}><button className={styles.primaryButton} onClick={()=>onSave({name,pnlSection:pnl||null,cashFlowSection:cash,parentId:parent||null})}>Створити категорію</button></div></Modal>; }
function SettingsDialog({data,locationId,onClose,onSave}:{data:FinanceV2;locationId:string;onClose:()=>void;onSave:(payload:Record<string,unknown>)=>void}) { const [reserve,setReserve]=useState(String(data.settings.minimumCashReserve)); const [fixed,setFixed]=useState(String(data.settings.fixedMonthlyCosts)); const [target,setTarget]=useState(String(data.settings.targetGrossMarginPercent)); const [warning,setWarning]=useState(String(data.settings.warningGrossMarginPercent)); const [horizon,setHorizon]=useState(String(data.settings.forecastHorizonDays)); return <Modal title="Фінансові налаштування" onClose={onClose}><div className={styles.modalGrid}><label>Мінімальний резерв<input value={reserve} onChange={e=>setReserve(e.target.value)} inputMode="decimal"/></label><label>Постійні витрати / місяць<input value={fixed} onChange={e=>setFixed(e.target.value)} inputMode="decimal"/></label><label>Цільова валова маржа, %<input value={target} onChange={e=>setTarget(e.target.value)} inputMode="decimal"/></label><label>Поріг уваги маржі, %<input value={warning} onChange={e=>setWarning(e.target.value)} inputMode="decimal"/></label><label>Горизонт прогнозу, днів<input value={horizon} onChange={e=>setHorizon(e.target.value)} inputMode="numeric"/></label></div><div className={styles.modalActions}><button className={styles.primaryButton} onClick={()=>onSave({locationId:locationId||null,minimumCashReserve:Number(reserve.replace(",",".")),fixedMonthlyCosts:Number(fixed.replace(",",".")),targetGrossMarginPercent:Number(target.replace(",",".")),warningGrossMarginPercent:Number(warning.replace(",",".")),forecastHorizonDays:Number(horizon)})}>Зберегти</button></div></Modal>; }
function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}) { return <div className={styles.modalBackdrop} role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className={`${styles.modal} ${wide ? styles.modalWide : ""}`} role="dialog" aria-modal="true"><div className={styles.modalHeader}><div><span className={styles.eyebrow}>ФІНАНСОВИЙ ЦЕНТР</span><h2>{title}</h2></div><button className={styles.iconButton} onClick={onClose}>✕</button></div>{children}</section></div>; }
