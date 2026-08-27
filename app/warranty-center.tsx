"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./warranty-center.module.css";

type ClaimStatus = "OPEN" | "REVIEW" | "APPROVED" | "REJECTED" | "CLOSED";
type WarrantyStatus = "PENDING_START" | "ACTIVE" | "EXPIRING" | "EXPIRED";
type WarrantyClaim = {
  id: string;
  status: ClaimStatus;
  reason: string;
  mileageKmAtClaim: number | null;
  resolution: string | null;
  openedByName: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type WarrantyRow = {
  lineId: string;
  workOrderId: string;
  workOrderNumber: number | null;
  workOrderLabel: string;
  workOrderStatus: string;
  workOrderClosedAt: string | null;
  description: string;
  code: string | null;
  warrantyKm: number | null;
  warrantyDays: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  mileageStartKm: number | null;
  mileageLimitKm: number | null;
  currentMileageKm: number | null;
  daysRemaining: number | null;
  kmRemaining: number | null;
  warrantyStatus: WarrantyStatus;
  expiredByTime: boolean;
  expiredByMileage: boolean;
  client: { id: string; name: string | null; phone: string };
  vehicle: { id: string; plateNumber: string | null; vin: string | null; brand: string | null; model: string | null; year: number | null; mileageKm: number | null };
  openClaim: WarrantyClaim | null;
  claims: WarrantyClaim[];
};
type WarrantyResponse = {
  ok: boolean;
  rows?: WarrantyRow[];
  counts?: { active: number; expiring: number; claims: number; expired: number };
  canWrite?: boolean;
  error?: string;
};
type TabId = "active" | "expiring" | "claims" | "expired";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "active", label: "Активні" },
  { id: "expiring", label: "Закінчуються" },
  { id: "claims", label: "Звернення" },
  { id: "expired", label: "Завершені" },
];
const CLAIM_LABELS: Record<ClaimStatus, string> = {
  OPEN: "Нове",
  REVIEW: "На перевірці",
  APPROVED: "Погоджено",
  REJECTED: "Відхилено",
  CLOSED: "Закрито",
};
const CLAIM_OPTIONS: Array<{ value: ClaimStatus; label: string }> = [
  { value: "OPEN", label: "Нове" },
  { value: "REVIEW", label: "На перевірці" },
  { value: "APPROVED", label: "Погоджено" },
  { value: "REJECTED", label: "Відхилено" },
  { value: "CLOSED", label: "Закрито" },
];

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function dateTimeText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function numberText(value: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("uk-UA").format(value);
}

function vehicleTitle(row: WarrantyRow) {
  return [row.vehicle.brand, row.vehicle.model, row.vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function warrantyLabel(row: WarrantyRow) {
  if (row.warrantyStatus === "PENDING_START") return "Очікує старту";
  if (row.warrantyStatus === "EXPIRING") return "Закінчується";
  if (row.warrantyStatus === "EXPIRED") return "Завершена";
  return "Активна";
}

function warrantyClass(row: WarrantyRow) {
  if (row.warrantyStatus === "EXPIRING") return styles.expiring;
  if (row.warrantyStatus === "EXPIRED") return styles.expired;
  return styles.active;
}

export function WarrantyCenter() {
  const [tab, setTab] = useState<TabId>("active");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<WarrantyResponse>({ ok: true, rows: [], counts: { active: 0, expiring: 0, claims: 0, expired: 0 }, canWrite: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [claimRow, setClaimRow] = useState<WarrantyRow | null>(null);
  const [claimReason, setClaimReason] = useState("");
  const [claimMileage, setClaimMileage] = useState("");
  const [claimError, setClaimError] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [editRow, setEditRow] = useState<WarrantyRow | null>(null);
  const [editStatus, setEditStatus] = useState<ClaimStatus>("REVIEW");
  const [editResolution, setEditResolution] = useState("");
  const [editError, setEditError] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/warranties${params.size ? `?${params}` : ""}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as WarrantyResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити гарантії");
        setData(payload);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка гарантійного центру");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 220 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, refreshKey]);

  const rows = data.rows || [];
  const counts = data.counts || { active: 0, expiring: 0, claims: 0, expired: 0 };
  const canWrite = Boolean(data.canWrite);
  const visible = useMemo(() => rows.filter((row) => {
    if (tab === "active") return row.warrantyStatus === "ACTIVE" || row.warrantyStatus === "PENDING_START";
    if (tab === "expiring") return row.warrantyStatus === "EXPIRING";
    if (tab === "claims") return Boolean(row.openClaim);
    return row.warrantyStatus === "EXPIRED";
  }), [rows, tab]);

  function openNewClaim(row: WarrantyRow) {
    setClaimRow(row);
    setClaimReason("");
    setClaimMileage(row.currentMileageKm?.toString() || "");
    setClaimError("");
  }

  function openClaimEdit(row: WarrantyRow) {
    if (!row.openClaim) return;
    setEditRow(row);
    setEditStatus(row.openClaim.status);
    setEditResolution(row.openClaim.resolution || "");
    setEditError("");
  }

  async function submitClaim(event: React.FormEvent) {
    event.preventDefault();
    if (!claimRow) return;
    setClaimSubmitting(true);
    setClaimError("");
    try {
      const response = await fetch("/api/warranties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrderLineId: claimRow.lineId,
          reason: claimReason,
          mileageKmAtClaim: claimMileage.trim() || null,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося створити звернення");
      setClaimRow(null);
      setRefreshKey((value) => value + 1);
      setTab("claims");
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : "Не вдалося створити звернення");
    } finally {
      setClaimSubmitting(false);
    }
  }

  async function saveClaim(event: React.FormEvent) {
    event.preventDefault();
    const claim = editRow?.openClaim;
    if (!claim) return;
    setEditSubmitting(true);
    setEditError("");
    try {
      const response = await fetch("/api/warranties", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: claim.id, status: editStatus, resolution: editResolution }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося оновити звернення");
      setEditRow(null);
      setRefreshKey((value) => value + 1);
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "Не вдалося оновити звернення");
    } finally {
      setEditSubmitting(false);
    }
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · ПІСЛЯ РЕМОНТУ</p>
        <h1>Гарантійний центр</h1>
        <span>Гарантія рахується окремо по кожній виконаній роботі — за датою та пробігом.</span>
      </div>
      <button type="button" className={styles.refresh} onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>↻ Оновити</button>
    </header>

    <section className={styles.kpis}>
      <article><small>Активні гарантії</small><strong>{counts.active}</strong><span>виконаних робіт</span></article>
      <article className={counts.expiring ? styles.warningKpi : ""}><small>Закінчуються</small><strong>{counts.expiring}</strong><span>≤ 30 днів або ≤ 1 000 км</span></article>
      <article><small>Відкриті звернення</small><strong>{counts.claims}</strong><span>потребують рішення</span></article>
      <article className={counts.expired ? styles.dangerKpi : ""}><small>Завершені гарантії</small><strong>{counts.expired}</strong><span>за строком або пробігом</span></article>
    </section>

    <div className={styles.toolbar}>
      <label className={styles.search}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клієнт, телефон, номер авто, VIN, КП або робота..." />{query && <button type="button" onClick={() => setQuery("")}>×</button>}</label>
    </div>

    <nav className={styles.tabs} aria-label="Гарантійні черги">
      {TABS.map((item) => <button key={item.id} type="button" className={tab === item.id ? styles.activeTab : ""} onClick={() => setTab(item.id)}><span>{item.label}</span><b>{counts[item.id]}</b></button>)}
    </nav>

    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Завантажую гарантійний центр…</div> : !visible.length ? <div className={styles.state}>У цій черзі зараз немає робіт.</div> : <section className={styles.list}>
      {visible.map((row) => <article key={row.lineId} className={`${styles.card} ${row.warrantyStatus === "EXPIRED" ? styles.expiredCard : ""}`}>
        <div className={styles.cardHead}>
          <button className={styles.woLink} type="button" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: row.workOrderId, workOrderTab: "overview" })}>{row.workOrderLabel}</button>
          <span className={`${styles.badge} ${warrantyClass(row)}`}>{warrantyLabel(row)}</span>
          {row.openClaim && <span className={`${styles.badge} ${styles.claim}`}>Звернення · {CLAIM_LABELS[row.openClaim.status]}</span>}
        </div>

        <div className={styles.main}>
          <div className={styles.identity}>
            <strong>{row.vehicle.plateNumber || vehicleTitle(row)}</strong>
            <span>{vehicleTitle(row)}</span>
            <small>{row.client.name || "Клієнт без імені"} · {row.client.phone}</small>
          </div>
          <div className={styles.work}>
            <strong>{row.description}</strong>
            <small>{row.code ? `${row.code} · ` : ""}виконано {dateText(row.startsAt)}</small>
          </div>
        </div>

        <div className={styles.limits}>
          <div><small>За строком</small><strong>{row.expiresAt ? `до ${dateText(row.expiresAt)}` : row.warrantyDays ? `${row.warrantyDays} днів` : "не обмежено"}</strong>{row.daysRemaining != null && row.warrantyStatus !== "EXPIRED" && <small>залишилось {Math.max(0, row.daysRemaining)} дн.</small>}</div>
          <div><small>За пробігом</small><strong>{row.mileageLimitKm ? `до ${numberText(row.mileageLimitKm)} км` : row.warrantyKm ? `+${numberText(row.warrantyKm)} км` : "не обмежено"}</strong>{row.kmRemaining != null && row.warrantyStatus !== "EXPIRED" && <small>залишилось {numberText(Math.max(0, row.kmRemaining))} км · зараз {numberText(row.currentMileageKm)} км</small>}</div>
        </div>

        {row.warrantyStatus === "EXPIRED" && <div className={styles.claimBox}><p>Гарантія завершилась{row.expiredByTime && row.expiredByMileage ? " за строком і пробігом" : row.expiredByTime ? " за строком" : row.expiredByMileage ? " за пробігом" : ""}. Звернення все одно можна зареєструвати для рішення сервісу.</p></div>}

        {row.openClaim && <div className={styles.claimBox}>
          <header><b>{CLAIM_LABELS[row.openClaim.status]}</b><time>{dateTimeText(row.openClaim.createdAt)}</time></header>
          <p>{row.openClaim.reason}</p>
          <small>{row.openClaim.mileageKmAtClaim ? `Пробіг при зверненні: ${numberText(row.openClaim.mileageKmAtClaim)} км` : "Пробіг при зверненні не вказано"}{row.openClaim.openedByName ? ` · прийняв: ${row.openClaim.openedByName}` : ""}</small>
          {row.openClaim.resolution && <small>Рішення: {row.openClaim.resolution}</small>}
        </div>}

        <div className={styles.actions}>
          <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: row.workOrderId, workOrderTab: "overview" })}>Відкрити КП</button>
          {canWrite && row.openClaim && <button className={styles.primary} type="button" onClick={() => openClaimEdit(row)}>Опрацювати звернення</button>}
          {canWrite && !row.openClaim && <button className={styles.primary} type="button" onClick={() => openNewClaim(row)}>Зареєструвати звернення</button>}
        </div>
      </article>)}
    </section>}

    {claimRow && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !claimSubmitting) setClaimRow(null); }}>
      <form className={styles.modal} onSubmit={submitClaim}>
        <header><div><small>НОВЕ ГАРАНТІЙНЕ ЗВЕРНЕННЯ</small><h2>{claimRow.workOrderLabel} · {claimRow.vehicle.plateNumber || vehicleTitle(claimRow)}</h2></div><button type="button" onClick={() => setClaimRow(null)} disabled={claimSubmitting}>×</button></header>
        <div className={styles.modalBody}>
          <div className={styles.modalSummary}><b>{claimRow.description}</b><br/>Гарантія: {claimRow.expiresAt ? `до ${dateText(claimRow.expiresAt)}` : "без обмеження по даті"}{claimRow.mileageLimitKm ? ` · до ${numberText(claimRow.mileageLimitKm)} км` : ""}.</div>
          <label><span>Що сталося / скарга клієнта</span><textarea value={claimReason} onChange={(event) => setClaimReason(event.target.value)} autoFocus placeholder="Опишіть симптом, повторну несправність або причину звернення..." /></label>
          <label><span>Поточний пробіг, км</span><input inputMode="numeric" value={claimMileage} onChange={(event) => setClaimMileage(event.target.value.replace(/\D/g, ""))} placeholder="Наприклад 68400" /></label>
          {claimRow.warrantyStatus === "EXPIRED" && <div className={styles.error}>Система бачить гарантію як завершену. Звернення буде зареєстроване, але рішення про гарантійність приймає сервіс.</div>}
          {claimError && <div className={styles.error}>{claimError}</div>}
        </div>
        <footer><button type="button" onClick={() => setClaimRow(null)} disabled={claimSubmitting}>Скасувати</button><button className={styles.primary} type="submit" disabled={claimSubmitting}>{claimSubmitting ? "Реєструю…" : "Зареєструвати"}</button></footer>
      </form>
    </div>}

    {editRow?.openClaim && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !editSubmitting) setEditRow(null); }}>
      <form className={styles.modal} onSubmit={saveClaim}>
        <header><div><small>ОПРАЦЮВАННЯ ЗВЕРНЕННЯ</small><h2>{editRow.workOrderLabel} · {editRow.vehicle.plateNumber || vehicleTitle(editRow)}</h2></div><button type="button" onClick={() => setEditRow(null)} disabled={editSubmitting}>×</button></header>
        <div className={styles.modalBody}>
          <div className={styles.modalSummary}><b>{editRow.description}</b><br/>{editRow.openClaim.reason}</div>
          <label><span>Статус</span><select value={editStatus} onChange={(event) => setEditStatus(event.target.value as ClaimStatus)}>{CLAIM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>Рішення / коментар сервісу</span><textarea value={editResolution} onChange={(event) => setEditResolution(event.target.value)} placeholder="Що перевірено, яке рішення прийнято, що зроблено..." /></label>
          {editError && <div className={styles.error}>{editError}</div>}
        </div>
        <footer><button type="button" onClick={() => setEditRow(null)} disabled={editSubmitting}>Скасувати</button><button className={styles.primary} type="submit" disabled={editSubmitting}>{editSubmitting ? "Зберігаю…" : "Зберегти"}</button></footer>
      </form>
    </div>}
  </div>;
}
