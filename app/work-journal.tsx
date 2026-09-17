"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./work-journal.module.css";

type ScopeMode = "ACTIVE" | "COMPLETED" | "ALL";
type PaymentMode = "ALL" | "PAID" | "PARTIAL" | "UNPAID" | "NONE";
type PhotoMode = "ALL" | "COMPLETE" | "MISSING";
type Photo = { id: string; kind: string; fileName: string; fileSize: number; createdAt: string; updatedAt: string; url: string };
type Work = { id: string; description: string; status: string; startedAt: string | null; completedAt: string | null };
type Row = {
  id: string;
  number: number | null;
  status: string;
  statusLabel: string;
  processType: string;
  client: { id: string; name: string | null; phone: string };
  vehicle: { id: string; label: string; brand: string | null; model: string | null; year: number | null; plateNumber: string | null; vin: string | null };
  mechanic: { id: string; name: string } | null;
  post: { id: string; name: string } | null;
  appointment: { id: string; purpose: string | null; status: string; plannedStartAt: string; actualArrivalAt: string | null; actualStartAt: string | null; actualEndAt: string | null } | null;
  works: Work[];
  workCount: number;
  completedWorkCount: number;
  productionComplete: boolean;
  completed: boolean;
  payment: { code: "PAID" | "PARTIAL" | "UNPAID" | "NONE"; label: string; total: number; paid: number; outstanding: number } | null;
  photoSet: { lineId: string; workDescription: string; mechanic: { id: string; name: string } | null; completedAt: string | null; count: number; complete: boolean; photos: Photo[] } | null;
  photoCount: number;
  salaryEligible: boolean;
  referenceAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};
type Payload = {
  ok?: boolean;
  rows?: Row[];
  mechanics?: Array<{ id: string; name: string }>;
  paymentVisible?: boolean;
  counts?: { active: number; completed: number; all: number; withPhotos: number; missingPhotos: number };
  error?: string;
};

const PHOTO_LABEL: Record<string, string> = {
  TOOL_FIRST: "Інструмент · фото 1",
  TOOL_SECOND: "Інструмент · фото 2",
  WORKSPACE_CLEAN: "Чистий робочий пост",
};

function orderNo(number: number | null) {
  return number == null ? "Наряд" : `ЗН-${String(number).padStart(6, "0")}`;
}

function dateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function money(value: number) {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value || 0);
}

function paymentClass(code?: string | null) {
  if (code === "PAID") return styles.paid;
  if (code === "PARTIAL") return styles.partial;
  if (code === "UNPAID") return styles.unpaid;
  return styles.muted;
}

function stateDate(row: Row) {
  if (row.closedAt) return `Виїхав / закрито ${dateTime(row.closedAt)}`;
  if (row.completed) return `Роботи завершено ${dateTime(row.photoSet?.completedAt || row.referenceAt)}`;
  if (row.appointment?.actualStartAt) return `Розпочато ${dateTime(row.appointment.actualStartAt)}`;
  return `Заплановано ${dateTime(row.appointment?.plannedStartAt || row.createdAt)}`;
}

export function WorkJournal() {
  const [scope, setScope] = useState<ScopeMode>("ACTIVE");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [mechanicId, setMechanicId] = useState("");
  const [payment, setPayment] = useState<PaymentMode>("ALL");
  const [photos, setPhotos] = useState<PhotoMode>("ALL");
  const [from, setFrom] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [mechanics, setMechanics] = useState<Array<{ id: string; name: string }>>([]);
  const [counts, setCounts] = useState({ active: 0, completed: 0, all: 0, withPhotos: 0, missingPhotos: 0 });
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ row: Row; photoId: string } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ scope, photos, limit: "500" });
      if (debouncedQ) params.set("q", debouncedQ);
      if (mechanicId) params.set("mechanicId", mechanicId);
      if (paymentVisible && payment !== "ALL") params.set("payment", payment);
      if (from) params.set("from", from);
      const response = await fetch(`/api/work-journal?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as Payload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не вдалося завантажити роботи.");
      setRows(body.rows || []);
      setMechanics(body.mechanics || []);
      setCounts(body.counts || { active: 0, completed: 0, all: 0, withPhotos: 0, missingPhotos: 0 });
      setPaymentVisible(Boolean(body.paymentVisible));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити роботи.");
    } finally { setLoading(false); }
  }, [scope, photos, debouncedQ, mechanicId, payment, paymentVisible, from]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!viewer) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setViewer(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [viewer]);

  const activePhotos = useMemo(() => viewer?.row.photoSet?.photos ?? [], [viewer]);
  const activeIndex = viewer ? Math.max(0, activePhotos.findIndex((photo) => photo.id === viewer.photoId)) : 0;
  const activePhoto = viewer ? activePhotos[activeIndex] ?? null : null;
  const moveViewer = (delta: number) => {
    if (!viewer || !activePhotos.length) return;
    const next = (activeIndex + delta + activePhotos.length) % activePhotos.length;
    setViewer({ row: viewer.row, photoId: activePhotos[next].id });
  };

  return <div className={styles.page}>
    <header className={styles.head}>
      <div><p className={styles.eyebrow}>СЕРВІС · ЄДИНИЙ ЖУРНАЛ</p><h1>Роботи</h1><p>Усі автомобілі станції в одному місці: діагностика, ремонт, оплата, завершення, видача та фінальні фото механіка після прибирання поста.</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
    </header>

    <section className={styles.kpis}>
      <div><span>Активні автомобілі</span><strong>{counts.active}</strong></div>
      <div><span>Виконані роботи</span><strong>{counts.completed}</strong></div>
      <div><span>Уся історія</span><strong>{counts.all}</strong></div>
      <div><span>Є фото 3/3</span><strong>{counts.withPhotos}</strong></div>
      <div><span>Виконано без 3/3</span><strong>{counts.missingPhotos}</strong></div>
    </section>

    <nav className={styles.modes} aria-label="Режим журналу">
      <button type="button" className={scope === "ACTIVE" ? styles.modeActive : ""} onClick={() => setScope("ACTIVE")}>Активні <b>{counts.active}</b></button>
      <button type="button" className={scope === "COMPLETED" ? styles.modeActive : ""} onClick={() => setScope("COMPLETED")}>Виконані <b>{counts.completed}</b></button>
      <button type="button" className={scope === "ALL" ? styles.modeActive : ""} onClick={() => setScope("ALL")}>Усі <b>{counts.all}</b></button>
    </nav>

    <section className={styles.filters}>
      <label className={styles.search}><span>⌕</span><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Авто, номер, VIN, клієнт, № наряду, робота…"/>{q && <button type="button" onClick={() => setQ("")} aria-label="Очистити">×</button>}</label>
      <select className={styles.select} value={mechanicId} onChange={(event) => setMechanicId(event.target.value)} aria-label="Механік"><option value="">Усі механіки</option>{mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select>
      <select className={styles.select} value={photos} onChange={(event) => setPhotos(event.target.value as PhotoMode)} aria-label="Фото"><option value="ALL">Усі фото</option><option value="COMPLETE">Фото 3/3</option><option value="MISSING">Немає 3/3</option></select>
      {paymentVisible ? <select className={styles.select} value={payment} onChange={(event) => setPayment(event.target.value as PaymentMode)} aria-label="Оплата"><option value="ALL">Усі оплати</option><option value="PAID">Оплачено</option><option value="PARTIAL">Частково</option><option value="UNPAID">Не оплачено</option><option value="NONE">Немає рахунку</option></select> : <span className={styles.select} style={{ display: "flex", alignItems: "center", color: "var(--muted)" }}>Оплата · немає доступу</span>}
      <input className={styles.date} type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Від дати"/>
      <span className={styles.resultCount}>{rows.length} записів</span>
    </section>

    {error && <div className={styles.notice}>{error}</div>}

    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <colgroup><col style={{ width: 245 }}/><col style={{ width: 130 }}/><col style={{ width: 235 }}/><col style={{ width: 150 }}/><col style={{ width: 170 }}/><col style={{ width: 135 }}/><col style={{ width: 175 }}/></colgroup>
        <thead><tr><th>Автомобіль</th><th>Тип</th><th>Роботи</th><th>Механік / пост</th><th>Стан</th><th>Оплата</th><th>Фото</th></tr></thead>
        <tbody>
          {loading && !rows.length ? <tr><td colSpan={7}><div className={styles.empty}>Завантажую журнал робіт…</div></td></tr> : !rows.length ? <tr><td colSpan={7}><div className={styles.empty}>За вибраними фільтрами робіт не знайдено.</div></td></tr> : rows.map((row) => <Fragment key={row.id}>
            <tr>
              <td><div className={styles.vehicleCell}><div className={styles.vehicleMain}><button type="button" style={{ border: 0, background: "transparent", padding: 0, color: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => navigateCrm("Наряди та ремонт", { workOrderId: row.id })}><span className={styles.orderNo}>{orderNo(row.number)}</span><strong>{row.vehicle.label}</strong></button><small>{row.client.name || row.client.phone} · {dateTime(row.referenceAt)}</small></div><span className={styles.plate}>{row.vehicle.plateNumber || "—"}</span></div></td>
              <td><span className={styles.process}>{row.processType}</span></td>
              <td><button type="button" className={styles.worksBtn} onClick={() => setExpandedId((current) => current === row.id ? null : row.id)}><span>{row.works[0]?.description || "Без робіт"}</span><b>{row.workCount}</b></button></td>
              <td><div className={styles.mechanic}><strong>{row.mechanic?.name || "—"}</strong><small>{row.post?.name || "Без поста"}</small></div></td>
              <td><span className={styles.status}>{row.statusLabel}</span><div style={{ marginTop: 4, fontSize: 10, color: "var(--muted)" }}>{stateDate(row)}</div></td>
              <td>{row.payment ? <><strong className={paymentClass(row.payment.code)}>{row.payment.label}</strong><div style={{ marginTop: 3, fontSize: 10, color: "var(--muted)" }}>{row.payment.code === "PAID" ? money(row.payment.paid) : row.payment.outstanding > 0 ? `Борг ${money(row.payment.outstanding)}` : money(row.payment.total)}</div></> : <span className={styles.muted}>—</span>}</td>
              <td><div className={styles.photos}>{row.photoSet?.photos.map((photo) => <button type="button" className={styles.thumb} key={photo.id} onClick={() => setViewer({ row, photoId: photo.id })} aria-label={`Відкрити ${PHOTO_LABEL[photo.kind] || "фото"}`}><img src={photo.url} alt={PHOTO_LABEL[photo.kind] || "Фінальне фото"}/></button>)}<span className={`${styles.photoCount} ${row.photoCount === 3 ? styles.photoComplete : styles.photoMissing}`}>{row.photoCount}/3</span></div></td>
            </tr>
            {expandedId === row.id && <tr className={styles.expanded}><td colSpan={7}><div className={styles.workList}>{row.works.length ? row.works.map((work) => <div key={work.id}><strong>{work.description}</strong><span>{work.status === "COMPLETED" ? `Виконано ${dateTime(work.completedAt)}` : work.status}</span></div>) : <div><strong>Виконуваних робіт немає</strong><span>—</span></div>}</div></td></tr>}
          </Fragment>)}
        </tbody>
      </table>
    </div>

    {viewer && activePhoto && <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Фінальне фото механіка">
      <div className={styles.overlayHead}><div><strong>{PHOTO_LABEL[activePhoto.kind] || activePhoto.kind}</strong><span>{orderNo(viewer.row.number)} · {viewer.row.vehicle.label} · {viewer.row.vehicle.plateNumber || "Без номера"} · {viewer.row.photoSet?.mechanic?.name || viewer.row.mechanic?.name || "Механік"} · {dateTime(activePhoto.createdAt)}</span></div><button type="button" className={styles.close} onClick={() => setViewer(null)} aria-label="Закрити">×</button></div>
      <div className={styles.hero}><img src={activePhoto.url} alt={PHOTO_LABEL[activePhoto.kind] || "Фінальне фото"}/></div>
      <div className={styles.overlayNav}><button type="button" onClick={() => moveViewer(-1)} disabled={activePhotos.length < 2}>←</button><span>{activeIndex + 1} / {activePhotos.length}</span><button type="button" onClick={() => moveViewer(1)} disabled={activePhotos.length < 2}>→</button></div>
    </div>}
  </div>;
}
