"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./vehicle-generation-catalog-panel.module.css";

type TopYear = { year: number; count: number };
type CatalogRow = {
  id: string;
  rank: number;
  make: string;
  model: string;
  vehicleCount: string;
  coveragePct: string;
  firstReliableYear: number | null;
  lastReliableYear: number | null;
  topYears: TopYear[];
  generationCount: number;
  generationStatus: "READY" | "NEEDS_REVIEW";
};
type Stats = {
  models: number;
  mappedModels: number;
  generations: number;
  vehiclesInTop100: string;
  vehiclesWithGenerationMap: string;
  sourceTotalRows: string;
  top100CoveragePct: number;
  mappedCoveragePct: number;
};
type Generation = {
  id: string;
  generationCode: string;
  generationLabel: string;
  fromYear: number;
  toYear: number;
  confidence: number;
  verificationStatus: string;
  notes?: string | null;
};

function number(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("uk-UA") : "0";
}
function pct(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : "0%";
}

export function VehicleGenerationCatalogPanel() {
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [generations, setGenerations] = useState<Record<string, Generation[]>>({});

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/vehicle-images/library/generations?limit=100", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { ok?: boolean; catalog?: CatalogRow[]; stats?: Stats; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося завантажити довідник поколінь.");
      setCatalog(payload.catalog || []);
      setStats(payload.stats || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося завантажити довідник поколінь.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/vehicle-images/library/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", limit: 100 }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; catalog?: CatalogRow[]; stats?: Stats; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося оновити ТОП-100.");
      setCatalog(payload.catalog || []);
      setStats(payload.stats || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося оновити ТОП-100.");
    } finally { setRefreshing(false); }
  }

  async function toggle(row: CatalogRow) {
    if (expanded === row.id) { setExpanded(null); return; }
    setExpanded(row.id);
    if (generations[row.id]) return;
    try {
      const params = new URLSearchParams({ make: row.make, model: row.model });
      const response = await fetch(`/api/vehicle-images/library/generations?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { ok?: boolean; generations?: Generation[] } | null;
      setGenerations((current) => ({ ...current, [row.id]: payload?.ok ? payload.generations || [] : [] }));
    } catch { setGenerations((current) => ({ ...current, [row.id]: [] })); }
  }

  const visible = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("uk-UA");
    if (!value) return catalog;
    return catalog.filter((row) => `${row.rank} ${row.make} ${row.model}`.toLocaleLowerCase("uk-UA").includes(value));
  }, [catalog, query]);

  return <section className={styles.panel}>
    <div className={styles.head}>
      <div><span className={styles.eyebrow}>БАЗА МВС → БІБЛІОТЕКА CRM</span><h3>ТОП-100 моделей і покоління</h3><p>CRM використовує цей довідник, щоб одна картинка покоління повторно працювала для всіх авто відповідних років. На перехідному році система не вгадує покоління — повертається до точного року.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={refreshing || loading}>{refreshing ? "Оновлюю…" : "Оновити ТОП-100"}</button>
    </div>

    {stats ? <div className={styles.stats}>
      <span><small>У базі</small><b>{number(stats.sourceTotalRows)}</b></span>
      <span><small>ТОП-100</small><b>{number(stats.vehiclesInTop100)}</b><em>{pct(stats.top100CoveragePct)}</em></span>
      <span><small>З картою поколінь</small><b>{stats.mappedModels}/{stats.models}</b><em>{pct(stats.mappedCoveragePct)}</em></span>
      <span><small>Поколінь у довіднику</small><b>{stats.generations}</b></span>
    </div> : null}

    <div className={styles.toolbar}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук: Passat, Focus, BMW…"/><span>{loading ? "Завантаження…" : `${visible.length} моделей`}</span></div>
    {error ? <div className={styles.error}>{error}</div> : null}

    <div className={styles.list}>
      {visible.map((row) => <div className={styles.item} key={row.id}>
        <button type="button" className={styles.row} onClick={() => void toggle(row)}>
          <b className={styles.rank}>{row.rank}</b>
          <span className={styles.identity}><strong>{row.make} {row.model}</strong><small>{row.firstReliableYear && row.lastReliableYear ? `масові роки ${row.firstReliableYear}–${row.lastReliableYear}` : "роки потребують перевірки"}</small></span>
          <span className={styles.volume}><strong>{number(row.vehicleCount)}</strong><small>{pct(row.coveragePct)} бази</small></span>
          <span className={row.generationStatus === "READY" ? styles.ready : styles.review}>{row.generationStatus === "READY" ? `${row.generationCount} покол.` : "потрібна карта"}</span>
          <span className={styles.chevron}>{expanded === row.id ? "⌃" : "⌄"}</span>
        </button>
        {expanded === row.id ? <div className={styles.detail}>
          <div className={styles.years}><b>Наймасовіші роки:</b>{row.topYears.map((item) => <span key={item.year}>{item.year} · {number(item.count)}</span>)}</div>
          <div className={styles.generations}>
            {(generations[row.id] || []).length ? (generations[row.id] || []).map((generation) => <span key={generation.id}><strong>{generation.generationLabel}</strong><small>{generation.fromYear}–{generation.toYear} · довіра {generation.confidence}% · {generation.verificationStatus === "VERIFIED" ? "перевірено" : "кураторський довідник"}</small></span>) : <span><strong>Покоління ще не описані</strong><small>Ця модель залишається в безпечному режимі «марка + модель + точний рік».</small></span>}
          </div>
        </div> : null}
      </div>)}
    </div>
  </section>;
}
