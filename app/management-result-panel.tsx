"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { weekKeys } from "@/src/domain/management-result";
import styles from "./management-result-panel.module.css";

type ManagementMode = "OWNER" | "EXECUTIVE" | "STATION";

type ResultPayload = {
  ok: true;
  range: { from: string; to: string; timezone: string; days: number };
  plan: null | {
    id: string;
    status: string;
    currency: string;
    minimumAmount: number | null;
    targetAmount: number | null;
    stretchAmount: number | null;
    breakEvenAmount: number | null;
  };
  result: {
    target: number | null;
    targetToNow: number | null;
    fact: number;
    cashIn: number;
    progressPct: number | null;
    confirmedForecast: number;
    baseForecast: number;
    optimisticForecast: number;
    gap: number | null;
    requiredPerDay: number | null;
    requiredPerLiftDay: number | null;
    remainingDays: number;
    activePosts: number;
  };
  breakdown: {
    workOrderFact: number;
    directServiceFact: number;
    confirmedPipeline: number;
    basePipeline: number;
    optimisticPipeline: number;
  };
  locations: Array<{
    id: string;
    name: string;
    target: number | null;
    fact: number;
    confirmedForecast: number;
    baseForecast: number;
    optimisticForecast: number;
    gap: number | null;
    progressPct: number | null;
    activePosts: number;
    capacityMinutes: number;
  }>;
  dataQuality: {
    finalizedWorkOrders: number;
    closedWithoutFinalFinance: number;
    pipelineWithoutPlannedFinance: number;
    forecastCompleteness: "PARTIAL" | "COMPLETE";
  };
  access?: { role?: string; canEditTarget?: boolean; canActivate?: boolean };
};

function currentKyivDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftDayKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}

function dateRange(from?: string, to?: string) {
  if (!from || !to) return "";
  const format = (value: string) => new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00Z`));
  return `${format(from)} — ${format(to)}`;
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    DRAFT: "Чернетка",
    OWNER_APPROVED: "Затверджено Власником",
    EXECUTIVE_DISTRIBUTED: "Розподілено",
    STATION_ACCEPTED: "Прийнято станціями",
    ACTIVE: "Активний",
    CLOSED: "Закритий",
  };
  return status ? labels[status] || status : "План не задано";
}

function progressTone(value: number | null) {
  if (value == null) return "neutral";
  if (value >= 100) return "good";
  if (value >= 85) return "warning";
  return "danger";
}

export function ManagementResultPanel({ mode, locationId }: { mode: ManagementMode; locationId?: string | null }) {
  const [weekAnchor, setWeekAnchor] = useState(currentKyivDateKey);
  const [data, setData] = useState<ResultPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [saving, setSaving] = useState(false);
  const currentWeek = useMemo(() => weekKeys(currentKyivDateKey()).start, []);
  const selectedWeek = weekKeys(weekAnchor).start;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ week: weekAnchor });
      if (locationId) query.set("locationId", locationId);
      const response = await fetch(`/api/management/result?${query.toString()}`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null) as ResultPayload | { error?: string } | null;
      if (!response.ok || !body || body.ok !== true) throw new Error(body && "error" in body && body.error ? body.error : "Не вдалося завантажити план.");
      const payload = body as ResultPayload;
      setData(payload);
      setTargetInput(payload.plan?.targetAmount != null ? String(Math.round(payload.plan.targetAmount)) : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити план.");
    } finally {
      setLoading(false);
    }
  }, [weekAnchor, locationId]);

  useEffect(() => {
    void load();
    const handler = () => void load();
    window.addEventListener("turbolev:data-changed", handler);
    return () => window.removeEventListener("turbolev:data-changed", handler);
  }, [load]);

  const saveTarget = async () => {
    const target = Number(targetInput.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(target) || target <= 0) {
      setError("Вкажіть план більше 0 грн.");
      return;
    }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/management/plans", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SAVE_AND_APPROVE", week: weekAnchor, targetAmount: target }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не вдалося зберегти план.");
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти план.");
    } finally {
      setSaving(false);
    }
  };

  const planAction = async (action: "ACTIVATE" | "ACCEPT") => {
    if (!data?.plan?.id) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/management/plans", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, planId: data.plan.id }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не вдалося змінити статус плану.");
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося змінити статус плану.");
    } finally {
      setSaving(false);
    }
  };

  const progress = data?.result.progressPct ?? null;
  const gauge = Math.max(0, Math.min(120, progress || 0));
  const forecastGap = data?.result.gap ?? null;
  const isCurrentWeek = selectedWeek === currentWeek;
  const canEdit = mode === "OWNER" && isCurrentWeek && data?.plan?.status !== "ACTIVE" && data?.plan?.status !== "CLOSED";
  const qualityWarning = (data?.dataQuality.closedWithoutFinalFinance || 0) + (data?.dataQuality.pipelineWithoutPlannedFinance || 0);

  return <section className={`${styles.panel} ${mode === "STATION" ? styles.stationMode : ""}`} aria-label="План факт прогноз">
    <div className={styles.head}>
      <div>
        <span className={styles.eyebrow}>УПРАВЛІННЯ РЕЗУЛЬТАТОМ</span>
        <h2>План → Факт → Прогноз</h2>
        <small>{data ? dateRange(data.range.from, data.range.to) : dateRange(weekKeys(weekAnchor).start, weekKeys(weekAnchor).end)} · {statusLabel(data?.plan?.status)}</small>
      </div>
      <div className={styles.weekNav}>
        <button type="button" onClick={() => setWeekAnchor((value) => shiftDayKey(value, -7))} aria-label="Попередній тиждень">‹</button>
        <button type="button" className={isCurrentWeek ? styles.weekCurrent : ""} onClick={() => setWeekAnchor(currentKyivDateKey())}>Цей тиждень</button>
        <button type="button" onClick={() => setWeekAnchor((value) => shiftDayKey(value, 7))} aria-label="Наступний тиждень">›</button>
      </div>
    </div>

    {error && <div className={styles.error}>{error}<button type="button" onClick={() => void load()}>Повторити</button></div>}

    {canEdit && <div className={styles.targetEditor}>
      <label><span>План тижня</span><div><input inputMode="decimal" value={targetInput} onChange={(event) => setTargetInput(event.target.value)} placeholder="100000" /><b>грн</b></div></label>
      <button type="button" onClick={() => void saveTarget()} disabled={saving}>{saving ? "Зберігаю…" : data?.plan ? "Оновити план" : "Задати план"}</button>
      <small>CRM автоматично розподілить ціль між активними станціями, підйомниками та днями за доступною потужністю.</small>
    </div>}

    {loading && !data ? <div className={styles.loading}>Рахую план, факт і прогноз…</div> : data && <>
      <div className={styles.kpis}>
        <div><span>План тижня</span><strong>{money(data.result.target)}</strong><small>{data.result.target == null ? "ще не задано" : `${data.result.activePosts} активних підйомників`}</small></div>
        <div><span>План на зараз</span><strong>{money(data.result.targetToNow)}</strong><small>за доступним часом поточного тижня</small></div>
        <div><span>Факт</span><strong>{money(data.result.fact)}</strong><small>вироблено результату · Cash In {money(data.result.cashIn)}</small></div>
        <div><span>Підтверджений прогноз</span><strong>{money(data.result.confirmedForecast)}</strong><small>факт + високонадійний pipeline</small></div>
        <div><span>Базовий прогноз</span><strong>{money(data.result.baseForecast)}</strong><small>з урахуванням погодження/деталей</small></div>
        <div className={forecastGap && forecastGap > 0 ? styles.kpiGap : styles.kpiGood}><span>До плану</span><strong>{money(forecastGap)}</strong><small>{forecastGap && forecastGap > 0 ? `${money(data.result.requiredPerDay)}/день · ${money(data.result.requiredPerLiftDay)}/підйомник-день` : data.result.target == null ? "спочатку задайте ціль" : "підтверджений прогноз закриває план"}</small></div>
      </div>

      <div className={styles.progressBlock}>
        <div className={styles.progressMeta}><span>Виконання фактом</span><strong className={styles[`tone_${progressTone(progress)}`]}>{percent(progress)}</strong></div>
        <div className={styles.track}><i className={styles[`bar_${progressTone(progress)}`]} style={{ width: `${Math.min(100, gauge)}%` }} /></div>
        <div className={styles.forecastStrip}>
          <span><i className={styles.dotFact} />Факт <b>{money(data.result.fact)}</b></span>
          <span><i className={styles.dotConfirmed} />Підтверджено <b>{money(data.result.confirmedForecast)}</b></span>
          <span><i className={styles.dotBase} />Базовий <b>{money(data.result.baseForecast)}</b></span>
          <span><i className={styles.dotOptimistic} />Оптимістичний <b>{money(data.result.optimisticForecast)}</b></span>
        </div>
      </div>

      {mode !== "STATION" && data.locations.length > 0 && <div className={styles.locations}>
        <div className={styles.subhead}><strong>Станції</strong><span>одна формула · різний scope</span></div>
        {data.locations.map((location) => <div className={styles.locationRow} key={location.id}>
          <div><strong>{location.name}</strong><small>{location.activePosts} підйомн. · {Math.round(location.capacityMinutes / 60)} год потужності/тиждень</small></div>
          <span><small>План</small><b>{money(location.target)}</b></span>
          <span><small>Факт</small><b>{money(location.fact)}</b></span>
          <span><small>Прогноз</small><b>{money(location.confirmedForecast)}</b></span>
          <span className={location.gap && location.gap > 0 ? styles.locationGap : styles.locationGood}><small>Gap</small><b>{money(location.gap)}</b></span>
          <em>{percent(location.progressPct)}</em>
        </div>)}
      </div>}

      <div className={styles.foot}>
        <div><span>Структура факту</span><b>роботи/маржа деталей {money(data.breakdown.workOrderFact)} · прямі діагностики {money(data.breakdown.directServiceFact)}</b></div>
        {qualityWarning > 0 ? <div className={styles.dataWarning}><span>Якість даних</span><b>{data.dataQuality.closedWithoutFinalFinance} закритих без фінфакту · {data.dataQuality.pipelineWithoutPlannedFinance} у pipeline без суми</b></div> : <div className={styles.dataOk}><span>Якість даних</span><b>суми для поточного розрахунку заповнені</b></div>}
      </div>

      <div className={styles.actions}>
        {data.plan && (mode === "OWNER" || mode === "EXECUTIVE") && !["ACTIVE", "CLOSED"].includes(data.plan.status) && <button type="button" onClick={() => void planAction("ACTIVATE")} disabled={saving}>Активувати план</button>}
        {data.plan && mode === "STATION" && !["ACTIVE", "CLOSED"].includes(data.plan.status) && <button type="button" onClick={() => void planAction("ACCEPT")} disabled={saving}>Прийняти план станції</button>}
        <span>Факт ≠ Cash In: виробничий результат і реально отримані гроші показуються окремо.</span>
      </div>
    </>}
  </section>;
}
