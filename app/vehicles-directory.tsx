"use client";

import { useEffect, useState } from "react";
import { deriveVehicleLifecycle } from "@/src/domain/vehicle-lifecycle";
import {
  parseVehicleAppearancePayload,
  parseVehicleCardPayload,
  parseVehicleDirectoryPayload,
  parseVehicleImageRefreshPayload,
  payloadMessage,
  type VehicleCardLifecycleContract,
  type VehicleDirectoryLifecycleItem,
} from "@/src/lib/contracts/directory-payload.parsers";
import { CustomerCabinetCard } from "./customer-cabinet-card";
import { navigateCrm, readCrmRoute } from "./crm-route";
import { VehicleBrandLogo } from "./vehicle-brand-logo";
import { VehicleRender } from "./vehicle-render";
import styles from "./directory-pages.module.css";

type Vehicle = VehicleDirectoryLifecycleItem;
type VehicleCard = VehicleCardLifecycleContract;
type SortMode = "UPDATED_DESC" | "ARRIVAL_DESC" | "ARRIVAL_ASC" | "STATUS" | "OVERDUE_FIRST";

const PAGE_SIZE = 24;
const STATUS_FILTERS = [
  ["ALL", "Усі"],
  ["PLANNED", "Заплановано"],
  ["IN_WORK", "В роботі"],
  ["DIAGNOSTIC_COMPLETED", "Завершена діагностика"],
  ["MANAGER_REVIEW", "На перевірці менеджера"],
  ["CLIENT_DECISION", "Очікує рішення клієнта"],
  ["PARTS_SELECTION", "Підбір деталей"],
  ["WAITING_APPROVAL", "Очікує погодження"],
  ["WAITING_PARTS", "Очікує деталі"],
  ["READY_FOR_REPAIR", "Готовий до ремонту"],
  ["IN_REPAIR", "У ремонті"],
  ["QUALITY_CONTROL", "Контроль якості"],
  ["WAITING_PAYMENT", "Очікує оплату"],
  ["READY_FOR_PICKUP", "Готовий до видачі"],
  ["DELIVERED", "Видано"],
  ["CANCELLED", "Скасовано"],
  ["CLIENT_DECLINED", "Клієнт відмовився"],
  ["NO_ACTIVE", "Без активних робіт"],
] as const;

const SORT_OPTIONS: Array<[SortMode, string]> = [
  ["UPDATED_DESC", "Останні зміни"],
  ["ARRIVAL_DESC", "Заїзд: новіші спочатку"],
  ["ARRIVAL_ASC", "Заїзд: старіші спочатку"],
  ["STATUS", "За етапом робіт"],
  ["OVERDUE_FIRST", "Спочатку протерміновані"],
];

function vehicleTitle(vehicle: Vehicle | VehicleCard) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function dateTimeText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function engineText(vehicle: Vehicle | VehicleCard) {
  if (vehicle.engineName) return vehicle.engineName;
  if (vehicle.engineVolumeCm3) return `${(vehicle.engineVolumeCm3 / 1000).toFixed(1)} л`;
  return "—";
}

function toneStyle(tone: string) {
  if (tone === "danger") return { color: "#d92d20", background: "#fff1f0", borderColor: "#ffd1cc" };
  if (tone === "warning") return { color: "#9a6700", background: "#fff7dc", borderColor: "#f6dd9a" };
  if (tone === "success") return { color: "#137333", background: "#edf8f0", borderColor: "#bfe5c9" };
  if (tone === "accent") return { color: "#c94800", background: "#fff2e8", borderColor: "#ffd1b3" };
  if (tone === "info") return { color: "#175cd3", background: "#eff6ff", borderColor: "#c7dcff" };
  return { color: "#475467", background: "#f6f7f9", borderColor: "#d8dde5" };
}

function LifecycleBadge({ vehicle }: { vehicle: Vehicle | VehicleCard }) {
  const lifecycle = vehicle.lifecycle;
  if (!lifecycle) return <span style={{ fontSize: 12, color: "#7a8795" }}>Без активних робіт</span>;
  const overdue = lifecycle.flags.includes("OVERDUE");
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
    <span style={{ ...toneStyle(overdue ? "danger" : lifecycle.tone), display: "inline-flex", alignItems: "center", minHeight: 26, padding: "3px 9px", border: "1px solid", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>
      {lifecycle.label}
    </span>
    {overdue && <span style={{ color: "#d92d20", fontSize: 11, fontWeight: 800 }}>● Протерміновано</span>}
    {lifecycle.flags.includes("RETURNED_TO_MECHANIC") && <span style={{ color: "#9a6700", fontSize: 11, fontWeight: 700 }}>↩ Повернено механіку</span>}
  </div>;
}

function workOrderLabel(status: string) {
  return deriveVehicleLifecycle({ workOrderStatus: status })?.label || status;
}

function VehicleImage({ vehicle, size = "card", eager = false }: { vehicle: Vehicle | VehicleCard; size?: "mini" | "card" | "drawer" | "hero"; eager?: boolean }) {
  return <VehicleRender
    id={vehicle.id}
    brand={vehicle.brand}
    model={vehicle.model}
    year={vehicle.year}
    updatedAt={vehicle.updatedAt}
    exteriorColorName={vehicle.exteriorColorName}
    exteriorColorHex={vehicle.exteriorColorHex}
    exteriorColorConfirmed={vehicle.exteriorColorConfirmed}
    size={size}
    eager={eager}
  />;
}

export function VehiclesDirectory() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState<SortMode>("UPDATED_DESC");
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [vehicleCard, setVehicleCard] = useState<VehicleCard | null>(null);
  const [vehicleLoading, setVehicleLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort });
        if (query.trim()) params.set("q", query.trim());
        if (status !== "ALL") params.set("status", status);
        const response = await fetch(`/api/vehicles?${params}`, { cache: "no-store", signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        const data = parseVehicleDirectoryPayload(payload);
        if (!response.ok || !data) throw new Error(payloadMessage(payload, "Не вдалося завантажити автомобілі"));
        setVehicles(data.vehicles);
        setTotal(data.total);
        setPages(data.pages);
        setStatusCounts(data.statusCounts);
        if (data.page !== page) setPage(data.page);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка завантаження");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, page, status, sort]);

  useEffect(() => {
    const syncFromRoute = () => setVehicleId(readCrmRoute().vehicleId || null);
    syncFromRoute();
    window.addEventListener("popstate", syncFromRoute);
    return () => window.removeEventListener("popstate", syncFromRoute);
  }, []);

  useEffect(() => {
    if (!vehicleId) {
      setVehicleCard(null);
      return;
    }
    const controller = new AbortController();
    setVehicleLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/vehicles/card?id=${encodeURIComponent(vehicleId)}`, { cache: "no-store", signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        const vehicle = parseVehicleCardPayload(payload);
        if (!response.ok || !vehicle) throw new Error(payloadMessage(payload, "Не вдалося відкрити автомобіль"));
        setVehicleCard(vehicle);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка картки авто");
      } finally {
        if (!controller.signal.aborted) setVehicleLoading(false);
      }
    })();
    return () => controller.abort();
  }, [vehicleId]);

  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function changeStatus(value: string) {
    setStatus(value);
    setPage(1);
  }

  function changeSort(value: SortMode) {
    setSort(value);
    setPage(1);
  }

  function openNewRequest() {
    const detail = vehicleCard
      ? {
          source: "Інше",
          plate: vehicleCard.plateNumber || "",
          vin: vehicleCard.vin || "",
          name: vehicleCard.client.name || "",
          phone: vehicleCard.client.phone || "",
        }
      : { source: "Інше" };
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", { detail }));
  }

  function openVehicle(id: string) {
    navigateCrm("Авто", { vehicleId: id });
  }

  function closeVehicle() {
    navigateCrm("Авто");
  }

  function updateVehicleCard(next: VehicleCard) {
    setVehicleCard(next);
    setVehicles((current) => current.map((vehicle) => vehicle.id === next.id ? { ...vehicle, ...next, client: next.client } : vehicle));
  }

  const totalAll = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · CRM-АВТО</p>
        <h1>Авто</h1>
        <span>Автомобілі клієнтів, поточний етап робіт, VIN, держномери та сервісна історія</span>
      </div>
      <button className={styles.primary} onClick={openNewRequest}>+ Додати авто</button>
    </header>

    <div className={styles.toolbar} style={{ display: "grid", gap: 10 }}>
      <label className={styles.search}>
        <span>⌕</span>
        <input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Пошук за номером авто, VIN, маркою, моделлю або власником..." />
        {query && <button type="button" onClick={() => changeQuery("")} aria-label="Очистити пошук">×</button>}
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: "1 1 620px", paddingBottom: 2 }}>
          {STATUS_FILTERS.map(([code, label]) => {
            const count = code === "ALL" ? totalAll : statusCounts[code] || 0;
            return <button key={code} type="button" onClick={() => changeStatus(code)} style={{ flex: "0 0 auto", minHeight: 36, border: status === code ? "1px solid #ff6500" : "1px solid #d8dde5", background: status === code ? "#fff2e8" : "#fff", color: status === code ? "#c94800" : "#344054", borderRadius: 10, padding: "7px 10px", fontWeight: status === code ? 800 : 650, cursor: "pointer" }}>
              {label} <span style={{ opacity: .65 }}>{count}</span>
            </button>;
          })}
        </div>
        <select value={sort} onChange={(event) => changeSort(event.target.value as SortMode)} aria-label="Сортування автомобілів" style={{ minHeight: 38, minWidth: 220, border: "1px solid #d8dde5", borderRadius: 10, background: "#fff", padding: "0 10px", color: "#344054", fontWeight: 700 }}>
          {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </div>

    <div className={styles.summary}>Знайдено автомобілів: <b>{total}</b>{status !== "ALL" && <span> · {STATUS_FILTERS.find(([code]) => code === status)?.[1]}</span>}{total > 0 && <span> · сторінка {page} з {pages}</span>}{(status !== "ALL" || sort !== "UPDATED_DESC") && <button type="button" onClick={() => { changeStatus("ALL"); changeSort("UPDATED_DESC"); }} style={{ marginLeft: 10, border: 0, background: "transparent", color: "#d95300", fontWeight: 700, cursor: "pointer" }}>Скинути фільтри</button>}</div>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Завантажую автомобілі…</div> : !vehicles.length ? <div className={styles.state}>За цим фільтром автомобілів немає.</div> : <div className={styles.grid}>
      {vehicles.map((vehicle, index) => <button key={vehicle.id} className={styles.card} onClick={() => openVehicle(vehicle.id)} style={vehicle.lifecycle?.flags.includes("OVERDUE") ? { boxShadow: "inset 4px 0 0 #d92d20" } : undefined}>
        <div className={styles.vehicleHero}>
          <div className={styles.vehicleCopy}>
            <div className={styles.vehicleTitleLine}>
              <VehicleBrandLogo brand={vehicle.brand} size={38} />
              <span className={styles.identityText}>
                <strong>{vehicleTitle(vehicle)}</strong>
                <small>{vehicle.plateNumber || "Без держномера"}</small>
              </span>
            </div>
            <small className={styles.vehicleVin}>{vehicle.vin ? `VIN: ${vehicle.vin}` : "VIN не вказаний"}</small>
            <div style={{ marginTop: 8 }}><LifecycleBadge vehicle={vehicle} /></div>
          </div>
          <VehicleImage vehicle={vehicle} size="card" eager={index < 6} />
          <span className={styles.chevron}>›</span>
        </div>
        <div className={styles.ownerLine}>
          <span><small>Власник</small><b>{vehicle.client.name?.trim() || "Клієнт без імені"}</b></span>
          <span>{vehicle.client.phone}</span>
        </div>
        <div className={styles.stats}>
          <span><small>Заїзд</small><b>{dateTimeText(vehicle.lifecycle?.arrivalAt)}</b></span>
          <span><small>Діагностики</small><b>{vehicle._count.diagnosticRequests}</b></span>
          <span><small>Пробіг</small><b>{vehicle.mileageKm ? `${vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}</b></span>
        </div>
      </button>)}
    </div>}

    {!loading && total > PAGE_SIZE && <nav className={styles.pagination} aria-label="Сторінки автомобілів">
      <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Назад</button>
      <span>Сторінка <b>{page}</b> з <b>{pages}</b></span>
      <button type="button" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>Далі →</button>
    </nav>}

    {vehicleId && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeVehicle(); }}>
      <aside className={styles.drawer}>
        {vehicleLoading || !vehicleCard ? <div className={styles.state}>Завантажую картку автомобіля…</div> : <>
          <header className={styles.drawerHeader}>
            <div className={styles.drawerVehicleHeader}>
              <div className={styles.vehicleIdentity}>
                <VehicleBrandLogo brand={vehicleCard.brand} size={48} />
                <span className={styles.identityText}><small>КАРТКА АВТОМОБІЛЯ</small><strong>{vehicleTitle(vehicleCard)}</strong><span>{vehicleCard.plateNumber || "Без держномера"}</span></span>
              </div>
              <VehicleImage vehicle={vehicleCard} size="drawer" eager />
            </div>
            <button className={styles.close} onClick={closeVehicle}>×</button>
          </header>
          <div className={styles.drawerBody}>
            <section className={styles.panel}>
              <h3>Поточний стан</h3>
              <LifecycleBadge vehicle={vehicleCard} />
              {vehicleCard.lifecycle && <div className={styles.facts} style={{ marginTop: 12 }}>
                <span><small>Заплановано</small><b>{dateTimeText(vehicleCard.lifecycle.plannedStartAt)}</b></span>
                <span><small>Фактичний заїзд</small><b>{dateTimeText(vehicleCard.lifecycle.arrivalAt)}</b></span>
                <span><small>Планова готовність</small><b>{dateTimeText(vehicleCard.lifecycle.plannedEndAt)}</b></span>
                <span><small>Джерело</small><b>{vehicleCard.lifecycle.source === "WORK_ORDER" ? "Наряд" : vehicleCard.lifecycle.source === "DIAGNOSTIC" ? "Діагностика" : "Планувальник"}</b></span>
              </div>}
            </section>
            <section className={styles.panel}>
              <h3>Власник</h3>
              <button className={styles.ownerButton} onClick={() => navigateCrm("Клієнти", { clientId: vehicleCard.client.id })}>
                <span><strong>{vehicleCard.client.name || "Клієнт без імені"}</strong><small>{vehicleCard.client.phone}</small></span><span>›</span>
              </button>
            </section>
            <section className={styles.panel}>
              <CustomerCabinetCard clientId={vehicleCard.client.id} vehicleId={vehicleCard.id} />
            </section>
            <section className={styles.panel}>
              <h3>Технічні дані</h3>
              <div className={styles.facts}>
                <span><small>Марка</small><b>{vehicleCard.brand || "—"}</b></span>
                <span><small>Модель</small><b>{vehicleCard.model || "—"}</b></span>
                <span><small>Рік</small><b>{vehicleCard.year || "—"}</b></span>
                <span><small>VIN</small><b>{vehicleCard.vin || "—"}</b></span>
                <span><small>Пробіг</small><b>{vehicleCard.mileageKm ? `${vehicleCard.mileageKm.toLocaleString("uk-UA")} км` : "—"}</b></span>
                <span><small>Двигун</small><b>{engineText(vehicleCard)}</b></span>
                <span><small>Паливо</small><b>{vehicleCard.fuelType || "—"}</b></span>
                <span><small>Привід</small><b>{vehicleCard.driveType || "—"}</b></span>
              </div>
            </section>
            <VehicleAppearanceEditor vehicle={vehicleCard} onSaved={updateVehicleCard}/>
            <section className={styles.panel}>
              <h3>Сервісна історія</h3>
              <div className={styles.facts}>
                <span><small>Замовлення</small><b>{vehicleCard._count.workOrders}</b></span>
                <span><small>Діагностики</small><b>{vehicleCard._count.diagnosticRequests}</b></span>
                <span><small>Створено</small><b>{dateText(vehicleCard.createdAt)}</b></span>
                <span><small>Оновлено</small><b>{dateText(vehicleCard.updatedAt)}</b></span>
              </div>
              {vehicleCard.workOrders.length ? <div className={styles.relatedList}>{vehicleCard.workOrders.map((workOrder) => <button key={workOrder.id} onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: workOrder.id })}>
                <strong>{workOrderLabel(workOrder.status)}</strong>
                <small>{dateText(workOrder.closedAt || workOrder.updatedAt || workOrder.createdAt)}</small>
                <span>›</span>
              </button>)}</div> : null}
            </section>
          </div>
          <footer className={styles.drawerFooter}><button className={styles.primary} onClick={openNewRequest}>+ Нова заявка</button></footer>
        </>}
      </aside>
    </div>}
  </div>;
}

function VehicleAppearanceEditor({ vehicle, onSaved }: { vehicle: VehicleCard; onSaved: (vehicle: VehicleCard) => void }) {
  const [name, setName] = useState(vehicle.exteriorColorName || "");
  const [hex, setHex] = useState(vehicle.exteriorColorHex || "");
  const [paintCode, setPaintCode] = useState(vehicle.exteriorPaintCode || "");
  const [confirmed, setConfirmed] = useState(vehicle.exteriorColorConfirmed);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setName(vehicle.exteriorColorName || "");
    setHex(vehicle.exteriorColorHex || "");
    setPaintCode(vehicle.exteriorPaintCode || "");
    setConfirmed(vehicle.exteriorColorConfirmed);
  }, [vehicle.id, vehicle.exteriorColorName, vehicle.exteriorColorHex, vehicle.exteriorPaintCode, vehicle.exteriorColorConfirmed]);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicle.id)}/appearance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exteriorColorName: name,
          exteriorColorHex: hex,
          exteriorPaintCode: paintCode,
          exteriorColorConfirmed: confirmed,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const patch = parseVehicleAppearancePayload(payload);
      if (!response.ok || !patch || patch.id !== vehicle.id) throw new Error(payloadMessage(payload, "Не вдалося зберегти колір"));
      onSaved({ ...vehicle, ...patch });
      setMessage("Колір збережено. Зображення авто оновиться автоматично.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Помилка збереження");
    } finally {
      setSaving(false);
    }
  }

  async function refreshImage() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicle.id)}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload: unknown = await response.json().catch(() => null);
      const data = parseVehicleImageRefreshPayload(payload);
      if (!response.ok || !data) throw new Error(payloadMessage(payload, "Не вдалося оновити зображення"));
      onSaved({ ...vehicle, updatedAt: new Date().toISOString() });
      setMessage(data.fallback ? "Точний render поки недоступний — показано безпечний силует." : "Render автомобіля оновлено.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Помилка оновлення зображення");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.panel}>
    <div className={styles.panelTitleRow}><h3>Колір кузова</h3><span>{vehicle.exteriorColorConfirmed ? "Підтверджено" : "AUTO: колір теми"}</span></div>
    <p className={styles.colorHint}>Якщо реальний колір підтверджено, CRM використовує його. Якщо ні — зображення адаптується до активного акцентного кольору CRM.</p>
    <div className={styles.colorForm}>
      <label><span>Назва кольору</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Crystal White Pearl"/></label>
      <label><span>Код фарби</span><input value={paintCode} onChange={(event) => setPaintCode(event.target.value)} placeholder="707"/></label>
      <label><span>HEX</span><span className={styles.hexField}><input value={hex} onChange={(event) => setHex(event.target.value)} placeholder="#F4F4F1"/>{/^#[0-9a-f]{6}$/i.test(hex) ? <i style={{ backgroundColor: hex }}/> : null}</span></label>
    </div>
    <label className={styles.confirmColor}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>Реальний колір автомобіля підтверджено</span></label>
    <div className={styles.colorActions}><button type="button" disabled={saving} onClick={() => void refreshImage()}>Оновити render</button><button type="button" className={styles.primary} disabled={saving} onClick={() => void save()}>{saving ? "Зберігаємо…" : "Зберегти колір"}</button></div>
    {message ? <small className={styles.colorMessage}>{message}</small> : null}
  </section>;
}