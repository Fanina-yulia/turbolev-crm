"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./analytics-quality.module.css";

type QualityPayload = {
  ok: boolean;
  permitted: boolean;
  emptyScope?: boolean;
  canWriteWarrantyCost?: boolean;
  error?: string;
  quality: null | {
    summary: {
      visits: number;
      qcWorkOrders: number;
      firstPassQcPct: number | null;
      qcDefectRatePct: number | null;
      reworkRatePct: number | null;
      warrantyClaims: number;
      warrantyClaimsPer100Visits: number | null;
      resolvedClaims: number;
      averageResolutionHours: number | null;
      repeatDefectPct: number | null;
      repeatDefects: number;
      warrantyCostUah: number | null;
      warrantyCostCoveragePct: number | null;
    };
    claims: Array<{
      claimId: string;
      status: string;
      reason: string;
      resolution: string | null;
      createdAt: string;
      closedAt: string | null;
      resolutionMinutes: number | null;
      repeatDefect: boolean;
      costCaptured: boolean;
      costUah: number | null;
      costFactCount: number;
      correctiveWorkOrderId: string | null;
      workOrderId: string;
      workOrderNumber: number | null;
      service: string;
      serviceCode: string | null;
      mechanicId: string | null;
      mechanicName: string | null;
      supplierId: string | null;
      vehicle: { id: string; plateNumber: string | null; brand: string | null; model: string | null; year: number | null };
    }>;
    mechanics: Array<{ mechanicId: string; name: string; claims: number; repeat: number; cost: number; costCapturedClaims: number }>;
    services: Array<{ key: string; label: string; claims: number; repeat: number; cost: number }>;
    semantics: Record<string, string>;
  };
};

type CostCategory = "LABOR" | "PART" | "EXTERNAL" | "OTHER";

function number(value: number | null | undefined, digits = 1) {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: digits }).format(value);
}
function percent(value: number | null | undefined) { return value == null ? "—" : `${number(value, 1)}%`; }
function money(value: number | null | undefined) { return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value)} ₴`; }
function duration(hours: number | null | undefined) {
  if (hours == null) return "—";
  if (hours >= 24) return `${number(hours / 24, 1)} д`;
  return `${number(hours, 1)} год`;
}
function vehicleTitle(row: QualityPayload["quality"] extends infer Q ? never : never) { return row; }
function formatVehicle(vehicle: { plateNumber: string | null; brand: string | null; model: string | null; year: number | null }) {
  const label = [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ");
  return vehicle.plateNumber ? `${vehicle.plateNumber} · ${label || "Авто"}` : label || "Автомобіль";
}
function dateText(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}
function Metric({ label, value, hint, alert = false }: { label: string; value: string; hint: string; alert?: boolean }) {
  return <article className={`${styles.metric} ${alert ? styles.metricAlert : ""}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

export function AnalyticsQualityPanel({ from, to, locationId }: { from: string; to: string; locationId: string }) {
  const [payload, setPayload] = useState<QualityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [costClaimId, setCostClaimId] = useState("");
  const [costCategory, setCostCategory] = useState<CostCategory>("LABOR");
  const [costAmount, setCostAmount] = useState("");
  const [costNote, setCostNote] = useState("");
  const [correctiveWorkOrderId, setCorrectiveWorkOrderId] = useState("");
  const [costSubmitting, setCostSubmitting] = useState(false);
  const [costError, setCostError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (locationId) params.set("locationId", locationId);
      const response = await fetch(`/api/analytics/quality?${params.toString()}`, { cache: "no-store" });
      const next = await response.json().catch(() => ({}));
      if (!response.ok || !next?.ok) throw new Error(next?.error || "Не вдалося завантажити аналітику якості");
      setPayload(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити аналітику якості");
    } finally {
      setLoading(false);
    }
  }, [from, to, locationId]);

  useEffect(() => { void load(); }, [load]);

  const quality = payload?.quality;
  const summary = quality?.summary;
  const selectedClaim = useMemo(() => quality?.claims.find((row) => row.claimId === costClaimId) ?? null, [quality, costClaimId]);

  async function saveCost(event: React.FormEvent) {
    event.preventDefault();
    if (!costClaimId) return;
    setCostSubmitting(true);
    setCostError("");
    try {
      const response = await fetch("/api/warranties/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimId: costClaimId,
          category: costCategory,
          amount: costAmount,
          note: costNote,
          correctiveWorkOrderId: correctiveWorkOrderId.trim() || null,
        }),
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok || !next?.ok) throw new Error(next?.error || "Не вдалося зафіксувати витрати");
      setCostClaimId("");
      setCostAmount("");
      setCostNote("");
      setCorrectiveWorkOrderId("");
      await load();
    } catch (cause) {
      setCostError(cause instanceof Error ? cause.message : "Не вдалося зафіксувати витрати");
    } finally {
      setCostSubmitting(false);
    }
  }

  if (payload && !payload.permitted) return <section className={styles.root}><div className={styles.state}>Немає доступу до quality/warranty analytics.</div></section>;

  return <section className={styles.root} data-quality-analytics="true">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>P2-02 · ЯКІСТЬ</span><h2>Якість ремонту та гарантії</h2><p>QC, повторні перевірки й гарантійні звернення зведені в один управлінський контур. Вартість гарантії показується тільки при повному cost-fact coverage.</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {loading && !quality && <div className={styles.state}>Збираю QC та гарантійні факти…</div>}
    {!loading && payload?.emptyScope && <div className={styles.state}>У вашому station-scope немає доступних СТО.</div>}

    {summary && <>
      <div className={styles.metrics}>
        <Metric label="QC first-pass" value={percent(summary.firstPassQcPct)} hint={`${summary.qcWorkOrders} WO із terminal QC`} />
        <Metric label="QC defect rate" value={percent(summary.qcDefectRatePct)} hint="FAILED/RECHECK на першій спробі" alert={(summary.qcDefectRatePct ?? 0) > 15} />
        <Metric label="Rework rate" value={percent(summary.reworkRatePct)} hint="WO із QC attempt > 1" alert={(summary.reworkRatePct ?? 0) > 10} />
        <Metric label="Гарантії / 100 візитів" value={summary.warrantyClaimsPer100Visits == null ? "—" : number(summary.warrantyClaimsPer100Visits, 2)} hint={`${summary.warrantyClaims} claims · ${summary.visits} закритих WO`} />
        <Metric label="Resolution time" value={duration(summary.averageResolutionHours)} hint={`${summary.resolvedClaims} закритих claims`} />
        <Metric label="Repeat defect" value={percent(summary.repeatDefectPct)} hint={`${summary.repeatDefects} повторних claims`} alert={(summary.repeatDefectPct ?? 0) > 10} />
        <Metric label="Warranty cost" value={money(summary.warrantyCostUah)} hint="лише immutable cost facts" />
        <Metric label="Cost coverage" value={percent(summary.warrantyCostCoveragePct)} hint="claims з повним cost fact" alert={(summary.warrantyCostCoveragePct ?? 100) < 100} />
      </div>

      {(summary.warrantyCostCoveragePct ?? 100) < 100 && <div className={styles.warning}><strong>Warranty cost приховано.</strong> Є гарантійні звернення без зафіксованого `WarrantyClaimCostFact`. CRM не підміняє фактичні витрати ціною первинного ремонту.</div>}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><span>CLAIMS</span><h3>Гарантійні випадки</h3></div><small>drill-down до Work Order</small></div>
          <div className={styles.claims}>{quality.claims.length ? quality.claims.map((row) => <article key={row.claimId} className={styles.claim}>
            <div className={styles.claimMain}><strong>{formatVehicle(row.vehicle)}</strong><span>{row.service}</span><small>{dateText(row.createdAt)} · {row.mechanicName || "механік не вказаний"} · {row.status}</small></div>
            <div className={styles.flags}><span className={row.repeatDefect ? styles.dangerFlag : styles.okFlag}>{row.repeatDefect ? "repeat" : "first claim"}</span><span>{row.costCaptured ? money(row.costUah) : "cost —"}</span></div>
            <div className={styles.actions}><button type="button" onClick={() => navigateCrm("Наряди та ремонт", { workOrderId: row.workOrderId })}>WO →</button>{payload.canWriteWarrantyCost && <button type="button" onClick={() => { setCostClaimId(row.claimId); setCostError(""); }}>+ витрати</button>}</div>
          </article>) : <div className={styles.state}>За період гарантійних звернень немає.</div>}</div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><span>HOTSPOTS</span><h3>Де накопичуються звернення</h3></div></div>
          <div className={styles.ranking}><h4>По механіках</h4>{quality.mechanics.slice(0, 8).map((row) => <div key={row.mechanicId}><span>{row.name}</span><b>{row.claims}</b><small>repeat {row.repeat} · captured {row.costCapturedClaims}</small></div>)}{!quality.mechanics.length && <small>Немає даних</small>}</div>
          <div className={styles.ranking}><h4>По роботах</h4>{quality.services.slice(0, 8).map((row) => <div key={row.key}><span>{row.label}</span><b>{row.claims}</b><small>repeat {row.repeat}</small></div>)}{!quality.services.length && <small>Немає даних</small>}</div>
        </section>
      </div>

      <details className={styles.methodology}><summary>Методологія KPI</summary>{Object.values(quality.semantics).map((text) => <p key={text}>{text}</p>)}</details>
    </>}

    {selectedClaim && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setCostClaimId(""); }}>
      <form className={styles.modal} onSubmit={saveCost}>
        <div className={styles.modalHead}><div><span>WARRANTY COST FACT</span><h3>Зафіксувати фактичні витрати</h3></div><button type="button" onClick={() => setCostClaimId("")}>×</button></div>
        <p>{formatVehicle(selectedClaim.vehicle)} · {selectedClaim.service}</p>
        <label><span>Категорія</span><select value={costCategory} onChange={(event) => setCostCategory(event.target.value as CostCategory)}><option value="LABOR">Робота</option><option value="PART">Запчастини</option><option value="EXTERNAL">Зовнішні роботи</option><option value="OTHER">Інше</option></select></label>
        <label><span>Фактична сума, грн</span><input required type="number" step="0.01" value={costAmount} onChange={(event) => setCostAmount(event.target.value)} placeholder="0.00" /></label>
        <label><span>Corrective Work Order ID · необов’язково</span><input value={correctiveWorkOrderId} onChange={(event) => setCorrectiveWorkOrderId(event.target.value)} placeholder="ID наряду, якщо гарантію усували окремим WO" /></label>
        <label><span>Коментар</span><textarea value={costNote} onChange={(event) => setCostNote(event.target.value)} placeholder="Що саме витрачено / причина коригування" /></label>
        {costError && <div className={styles.error}>{costError}</div>}
        <div className={styles.modalActions}><button type="button" onClick={() => setCostClaimId("")}>Скасувати</button><button type="submit" disabled={costSubmitting}>{costSubmitting ? "Зберігаю…" : "Зафіксувати факт"}</button></div>
      </form>
    </div>}
  </section>;
}
