"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./management-intelligence-panels.module.css";

export type ManagementIntelligenceUiPayload = {
  access?: { role?: string; canEditTarget?: boolean; canEditBonusFormula?: boolean; canDistribute?: boolean; canActivate?: boolean; canClose?: boolean; canRedistributeStation?: boolean };
  intelligence?: {
    paceForecast: number;
    conservativeForecast: number;
    weightedForecast: number;
    weightedGap: number | null;
    probabilities: Array<{ status: string; probability: number; sampleSize: number; completed: number }>;
    recommendations: string[];
    deviations: Array<{ code: string; severity: "INFO" | "WARNING" | "CRITICAL"; description: string; impactAmount?: number | null; impactHours?: number | null; impactClients?: number | null; recommendedAction: string }>;
  };
  capacity?: {
    totalMinutes: number;
    elapsedMinutes: number;
    freeLiftHours: number;
    posts: Array<{ id: string; name: string; locationId: string; locationName: string; target: number | null; fact: number; weightedForecast: number; capacityMinutes: number; bookedMinutes: number; productiveMinutes: number; freeMinutes: number; utilizationPct: number | null; resultPerAvailableHour: number | null; currentVehicle: string | null }>;
  };
  people?: {
    team: Array<{ employeeId: string; name: string; roleCode: string; roleName: string; locationId: string | null; shift: null | { id: string; status: string; startMinute: number | null; endMinute: number | null; note: string | null }; scheduleCoverageDays: number; availableMinutes: number | null; productiveMinutes: number; utilizationPct: number | null; normHours: number; target: number | null; actual: number; forecast: number; fullCost: number | null; netContribution: number | null; roiPct: number | null; kpiScore: number | null; overdueWork: number; reworkCount: number; currentTask: null | { appointmentId: string; status: string; workOrderId: string | null } }>;
    stationManagers: Array<{ employeeId: string; name: string; locationId: string | null; locationName: string; plan: number | null; fact: number; forecast: number; gap: number | null; kpiScore: number | null; preliminaryBonus: number; qualityPass: boolean }>;
    scheduleCoveragePct: number;
    averageMechanicUtilizationPct: number | null;
    activeMechanicsToday: number;
    unassignedActive: number;
    requiredMechanicHours?: number;
    scheduledMechanicHours?: number;
    staffingGapHours?: number;
  };
  quality?: { grossMarginPct: number | null; partsMarginPct: number | null; warrantyRatePct: number | null; overdueReceivablePct: number | null; dataQualityPct: number | null; warrantyClaims: number; overdueReceivable: number; receivableTotal: number; averageCheck: number | null; previousAverageCheck: number | null };
  bonus?: {
    locations: Array<{ locationId: string; locationName: string; scheme: { id: string | null; basis: string; activationThresholdPct: number; basePercent: number; fixedAmount: number | null; tier2ThresholdPct: number | null; tier2Percent: number | null; tier3ThresholdPct: number | null; tier3Percent: number | null; minMarginPct: number | null; maxWarrantyRatePct: number | null; maxOverdueReceivablePct: number | null; minDataQualityPct: number | null; capAmount: number | null }; quality: Record<string, number | null>; breakEven: number; activated: boolean; qualityPass: boolean; performancePct: number; qualityScorePct: number; appliedPercent: number; basisAmount: number; payoutAmount: number; gates: Array<{ code: string; enabled: boolean; pass: boolean; actual: number | null; threshold: number | null }> }>;
  };
  planning?: {
    dayAllocations: Array<{ id: string; locationId: string | null; day: string | null; targetAmount: number; source: string }>;
    postAllocations: Array<{ id: string; locationId: string | null; postId: string | null; targetAmount: number; source: string }>;
  };
};

type Mode = "OWNER" | "EXECUTIVE" | "STATION";
type CoreData = ManagementIntelligenceUiPayload & {
  range: { from: string; to: string };
  plan: null | { id: string; status: string; minimumAmount: number | null; targetAmount: number | null; stretchAmount: number | null; breakEvenAmount: number | null };
  result: { target: number | null; fact: number; cashIn: number; confirmedForecast: number; baseForecast: number; optimisticForecast: number; gap: number | null };
  locations: Array<{ id: string; name: string; target: number | null; fact: number; confirmedForecast: number; baseForecast: number; optimisticForecast: number; gap: number | null; progressPct: number | null; activePosts: number; capacityMinutes: number }>;
};

const SHIFT_STATUSES = [
  ["ON_SHIFT", "На зміні"], ["DAY_OFF", "Вихідний"], ["VACATION", "Відпустка"], ["SICK", "Лікарняний"], ["ABSENT", "Відсутній"], ["LATE", "Запізнення"], ["PARTIAL_SHIFT", "Неповна зміна"],
] as const;
const STATUS_LABELS: Record<string, string> = {
  BOOKED: "Запис", ARRIVED: "Приїхав", DIAGNOSTICS: "Діагностика", WAITING_PARTS_SELECTION: "Підбір деталей", WAITING_CALCULATION: "Калькуляція", WAITING_APPROVAL: "Погодження", WAITING_PARTS: "Очікує деталі", READY_FOR_REPAIR: "Готовий до ремонту", IN_REPAIR: "У ремонті", WAITING_QC: "QC", WAITING_PAYMENT: "Оплата", READY_FOR_PICKUP: "Видача",
};

function money(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}
function pct(value: number | null | undefined) { return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`; }
function hours(minutes: number | null | undefined) { return minutes == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(minutes / 60)} год`; }
function timeFromMinute(value: number | null | undefined) {
  if (value == null) return "";
  const h = Math.floor(value / 60); const m = value % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function minuteFromTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
function todayKyiv() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

async function jsonAction(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error || "Операція не виконана.");
  return result;
}

function StrategicPlanEditor({ data, weekAnchor, onRefresh }: { data: CoreData; weekAnchor: string; onRefresh: () => Promise<void> | void }) {
  const [draft, setDraft] = useState({ minimum: "", target: "", stretch: "", breakEven: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft({
    minimum: data.plan?.minimumAmount == null ? "" : String(Math.round(data.plan.minimumAmount)),
    target: data.plan?.targetAmount == null ? "" : String(Math.round(data.plan.targetAmount)),
    stretch: data.plan?.stretchAmount == null ? "" : String(Math.round(data.plan.stretchAmount)),
    breakEven: data.plan?.breakEvenAmount == null ? "" : String(Math.round(data.plan.breakEvenAmount)),
  }), [data.plan?.id, data.plan?.minimumAmount, data.plan?.targetAmount, data.plan?.stretchAmount, data.plan?.breakEvenAmount]);

  const payload = () => ({ week: weekAnchor, targetAmount: draft.target, minimumAmount: draft.minimum || null, stretchAmount: draft.stretch || null, breakEvenAmount: draft.breakEven || null, reason: "Параметри тижневого управлінського плану" });
  const save = async (approve: boolean) => {
    setBusy(true); setError("");
    try {
      if (approve) {
        await jsonAction("/api/management/plans", { action: "SAVE_AND_APPROVE", ...payload() });
      } else {
        await jsonAction("/api/management/plans", { action: "SAVE_DRAFT", ...payload() });
      }
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося зберегти план."); }
    finally { setBusy(false); }
  };
  if (["ACTIVE", "CLOSED"].includes(data.plan?.status || "")) return null;
  return <section className={styles.card}>
    <div className={styles.cardHead}><div><span>СТРАТЕГІЧНИЙ ПЛАН</span><h3>Minimum · Target · Stretch · Break-even</h3></div></div>
    <div className={styles.planEditor}>
      <label><span>Minimum</span><input inputMode="decimal" value={draft.minimum} onChange={(e) => setDraft((v) => ({ ...v, minimum: e.target.value }))} /></label>
      <label><span>Target</span><input inputMode="decimal" value={draft.target} onChange={(e) => setDraft((v) => ({ ...v, target: e.target.value }))} /></label>
      <label><span>Stretch</span><input inputMode="decimal" value={draft.stretch} onChange={(e) => setDraft((v) => ({ ...v, stretch: e.target.value }))} /></label>
      <label><span>Break-even</span><input inputMode="decimal" value={draft.breakEven} onChange={(e) => setDraft((v) => ({ ...v, breakEven: e.target.value }))} /></label>
    </div>
    {error && <div className={styles.inlineError}>{error}</div>}
    <div className={styles.rowActions}><button type="button" disabled={busy} onClick={() => void save(false)}>Зберегти чернетку</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void save(true)}>Затвердити план</button></div>
  </section>;
}

function StationDistributionEditor({ data, onRefresh }: { data: CoreData; onRefresh: () => Promise<void> | void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => setValues(Object.fromEntries(data.locations.map((row) => [row.id, row.target == null ? "" : String(Math.round(row.target))]))), [data.plan?.id, data.locations]);
  if (!data.plan || data.locations.length < 1 || ["ACTIVE", "CLOSED"].includes(data.plan.status)) return null;
  const save = async () => {
    setBusy(true); setError("");
    try {
      await jsonAction(`/api/management/plans/${data.plan!.id}/distribute`, { allocations: data.locations.map((row) => ({ locationId: row.id, targetAmount: values[row.id] })) });
      window.dispatchEvent(new CustomEvent("turbolev:data-changed")); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося розподілити план."); } finally { setBusy(false); }
  };
  return <section className={styles.card}>
    <div className={styles.cardHead}><div><span>РОЗПОДІЛ МЕРЕЖІ</span><h3>План по станціях</h3></div><b>{money(data.plan.targetAmount)}</b></div>
    <div className={styles.distribution}>{data.locations.map((row) => <label key={row.id}><span>{row.name}</span><input inputMode="decimal" value={values[row.id] || ""} onChange={(e) => setValues((v) => ({ ...v, [row.id]: e.target.value }))} /><small>{row.activePosts} підйомників</small></label>)}</div>
    {error && <div className={styles.inlineError}>{error}</div>}
    <div className={styles.rowActions}><button type="button" className={styles.primary} disabled={busy} onClick={() => void save()}>Зберегти розподіл</button></div>
  </section>;
}

function StationAllocationEditor({ data, locationId, onRefresh }: { data: CoreData; locationId: string; onRefresh: () => Promise<void> | void }) {
  const days = (data.planning?.dayAllocations || []).filter((row) => row.locationId === locationId);
  const posts = (data.planning?.postAllocations || []).filter((row) => row.locationId === locationId);
  const [dayValues, setDayValues] = useState<Record<string, string>>({});
  const [postValues, setPostValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    setDayValues(Object.fromEntries(days.map((row) => [row.id, String(Math.round(row.targetAmount))])));
    setPostValues(Object.fromEntries(posts.map((row) => [row.id, String(Math.round(row.targetAmount))])));
  }, [data.plan?.id, locationId, data.planning?.dayAllocations, data.planning?.postAllocations]);
  if (!data.plan || (!days.length && !posts.length) || data.plan.status === "CLOSED") return null;
  const save = async (level: "DAY" | "POST") => {
    setBusy(true); setError("");
    try {
      const rows = level === "DAY" ? days : posts; const values = level === "DAY" ? dayValues : postValues;
      await jsonAction(`/api/management/plans/${data.plan!.id}/redistribute`, { locationId, level, allocations: rows.map((row) => ({ id: row.id, targetAmount: values[row.id] })) });
      window.dispatchEvent(new CustomEvent("turbolev:data-changed")); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося перерозподілити план."); } finally { setBusy(false); }
  };
  const postName = new Map((data.capacity?.posts || []).map((row) => [row.id, row.name]));
  return <section className={styles.card}>
    <div className={styles.cardHead}><div><span>ВНУТРІШНІЙ ПЛАН СТАНЦІЇ</span><h3>Дні та підйомники</h3></div></div>
    <div className={styles.allocationSplit}>
      <div><h4>По днях</h4>{days.map((row) => <label key={row.id}><span>{row.day ? new Intl.DateTimeFormat("uk-UA", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${row.day}T12:00:00Z`)) : "День"}</span><input inputMode="decimal" value={dayValues[row.id] || ""} onChange={(e) => setDayValues((v) => ({ ...v, [row.id]: e.target.value }))} /></label>)}<button disabled={busy || !days.length} type="button" onClick={() => void save("DAY")}>Зберегти дні</button></div>
      <div><h4>По підйомниках</h4>{posts.map((row) => <label key={row.id}><span>{row.postId ? postName.get(row.postId) || "Підйомник" : "Підйомник"}</span><input inputMode="decimal" value={postValues[row.id] || ""} onChange={(e) => setPostValues((v) => ({ ...v, [row.id]: e.target.value }))} /></label>)}<button disabled={busy || !posts.length} type="button" onClick={() => void save("POST")}>Зберегти підйомники</button></div>
    </div>
    {error && <div className={styles.inlineError}>{error}</div>}
  </section>;
}

function ShiftEditor({ employee, range, onRefresh }: { employee: NonNullable<CoreData["people"]>["team"][number]; range: CoreData["range"]; onRefresh: () => Promise<void> | void }) {
  const today = todayKyiv();
  const editable = today >= range.from && today <= range.to && Boolean(employee.locationId);
  const [status, setStatus] = useState(employee.shift?.status || "ON_SHIFT");
  const [start, setStart] = useState(timeFromMinute(employee.shift?.startMinute));
  const [end, setEnd] = useState(timeFromMinute(employee.shift?.endMinute));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStatus(employee.shift?.status || "ON_SHIFT"); setStart(timeFromMinute(employee.shift?.startMinute)); setEnd(timeFromMinute(employee.shift?.endMinute)); }, [employee.shift?.id, employee.shift?.status, employee.shift?.startMinute, employee.shift?.endMinute]);
  if (!editable) return <span className={styles.shiftText}>{employee.shift ? SHIFT_STATUSES.find(([code]) => code === employee.shift?.status)?.[1] || employee.shift.status : "Графік не задано"}</span>;
  const save = async () => {
    setBusy(true);
    try { await jsonAction("/api/management/shifts", { employeeId: employee.employeeId, locationId: employee.locationId, day: today, status, startMinute: start ? minuteFromTime(start) : null, endMinute: end ? minuteFromTime(end) : null }); window.dispatchEvent(new CustomEvent("turbolev:data-changed")); await onRefresh(); } finally { setBusy(false); }
  };
  return <div className={styles.shiftEditor}><select value={status} onChange={(e) => setStatus(e.target.value)}>{SHIFT_STATUSES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Початок зміни" /><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Кінець зміни" /><button type="button" disabled={busy} onClick={() => void save()}>✓</button></div>;
}

function BonusSchemeEditor({ item, onRefresh }: { item: NonNullable<CoreData["bonus"]>["locations"][number]; onRefresh: () => Promise<void> | void }) {
  const [draft, setDraft] = useState({ activation: "", base: "", minMargin: "", maxWarranty: "", minQuality: "", cap: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft({ activation: String(item.scheme.activationThresholdPct), base: String(item.scheme.basePercent), minMargin: item.scheme.minMarginPct == null ? "" : String(item.scheme.minMarginPct), maxWarranty: item.scheme.maxWarrantyRatePct == null ? "" : String(item.scheme.maxWarrantyRatePct), minQuality: item.scheme.minDataQualityPct == null ? "" : String(item.scheme.minDataQualityPct), cap: item.scheme.capAmount == null ? "" : String(item.scheme.capAmount) }), [item.locationId, item.scheme.id, item.scheme.activationThresholdPct, item.scheme.basePercent, item.scheme.minMarginPct, item.scheme.maxWarrantyRatePct, item.scheme.minDataQualityPct, item.scheme.capAmount]);
  const save = async () => { setBusy(true); try { await jsonAction("/api/management/bonus", { action: "SAVE_SCHEME", locationId: item.locationId, basis: item.scheme.basis, activationThresholdPct: draft.activation, basePercent: draft.base, tier2ThresholdPct: item.scheme.tier2ThresholdPct, tier2Percent: item.scheme.tier2Percent, tier3ThresholdPct: item.scheme.tier3ThresholdPct, tier3Percent: item.scheme.tier3Percent, minMarginPct: draft.minMargin || null, maxWarrantyRatePct: draft.maxWarranty || null, maxOverdueReceivablePct: item.scheme.maxOverdueReceivablePct, minDataQualityPct: draft.minQuality || null, capAmount: draft.cap || null }); window.dispatchEvent(new CustomEvent("turbolev:data-changed")); await onRefresh(); } finally { setBusy(false); } };
  return <div className={styles.bonusEditor}><label><span>Активація %</span><input value={draft.activation} onChange={(e) => setDraft((v) => ({ ...v, activation: e.target.value }))} /></label><label><span>База %</span><input value={draft.base} onChange={(e) => setDraft((v) => ({ ...v, base: e.target.value }))} /></label><label><span>Min маржа %</span><input value={draft.minMargin} onChange={(e) => setDraft((v) => ({ ...v, minMargin: e.target.value }))} /></label><label><span>Max гарантія %</span><input value={draft.maxWarranty} onChange={(e) => setDraft((v) => ({ ...v, maxWarranty: e.target.value }))} /></label><label><span>Якість даних %</span><input value={draft.minQuality} onChange={(e) => setDraft((v) => ({ ...v, minQuality: e.target.value }))} /></label><label><span>Cap грн</span><input value={draft.cap} onChange={(e) => setDraft((v) => ({ ...v, cap: e.target.value }))} /></label><button type="button" disabled={busy} onClick={() => void save()}>Зберегти формулу</button></div>;
}

export function ManagementIntelligencePanels({ data, mode, weekAnchor, locationId, onRefresh }: { data: CoreData; mode: Mode; weekAnchor: string; locationId?: string | null; onRefresh: () => Promise<void> | void }) {
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedLocation = locationId || (mode === "STATION" ? data.locations[0]?.id : null);
  const topDeviations = useMemo(() => (data.intelligence?.deviations || []).slice(0, mode === "OWNER" ? 3 : 8), [data.intelligence?.deviations, mode]);
  const closePlan = async () => { if (!data.plan) return; setBusy(true); setActionError(""); try { await jsonAction(`/api/management/plans/${data.plan.id}/close`, { reason: "Закриття управлінського тижня" }); window.dispatchEvent(new CustomEvent("turbolev:data-changed")); await onRefresh(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Не вдалося закрити тиждень."); } finally { setBusy(false); } };
  const finalizeBonus = async (location: string) => { if (!data.plan) return; setBusy(true); setActionError(""); try { await jsonAction("/api/management/bonus", { action: "FINALIZE", planId: data.plan.id, locationId: location }); window.dispatchEvent(new CustomEvent("turbolev:data-changed")); await onRefresh(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Не вдалося фіналізувати бонус."); } finally { setBusy(false); } };

  return <div className={styles.stack}>
    {mode === "OWNER" && <StrategicPlanEditor data={data} weekAnchor={weekAnchor} onRefresh={onRefresh} />}
    {mode === "EXECUTIVE" && <StationDistributionEditor data={data} onRefresh={onRefresh} />}
    {mode === "STATION" && selectedLocation && <StationAllocationEditor data={data} locationId={selectedLocation} onRefresh={onRefresh} />}

    <div className={styles.twoCols}>
      <section className={styles.card}>
        <div className={styles.cardHead}><div><span>ПРОГНОЗ</span><h3>Темп · підтверджено · зважено</h3></div><b>{money(data.intelligence?.weightedForecast)}</b></div>
        <div className={styles.forecastGrid}><div><span>По темпу</span><strong>{money(data.intelligence?.paceForecast)}</strong></div><div><span>Консервативний</span><strong>{money(data.intelligence?.conservativeForecast)}</strong></div><div><span>Зважений</span><strong>{money(data.intelligence?.weightedForecast)}</strong></div><div><span>Gap зважений</span><strong>{money(data.intelligence?.weightedGap)}</strong></div></div>
        <div className={styles.probabilities}>{(data.intelligence?.probabilities || []).filter((row) => row.sampleSize > 0).slice(-6).map((row) => <div key={row.status}><span>{STATUS_LABELS[row.status] || row.status}</span><b>{pct(row.probability * 100)}</b><small>n={row.sampleSize}</small></div>)}</div>
      </section>
      <section className={styles.card}>
        <div className={styles.cardHead}><div><span>ЩО ЗАВАЖАЄ ПЛАНУ</span><h3>Причини та рекомендовані дії</h3></div><b>{topDeviations.length}</b></div>
        <div className={styles.deviationList}>{topDeviations.length ? topDeviations.map((row) => <article key={row.code} className={styles[`severity_${row.severity}`]}><div><strong>{row.description}</strong><small>{[row.impactAmount ? money(row.impactAmount) : null, row.impactHours ? `${row.impactHours} год` : null, row.impactClients ? `${row.impactClients} клієнт.` : null].filter(Boolean).join(" · ")}</small></div><span>{row.recommendedAction}</span></article>) : <div className={styles.empty}>Критичних відхилень не визначено.</div>}</div>
        {!!data.intelligence?.recommendations?.length && <ol className={styles.recommendations}>{data.intelligence.recommendations.map((row) => <li key={row}>{row}</li>)}</ol>}
      </section>
    </div>

    <section className={styles.card}>
      <div className={styles.cardHead}><div><span>ПОТУЖНІСТЬ</span><h3>Підйомники: план, факт, прогноз, завантаження</h3></div><b>{data.capacity ? `${Math.round(data.capacity.freeLiftHours * 10) / 10} вільн. год` : "—"}</b></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Підйомник</th><th>План</th><th>Факт</th><th>Зважений прогноз</th><th>Завантаження</th><th>Вільно</th><th>₴/дост. год</th></tr></thead><tbody>{(data.capacity?.posts || []).map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.locationName}</small></td><td>{money(row.target)}</td><td>{money(row.fact)}</td><td>{money(row.weightedForecast)}</td><td>{pct(row.utilizationPct)}</td><td>{hours(row.freeMinutes)}</td><td>{money(row.resultPerAvailableHour)}</td></tr>)}</tbody></table></div>
    </section>

    <section className={styles.card}>
      <div className={styles.cardHead}><div><span>КОМАНДА</span><h3>Графік · продуктивність · економіка</h3></div><b>{data.people?.team.length || 0} людей</b></div>
      <div className={styles.peopleSummary}><span>Графік заповнений <b>{pct(data.people?.scheduleCoveragePct)}</b></span><span>Механіки завантажені <b>{pct(data.people?.averageMechanicUtilizationPct)}</b></span><span>Без механіка <b>{data.people?.unassignedActive ?? 0}</b></span>{data.people?.staffingGapHours != null && <span>Дефіцит зміни <b>{data.people.staffingGapHours > 0 ? `${data.people.staffingGapHours} год` : "немає"}</b></span>}</div>
      <div className={styles.tableWrap}><table><thead><tr><th>Працівник</th><th>Зміна</th><th>Завантаження</th><th>Нормо-год</th><th>План</th><th>Факт</th><th>Прогноз</th><th>KPI</th><th>Внесок / ROI</th></tr></thead><tbody>{(data.people?.team || []).map((row) => <tr key={`${row.employeeId}:${row.locationId || "all"}`}><td><strong>{row.name}</strong><small>{row.roleName}</small></td><td>{mode === "STATION" ? <ShiftEditor employee={row} range={data.range} onRefresh={onRefresh} /> : <span className={styles.shiftText}>{row.shift ? SHIFT_STATUSES.find(([code]) => code === row.shift?.status)?.[1] || row.shift.status : "не задано"}</span>}</td><td>{pct(row.utilizationPct)}<small>{hours(row.productiveMinutes)} продуктивно</small></td><td>{row.normHours.toFixed(1)}</td><td>{money(row.target)}</td><td>{money(row.actual)}</td><td>{money(row.forecast)}</td><td>{pct(row.kpiScore)}</td><td>{money(row.netContribution)}<small>ROI {pct(row.roiPct)}</small></td></tr>)}</tbody></table></div>
    </section>

    {mode !== "STATION" && !!data.people?.stationManagers?.length && <section className={styles.card}>
      <div className={styles.cardHead}><div><span>КЕРІВНИКИ СТАНЦІЙ</span><h3>План, прогноз, KPI, бонус</h3></div></div>
      <div className={styles.managerGrid}>{data.people.stationManagers.map((row) => <article key={row.employeeId}><div><strong>{row.name}</strong><small>{row.locationName}</small></div><span>План <b>{money(row.plan)}</b></span><span>Факт <b>{money(row.fact)}</b></span><span>Прогноз <b>{money(row.forecast)}</b></span><span>Gap <b>{money(row.gap)}</b></span><span>KPI <b>{pct(row.kpiScore)}</b></span><span>Бонус <b>{money(row.preliminaryBonus)}</b></span></article>)}</div>
    </section>}

    {!!data.bonus?.locations?.length && <section className={styles.card}>
      <div className={styles.cardHead}><div><span>МОТИВАЦІЯ КЕРІВНИКА СТАНЦІЇ</span><h3>Попередній бонус і quality gates</h3></div></div>
      <div className={styles.bonusList}>{data.bonus.locations.filter((row) => !selectedLocation || row.locationId === selectedLocation).map((row) => <article key={row.locationId} className={row.qualityPass ? styles.bonusGood : styles.bonusBlocked}><div className={styles.bonusTitle}><div><strong>{row.locationName}</strong><small>{row.activated ? "поріг виконано" : "поріг ще не виконано"} · quality {pct(row.qualityScorePct)}</small></div><b>{money(row.payoutAmount)}</b></div><div className={styles.gates}>{row.gates.filter((gate) => gate.enabled).map((gate) => <span key={gate.code} className={gate.pass ? styles.gatePass : styles.gateFail}>{gate.code} · {gate.actual == null ? "n/a" : pct(gate.actual)} / {gate.threshold == null ? "—" : pct(gate.threshold)}</span>)}</div>{mode === "OWNER" && <BonusSchemeEditor item={row} onRefresh={onRefresh} />}{data.plan?.status === "CLOSED" && (mode === "OWNER" || mode === "EXECUTIVE") && <button type="button" className={styles.finalize} disabled={busy} onClick={() => void finalizeBonus(row.locationId)}>Фіналізувати бонус</button>}</article>)}</div>
    </section>}

    {actionError && <div className={styles.inlineError}>{actionError}</div>}
    {data.plan?.status === "ACTIVE" && (mode === "OWNER" || mode === "EXECUTIVE") && <div className={styles.closeBar}><span>Після завершення тижня закрийте план — Target і факт залишаться в audit trail, а бонус можна буде фіналізувати.</span><button type="button" disabled={busy} onClick={() => void closePlan()}>Закрити тиждень</button></div>}
  </div>;
}
