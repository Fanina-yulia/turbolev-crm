"use client";

import { useMemo, useState } from "react";
import type { FinanceDrilldownMetric } from "./financial-center-v3-control";
import styles from "./financial-center-v2.module.css";

export const OWNER_PROFIT_PLAN_MARKER = "OWNER_PROFIT_PLAN_V2|";

export type OwnerProfitBudget = {
  id: string;
  name: string;
  metric: string;
  amount: number;
  actual: number;
  variance: number;
  completionPercent: number | null;
  periodStart: string;
  periodEnd: string;
  notes?: string | null;
};

type FinanceData = {
  settings: { fixedMonthlyCosts: number; minimumCashReserve: number };
  kpi: { currentCash: number; receivables: number; payables: number; overdueReceivables: number; overduePayables: number };
  comparison: { revenue: { changePercent: number | null }; netProfit: { changePercent: number | null }; opex: { changePercent: number | null } };
  accounts: Array<{ id: string; name: string; type: string; balance: number }>;
  obligations: Array<{ id: string; direction: "RECEIVABLE" | "PAYABLE"; outstanding: number; dueAt: string | null; isOverdue: boolean }>;
  budgets: OwnerProfitBudget[];
  profitability: {
    services: Array<{ type: string; name: string; revenue: number; directCost: number; profit: number; count: number; marginPercent: number | null }>;
    mechanics: Array<{ mechanicId: string; name: string; position: string | null; revenue: number; directCost: number; profit: number; laborHours: number; lines: number; marginPercent: number | null }>;
  };
  ownerSummary?: {
    netIncome: number;
    serviceTurnover: number;
    partsMargin: number;
    totalExpenses: number;
    cash: number;
    partsRevenue: number;
    partsCost: number;
    expenseBreakdown: { payroll: number; otherDirect: number; otherOperating: number; otherExpense: number; tax: number };
  };
  ownerComparison?: {
    previousNetIncome: number;
    change: number;
    changePercent: number | null;
    drivers: Array<{ code: string; label: string; current: number; previous: number; impact: number }>;
  };
  control?: {
    today?: { date: string; revenue: number; cashIn: number; cashOut: number; netCashFlow: number };
    forecast?: {
      currentCash: number;
      in7Days: number;
      in30Days: number;
      in60Days?: number | null;
      in90Days?: number | null;
      forecastHorizonDate?: string | null;
      minimum: { date: string; closingCash: number } | null;
      firstGap: { date: string; closingCash: number } | null;
      firstReserveWarning: { date: string; closingCash: number } | null;
    };
  };
  alerts: Array<{ level: "INFO" | "WARNING" | "CRITICAL"; code: string; title: string; message: string; amount?: number; date?: string }>;
};

export type FinanceManagementPulse = {
  intelligence?: {
    paceForecast: number;
    conservativeForecast: number;
    weightedForecast: number;
    weightedGap: number | null;
    recommendations: string[];
    deviations: Array<{ code: string; severity: "INFO" | "WARNING" | "CRITICAL"; description: string; recommendedAction: string; impactAmount?: number | null; impactHours?: number | null }>;
  };
  capacity?: {
    totalMinutes: number;
    elapsedMinutes: number;
    freeLiftHours: number;
    posts: Array<{
      id: string;
      name: string;
      locationId: string;
      locationName: string;
      target: number | null;
      fact: number;
      weightedForecast: number;
      capacityMinutes: number;
      bookedMinutes: number;
      productiveMinutes: number;
      freeMinutes: number;
      utilizationPct: number | null;
      resultPerAvailableHour: number | null;
    }>;
  };
  people?: { averageMechanicUtilizationPct: number | null; activeMechanicsToday: number; unassignedActive: number };
  quality?: { grossMarginPct: number | null; partsMarginPct: number | null; warrantyRatePct: number | null; overdueReceivablePct: number; dataQualityPct: number };
};

type ProfitPlanMeta = {
  periodType: "MONTH" | "QUARTER";
  minimum: number | null;
  stretch: number | null;
};

function money(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}
function percent(value: number | null | undefined) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function dateOnly(value: string) { return value.slice(0, 10); }
function dateAtNoon(value: string) { return new Date(`${dateOnly(value)}T12:00:00Z`); }
function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function addDays(value: string, days: number) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function daysInclusive(from: string, to: string) {
  const start = dateAtNoon(from).getTime();
  const end = dateAtNoon(to).getTime();
  if (end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}
function clampDate(value: string, from: string, to: string) {
  return value < from ? from : value > to ? to : value;
}
function intersectionDays(aFrom: string, aTo: string, bFrom: string, bTo: string) {
  const start = aFrom > bFrom ? aFrom : bFrom;
  const end = aTo < bTo ? aTo : bTo;
  return end < start ? 0 : daysInclusive(start, end);
}
function monthBounds(anchor: string) {
  const date = dateAtNoon(anchor);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 12)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + 1, 0, 12)).toISOString().slice(0, 10);
  return { start, end };
}
function quarterBounds(anchor: string) {
  const date = dateAtNoon(anchor);
  const year = date.getUTCFullYear();
  const month = Math.floor(date.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(year, month, 1, 12)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + 3, 0, 12)).toISOString().slice(0, 10);
  return { start, end };
}
function weekBounds(anchor: string) {
  const date = dateAtNoon(anchor);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  const start = date.toISOString().slice(0, 10);
  return { start, end: addDays(start, 6) };
}
function parsePlanMeta(plan: OwnerProfitBudget | null): ProfitPlanMeta {
  if (!plan?.notes?.startsWith(OWNER_PROFIT_PLAN_MARKER)) return { periodType: daysInclusive(dateOnly(plan?.periodStart || dayKey()), dateOnly(plan?.periodEnd || dayKey())) > 45 ? "QUARTER" : "MONTH", minimum: null, stretch: null };
  try {
    const parsed = JSON.parse(plan.notes.slice(OWNER_PROFIT_PLAN_MARKER.length)) as Partial<ProfitPlanMeta>;
    return {
      periodType: parsed.periodType === "QUARTER" ? "QUARTER" : "MONTH",
      minimum: typeof parsed.minimum === "number" ? parsed.minimum : null,
      stretch: typeof parsed.stretch === "number" ? parsed.stretch : null,
    };
  } catch {
    return { periodType: "MONTH", minimum: null, stretch: null };
  }
}
export function findOwnerProfitPlan(budgets: OwnerProfitBudget[] | undefined) {
  const candidates = (budgets || []).filter((row) => row.metric === "NET_INCOME" && row.notes?.startsWith(OWNER_PROFIT_PLAN_MARKER));
  return candidates.sort((a, b) => daysInclusive(dateOnly(a.periodStart), dateOnly(a.periodEnd)) - daysInclusive(dateOnly(b.periodStart), dateOnly(b.periodEnd)))[0] || null;
}

function toneClass(state: "good" | "warn" | "bad" | "neutral") {
  return state === "good" ? styles.ownerQuestionGood : state === "warn" ? styles.ownerQuestionWarn : state === "bad" ? styles.ownerQuestionBad : "";
}

function PlanBand({ label, value, active }: { label: string; value: number | null; active?: boolean }) {
  return <div className={`${styles.ownerPlanBand} ${active ? styles.ownerPlanBandActive : ""}`}><span>{label}</span><strong>{money(value)}</strong></div>;
}

export function FinanceOwnerCommandCenter({
  data,
  planData,
  management,
  onCreatePlan,
  onMetric,
}: {
  data: FinanceData;
  planData: FinanceData | null;
  management: FinanceManagementPulse | null;
  onCreatePlan: () => void;
  onMetric: (metric: FinanceDrilldownMetric) => void;
}) {
  const facts = data.ownerSummary;
  const plan = findOwnerProfitPlan(data.budgets);
  const meta = parsePlanMeta(plan);
  const today = dayKey();
  const currentPlanFacts = planData?.ownerSummary || facts;
  const planMath = useMemo(() => {
    if (!plan) return null;
    const start = dateOnly(plan.periodStart);
    const end = dateOnly(plan.periodEnd);
    const totalDays = Math.max(1, daysInclusive(start, end));
    const elapsedDays = today < start ? 0 : today > end ? totalDays : daysInclusive(start, today);
    const remainingDays = Math.max(0, totalDays - elapsedDays);
    const actual = currentPlanFacts?.netIncome || 0;
    const expectedToNow = Math.round(plan.amount * elapsedDays / totalDays);
    const gapToPace = actual - expectedToNow;
    const remaining = Math.max(0, plan.amount - actual);
    const requiredPerDay = remainingDays > 0 ? remaining / remainingDays : remaining;
    const paceForecast = elapsedDays > 0 ? actual / elapsedDays * totalDays : 0;
    const month = monthBounds(clampDate(today, start, end));
    const week = weekBounds(clampDate(today, start, end));
    const monthDays = intersectionDays(start, end, month.start, month.end);
    const weekDays = intersectionDays(start, end, week.start, week.end);
    const monthTarget = plan.amount * monthDays / totalDays;
    const weekTarget = plan.amount * weekDays / totalDays;
    const dayTarget = plan.amount / totalDays;

    const sharedActual = currentPlanFacts
      ? currentPlanFacts.expenseBreakdown.otherOperating + currentPlanFacts.expenseBreakdown.otherExpense + currentPlanFacts.expenseBreakdown.tax
      : 0;
    const projectedShared = elapsedDays > 0
      ? sharedActual / elapsedDays * totalDays
      : data.settings.fixedMonthlyCosts * (totalDays / 30);
    const requiredContributionTotal = plan.amount + Math.max(0, projectedShared);
    const weekContributionTarget = requiredContributionTotal * weekDays / totalDays;
    return {
      start, end, totalDays, elapsedDays, remainingDays, actual, expectedToNow, gapToPace, remaining,
      requiredPerDay, paceForecast, monthTarget, weekTarget, dayTarget, weekContributionTarget,
      projectedShared,
    };
  }, [plan?.id, plan?.periodStart, plan?.periodEnd, plan?.amount, currentPlanFacts?.netIncome, currentPlanFacts?.expenseBreakdown.otherOperating, currentPlanFacts?.expenseBreakdown.otherExpense, currentPlanFacts?.expenseBreakdown.tax, data.settings.fixedMonthlyCosts, today]);

  const due30 = useMemo(() => {
    const horizon = addDays(today, 30);
    return data.obligations
      .filter((row) => row.direction === "PAYABLE" && (row.isOverdue || !row.dueAt || dateOnly(row.dueAt) <= horizon))
      .reduce((sum, row) => sum + row.outstanding, 0);
  }, [data.obligations, today]);
  const freeCash = data.kpi.currentCash - due30;
  const spendableCash = freeCash - data.settings.minimumCashReserve;
  const topService = [...data.profitability.services].sort((a, b) => b.profit - a.profit)[0] || null;
  const forecast30 = data.control?.forecast?.in30Days ?? data.kpi.currentCash;
  const firstGap = data.control?.forecast?.firstGap || null;

  const questions = [
    { label: "Скільки СТО реально заробило?", value: facts?.netIncome || 0, note: "чистий управлінський результат за вибраний період", tone: (facts?.netIncome || 0) >= 0 ? "good" as const : "bad" as const, metric: "ownerNetIncome" as FinanceDrilldownMetric },
    { label: "Де зараз гроші?", value: data.kpi.currentCash, note: `можна витратити після зобов’язань 30 днів і резерву ≈ ${money(spendableCash)}`, tone: spendableCash >= 0 ? "good" as const : freeCash >= 0 ? "warn" as const : "bad" as const, metric: "currentCash" as FinanceDrilldownMetric },
    { label: "Кому ми винні?", value: data.kpi.payables, note: `прострочено ${money(data.kpi.overduePayables)}`, tone: data.kpi.overduePayables > 0 ? "warn" as const : "neutral" as const, metric: "payables" as FinanceDrilldownMetric },
    { label: "Хто винен нам?", value: data.kpi.receivables, note: `прострочено ${money(data.kpi.overdueReceivables)}`, tone: data.kpi.overdueReceivables > 0 ? "warn" as const : "neutral" as const, metric: "receivables" as FinanceDrilldownMetric },
    { label: "На чому заробляємо найбільше?", value: topService?.profit || 0, note: topService ? `${topService.name} · маржа ${percent(topService.marginPercent)}` : "ще немає достатньо закритих робіт", tone: "good" as const },
    { label: "Чи вистачить грошей через 30 днів?", value: forecast30, note: firstGap ? `касовий розрив прогнозується ${dateOnly(firstGap.date)}` : "касового розриву в 30-денному горизонті не видно", tone: forecast30 < 0 || firstGap ? "bad" as const : forecast30 < data.settings.minimumCashReserve ? "warn" as const : "good" as const, metric: "currentCash" as FinanceDrilldownMetric },
  ];

  const actionRows = useMemo(() => {
    const rows = [
      ...(management?.intelligence?.recommendations || []),
      ...data.alerts.filter((row) => row.level !== "INFO").map((row) => row.message),
    ].filter((value, index, array) => value && array.indexOf(value) === index);
    return rows.slice(0, 5);
  }, [management, data.alerts]);

  const posts = useMemo(() => {
    const source = management?.capacity?.posts || [];
    if (!planMath || !source.length) return source.map((row) => ({ ...row, financeTarget: null as number | null, targetToNow: null as number | null, gap: null as number | null }));
    const totalCapacity = source.reduce((sum, row) => sum + Math.max(0, row.capacityMinutes), 0);
    const elapsedRatio = management?.capacity?.totalMinutes ? Math.min(1, Math.max(0, management.capacity.elapsedMinutes / management.capacity.totalMinutes)) : 0;
    return source.map((row) => {
      const financeTarget = totalCapacity > 0 ? planMath.weekContributionTarget * Math.max(0, row.capacityMinutes) / totalCapacity : planMath.weekContributionTarget / source.length;
      const targetToNow = financeTarget * elapsedRatio;
      return { ...row, financeTarget, targetToNow, gap: row.fact - targetToNow };
    }).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0));
  }, [management, planMath]);

  return <div className={styles.ownerCommandStack}>
    <section className={styles.ownerCommandPanel}>
      <div className={styles.ownerOverviewHeader}>
        <div><span className={styles.eyebrow}>ФІНАНСОВА КАРТИНА СТО</span><h2>6 відповідей власнику</h2><p>Не бухгалтерські терміни, а відповіді на питання про заробіток, гроші, борги, прибутковість і запас ліквідності.</p></div>
      </div>
      <div className={styles.ownerQuestionGrid}>
        {questions.map((row) => {
          const content = <><span>{row.label}</span><strong>{money(row.value)}</strong><small>{row.note}</small></>;
          return row.metric
            ? <button key={row.label} type="button" className={`${styles.ownerQuestion} ${toneClass(row.tone)}`} onClick={() => onMetric(row.metric!)}>{content}</button>
            : <div key={row.label} className={`${styles.ownerQuestion} ${toneClass(row.tone)}`}>{content}</div>;
        })}
      </div>
    </section>

    <section className={styles.ownerCommandPanel}>
      <div className={styles.ownerOverviewHeader}>
        <div><span className={styles.eyebrow}>ПЛАН ЧИСТОГО ПРИБУТКУ</span><h2>{plan ? `${meta.periodType === "QUARTER" ? "Квартальний" : "Місячний"} план · ${money(plan.amount)}` : "Задайте фінансову ціль"}</h2><p>CRM автоматично розкладає ціль на місяць, тиждень, день і потрібний внесок кожного активного підйомника.</p></div>
        <button type="button" className={styles.primaryButton} onClick={onCreatePlan}>{plan ? "Змінити план" : "+ Задати план"}</button>
      </div>
      {!plan || !planMath ? <div className={styles.empty}>План чистого прибутку ще не заданий. Після збереження тут з’являться темп, прогноз, відставання та розкладка до підйомників.</div> : <>
        <div className={styles.ownerProfitHero}>
          <div><span>Факт</span><strong>{money(planMath.actual)}</strong><small>мало бути на сьогодні {money(planMath.expectedToNow)}</small></div>
          <div><span>{planMath.gapToPace >= 0 ? "Випередження" : "Відставання"}</span><strong className={planMath.gapToPace >= 0 ? styles.positive : styles.negative}>{money(Math.abs(planMath.gapToPace))}</strong><small>{planMath.gapToPace >= 0 ? "вище необхідного темпу" : "нижче необхідного темпу"}</small></div>
          <div><span>Прогноз на кінець</span><strong>{money(planMath.paceForecast)}</strong><small>{planMath.paceForecast >= plan.amount ? "план виконується за поточним темпом" : `ризик недобору ${money(plan.amount - planMath.paceForecast)}`}</small></div>
          <div><span>Потрібно далі / день</span><strong>{money(planMath.requiredPerDay)}</strong><small>{planMath.remainingDays} днів до завершення плану</small></div>
        </div>
        <div className={styles.ownerProgressLarge}><i className={planMath.actual >= plan.amount ? styles.ownerProgressGood : planMath.actual >= planMath.expectedToNow * .9 ? styles.ownerProgressWarn : styles.ownerProgressBad} style={{ width: `${Math.min(100, Math.max(0, planMath.actual / plan.amount * 100))}%` }} /></div>
        <div className={styles.ownerPlanBands}>
          <PlanBand label="Мінімум" value={meta.minimum} active={meta.minimum != null && planMath.actual >= meta.minimum} />
          <PlanBand label="Ціль" value={plan.amount} active={planMath.actual >= plan.amount} />
          <PlanBand label="Амбіційний" value={meta.stretch} active={meta.stretch != null && planMath.actual >= meta.stretch} />
        </div>
        <div className={styles.ownerPlanScale}>
          <div><span>На поточний місяць</span><strong>{money(planMath.monthTarget)}</strong></div>
          <div><span>На поточний тиждень</span><strong>{money(planMath.weekTarget)}</strong></div>
          <div><span>На кожен день</span><strong>{money(planMath.dayTarget)}</strong></div>
          <div><span>Залишилось до цілі</span><strong>{money(planMath.remaining)}</strong></div>
        </div>
        {planMath.gapToPace < 0 && <div className={styles.ownerRecovery}>Щоб наздогнати план, з цього моменту потрібно в середньому <strong>{money(planMath.requiredPerDay)} чистого прибутку на день</strong>. CRM перераховує цей темп автоматично після кожної зміни факту.</div>}
      </>}
    </section>

    <div className={styles.ownerInsightGrid}>
      <section className={styles.ownerCommandPanel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>СЬОГОДНІ</span><h2>Фінансовий пульс</h2></div></div>
        <div className={styles.ownerPulseGrid}>
          <div><span>Нараховано</span><strong>{money(data.control?.today?.revenue)}</strong></div>
          <div><span>Грошей отримано</span><strong>{money(data.control?.today?.cashIn)}</strong></div>
          <div><span>Грошей виплачено</span><strong>{money(data.control?.today?.cashOut)}</strong></div>
          <div><span>Net Cash Flow</span><strong>{money(data.control?.today?.netCashFlow)}</strong></div>
        </div>
        <div className={styles.ownerInsightLine}><span>Оборот до попереднього періоду</span><strong>{percent(data.comparison.revenue.changePercent)}</strong></div>
        <div className={styles.ownerInsightLine}><span>Чистий прибуток до попереднього</span><strong>{percent(data.comparison.netProfit.changePercent)}</strong></div>
        {data.comparison.revenue.changePercent != null && data.comparison.netProfit.changePercent != null && data.comparison.revenue.changePercent > data.comparison.netProfit.changePercent + 5 && <div className={styles.ownerWarningLine}>Оборот росте швидше за прибуток. Перевірте маржу, зарплати та операційні витрати.</div>}
      </section>

      <section className={styles.ownerCommandPanel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>ЩО РОБИТИ ЗАРАЗ</span><h2>Дії для власника</h2></div></div>
        <div className={styles.ownerActionList}>{actionRows.length ? actionRows.map((row, index) => <div key={`${index}:${row}`}><b>{index + 1}</b><span>{row}</span></div>) : <div className={styles.ownerActionGood}>Критичних відхилень не виявлено. Контролюйте план, маржу і Cash In.</div>}</div>
      </section>
    </div>

    <div className={styles.ownerInsightGrid}>
      <section className={styles.ownerCommandPanel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>ЧОМУ ЗМІНИВСЯ ПРИБУТОК</span><h2>{data.ownerComparison ? `${money(data.ownerComparison.previousNetIncome)} → ${money(facts?.netIncome)}` : "Порівняння з попереднім періодом"}</h2><p>Не припущення: кожен вплив розрахований з тих самих ledger-фактів, що формують чистий управлінський результат.</p></div></div>
        {data.ownerComparison?.drivers?.length ? <div className={styles.ownerRankList}>{[...data.ownerComparison.drivers].sort((a,b) => Math.abs(b.impact)-Math.abs(a.impact)).map((row,index) => <div key={row.code}><b>#{index+1}</b><span><strong>{row.label}</strong><small>{money(row.previous)} → {money(row.current)}</small></span><strong className={row.impact >= 0 ? styles.positive : styles.negative}>{row.impact >= 0 ? "+" : ""}{money(row.impact)}</strong></div>)}</div> : <div className={styles.empty}>Для точного порівняння ще недостатньо даних попереднього періоду.</div>}
      </section>
      <section className={styles.ownerCommandPanel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>CASH 30 / 60 / 90</span><h2>Запас грошей уперед</h2><p>Прогноз із платіжного календаря; непокритий горизонт не підмінюється останньою відомою цифрою.</p></div></div>
        <div className={styles.ownerPulseGrid}>
          <div><span>Через 30 днів</span><strong>{money(data.control?.forecast?.in30Days)}</strong></div>
          <div><span>Через 60 днів</span><strong>{money(data.control?.forecast?.in60Days)}</strong></div>
          <div><span>Через 90 днів</span><strong>{money(data.control?.forecast?.in90Days)}</strong></div>
          <div><span>Можна витратити зараз</span><strong className={spendableCash >= 0 ? styles.positive : styles.negative}>{money(spendableCash)}</strong></div>
        </div>
        <div className={styles.ownerInsightLine}><span>Горизонт підтвердженого прогнозу</span><strong>{data.control?.forecast?.forecastHorizonDate ? dateOnly(data.control.forecast.forecastHorizonDate) : "—"}</strong></div>
        {data.control?.forecast?.firstGap && <div className={styles.ownerWarningLine}>Касовий розрив: {dateOnly(data.control.forecast.firstGap.date)} · прогнозний залишок {money(data.control.forecast.firstGap.closingCash)}.</div>}
      </section>
    </div>

    <section className={styles.ownerCommandPanel}>
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>ПІДЙОМНИКИ</span><h2>Де просідаємо по виробничій потужності</h2><p>Факт — операційний внесок робіт після прямих витрат. Спільні витрати СТО не приписуються підйомнику штучно; для цілі вони прогнозуються окремо.</p></div>{management?.capacity && <span className={styles.badge}>вільно ≈ {management.capacity.freeLiftHours.toFixed(1)} год</span>}</div>
      {!management?.capacity?.posts?.length ? <div className={styles.empty}>Дані по підйомниках завантажаться для Власника, коли є активні пости та прив’язані роботи.</div> : <div className={styles.ownerLiftGrid}>{posts.map((row) => {
        const state = row.gap == null ? "neutral" : row.gap >= 0 ? "good" : row.gap >= -(row.targetToNow || 0) * .15 ? "warn" : "bad";
        return <article key={row.id} className={`${styles.ownerLiftCard} ${toneClass(state)}`}>
          <div><span>{row.locationName}</span><h3>{row.name}</h3></div>
          <strong>{money(row.fact)}</strong>
          <small>операційний внесок · завантаження {percent(row.utilizationPct)}</small>
          {row.financeTarget != null && <><div className={styles.ownerLiftMeta}><span>Ціль внеску / тиждень</span><b>{money(row.financeTarget)}</b></div><div className={styles.ownerLiftMeta}><span>До темпу зараз</span><b className={(row.gap || 0) >= 0 ? styles.positive : styles.negative}>{row.gap == null ? "—" : `${row.gap >= 0 ? "+" : "−"}${money(Math.abs(row.gap))}`}</b></div></>}
          <div className={styles.ownerLiftMeta}><span>Вільно</span><b>{(row.freeMinutes / 60).toFixed(1)} год</b></div>
        </article>;
      })}</div>}
    </section>

    <div className={styles.ownerInsightGrid}>
      <section className={styles.ownerCommandPanel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>НАЙПРИБУТКОВІШІ РОБОТИ</span><h2>На чому варто заробляти більше</h2></div></div>
        <div className={styles.ownerRankList}>{[...data.profitability.services].sort((a,b) => b.profit-a.profit).slice(0,5).map((row,index) => <div key={`${row.type}:${row.name}`}><b>#{index+1}</b><span><strong>{row.name}</strong><small>{row.count} робіт · маржа {percent(row.marginPercent)}</small></span><strong>{money(row.profit)}</strong></div>)}</div>
      </section>
      <section className={styles.ownerCommandPanel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>МЕХАНІКИ</span><h2>Внесок команди</h2></div></div>
        <div className={styles.ownerRankList}>{[...data.profitability.mechanics].sort((a,b) => b.profit-a.profit).slice(0,5).map((row,index) => <div key={row.mechanicId}><b>#{index+1}</b><span><strong>{row.name}</strong><small>{row.lines} робіт · {row.laborHours.toFixed(1)} год · маржа {percent(row.marginPercent)}</small></span><strong>{money(row.profit)}</strong></div>)}</div>
      </section>
    </div>

    <OwnerScenarioLab data={data} />
  </div>;
}

function OwnerScenarioLab({ data }: { data: FinanceData }) {
  const [serviceGrowth, setServiceGrowth] = useState("10");
  const [partsMarginDelta, setPartsMarginDelta] = useState("5");
  const [extraOpex, setExtraOpex] = useState("0");
  const facts = data.ownerSummary;
  const servicePct = Number(serviceGrowth.replace(",", ".")) || 0;
  const marginPts = Number(partsMarginDelta.replace(",", ".")) || 0;
  const extra = Number(extraOpex.replace(",", ".")) || 0;
  const serviceEffect = (facts?.serviceTurnover || 0) * servicePct / 100;
  const partsEffect = (facts?.partsRevenue || 0) * marginPts / 100;
  const scenario = (facts?.netIncome || 0) + serviceEffect + partsEffect - extra;

  return <section className={styles.ownerCommandPanel}>
    <div className={styles.panelHeader}><div><span className={styles.eyebrow}>ЩО БУДЕ, ЯКЩО…</span><h2>Швидкий сценарій</h2><p>Оперативна управлінська оцінка, а не бухгалтерський прогноз. Допомагає перевірити рішення до того, як їх впроваджувати.</p></div></div>
    <div className={styles.ownerScenarioGrid}>
      <label>Послуги, зміна %<input inputMode="decimal" value={serviceGrowth} onChange={(event) => setServiceGrowth(event.target.value)} /></label>
      <label>Маржа деталей, + п.п.<input inputMode="decimal" value={partsMarginDelta} onChange={(event) => setPartsMarginDelta(event.target.value)} /></label>
      <label>Додаткові OPEX<input inputMode="decimal" value={extraOpex} onChange={(event) => setExtraOpex(event.target.value)} /></label>
      <div><span>Орієнтовний чистий результат</span><strong className={scenario >= 0 ? styles.positive : styles.negative}>{money(scenario)}</strong><small>{scenario >= (facts?.netIncome || 0) ? "+" : ""}{money(scenario - (facts?.netIncome || 0))} до поточного результату</small></div>
    </div>
  </section>;
}

export function OwnerProfitPlanDialog({
  budgets,
  onClose,
  onSave,
}: {
  budgets: OwnerProfitBudget[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const existing = findOwnerProfitPlan(budgets);
  const existingMeta = parsePlanMeta(existing);
  const [periodType, setPeriodType] = useState<"MONTH" | "QUARTER">(existingMeta.periodType);
  const [anchor, setAnchor] = useState(existing ? dateOnly(existing.periodStart) : dayKey());
  const [target, setTarget] = useState(existing ? String(existing.amount) : "");
  const [minimum, setMinimum] = useState(existingMeta.minimum == null ? "" : String(existingMeta.minimum));
  const [stretch, setStretch] = useState(existingMeta.stretch == null ? "" : String(existingMeta.stretch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bounds = periodType === "QUARTER" ? quarterBounds(anchor) : monthBounds(anchor);
  const match = budgets.find((row) => row.metric === "NET_INCOME" && row.notes?.startsWith(OWNER_PROFIT_PLAN_MARKER) && dateOnly(row.periodStart) === bounds.start && dateOnly(row.periodEnd) === bounds.end) || null;
  const targetNumber = Number(target.replace(",", ".")) || 0;
  const minNumber = minimum.trim() ? Number(minimum.replace(",", ".")) : Math.round(targetNumber * .85);
  const stretchNumber = stretch.trim() ? Number(stretch.replace(",", ".")) : Math.round(targetNumber * 1.2);

  async function save() {
    setError("");
    if (targetNumber <= 0) { setError("Вкажіть ціль чистого прибутку більше 0 грн."); return; }
    if (minNumber < 0 || minNumber > targetNumber) { setError("Мінімум має бути від 0 до цільового плану."); return; }
    if (stretchNumber < targetNumber) { setError("Амбіційний план не може бути нижчим за основну ціль."); return; }
    setBusy(true);
    try {
      const labelDate = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" }).format(dateAtNoon(bounds.start));
      await onSave({
        ...(match ? { id: match.id } : {}),
        name: periodType === "QUARTER" ? `План чистого прибутку · квартал від ${bounds.start}` : `План чистого прибутку · ${labelDate}`,
        metric: "NET_INCOME",
        amount: targetNumber,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        status: "ACTIVE",
        notes: OWNER_PROFIT_PLAN_MARKER + JSON.stringify({ periodType, minimum: minNumber, stretch: stretchNumber }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти план.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true">
      <div className={styles.modalHeader}><div><span className={styles.eyebrow}>ПЛАН ЧИСТОГО ПРИБУТКУ</span><h2>{match ? "Змінити фінансову ціль" : "Нова фінансова ціль"}</h2></div><button type="button" className={styles.iconButton} onClick={onClose}>✕</button></div>
      {error && <div className={styles.errorBox}>{error}</div>}
      <div className={styles.ownerPlanType}>
        <button type="button" className={periodType === "MONTH" ? styles.activeTab : ""} onClick={() => setPeriodType("MONTH")}>Місяць</button>
        <button type="button" className={periodType === "QUARTER" ? styles.activeTab : ""} onClick={() => setPeriodType("QUARTER")}>Квартал</button>
      </div>
      <div className={styles.modalGrid}>
        <label>Період<input type="month" value={anchor.slice(0,7)} onChange={(event) => setAnchor(`${event.target.value}-01`)} /></label>
        <label>Ціль чистого прибутку, грн<input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="300000" /></label>
        <label>Мінімум, грн<input inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder={targetNumber ? String(Math.round(targetNumber * .85)) : "85% від цілі"} /></label>
        <label>Амбіційний, грн<input inputMode="decimal" value={stretch} onChange={(event) => setStretch(event.target.value)} placeholder={targetNumber ? String(Math.round(targetNumber * 1.2)) : "120% від цілі"} /></label>
      </div>
      <div className={styles.ownerPlanPreview}>
        <span>Період: <strong>{bounds.start} — {bounds.end}</strong></span>
        <span>CRM автоматично перерахує місяць → тиждень → день → кожен підйомник за його доступною потужністю.</span>
      </div>
      <div className={styles.modalActions}><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? "Зберігаю…" : "Зберегти і розкласти план"}</button></div>
    </section>
  </div>;
}
