"use client";

import { useEffect, useState } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";
import { VehicleBrandLogo } from "./vehicle-brand-logo";
import { VehicleRender } from "./vehicle-render";
import styles from "./directory-pages.module.css";

type Vehicle = {
  id: string;
  clientId: string;
  plateNumber: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  engineName: string | null;
  engineVolumeCm3: number | null;
  fuelType: string | null;
  bodyType: string | null;
  driveType: string | null;
  vehicleType: string | null;
  turboLevClass: string | null;
  priceCoefficient: string | number;
  vehicleDataSource: string | null;
  vehicleDataConfidence: number | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  exteriorPaintCode: string | null;
  exteriorColorSource: string | null;
  exteriorColorConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string | null; phone: string };
  _count: { workOrders: number; diagnosticRequests: number };
};

type ListResponse = { ok: boolean; total: number; page: number; limit: number; pages: number; vehicles: Vehicle[]; error?: string };
type VehicleCard = Omit<Vehicle, "client"> & {
  classificationSource: string | null;
  classificationConfidence: number | null;
  lastVehicleLookupAt: string | null;
  client: { id: string; name: string | null; phone: string };
  diagnosticRequests: Array<{ id: string; status: string; technicalConclusion: string | null; confirmedAt: string | null; createdAt: string; updatedAt: string }>;
  workOrders: Array<{ id: string; status: string; createdAt: string; updatedAt: string; closedAt: string | null }>;
};

const PAGE_SIZE = 24;

function vehicleTitle(vehicle: Vehicle | VehicleCard) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function engineText(vehicle: Vehicle | VehicleCard) {
  if (vehicle.engineName) return vehicle.engineName;
  if (vehicle.engineVolumeCm3) return `${(vehicle.engineVolumeCm3 / 1000).toFixed(1)} л`;
  return "—";
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
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/vehicles?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as ListResponse;
        if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити автомобілі");
        setVehicles(data.vehicles || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
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
  }, [query, page]);

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
        const data = await response.json() as { ok?: boolean; vehicle?: VehicleCard; error?: string };
        if (!response.ok || !data.ok || !data.vehicle) throw new Error(data.error || "Не вдалося відкрити автомобіль");
        setVehicleCard(data.vehicle);
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

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · CRM-АВТО</p>
        <h1>Авто</h1>
        <span>Автомобілі клієнтів, VIN, держномери та сервісна історія</span>
      </div>
      <button className={styles.primary} onClick={openNewRequest}>+ Додати авто</button>
    </header>

    <div className={styles.toolbar}>
      <label className={styles.search}>
        <span>⌕</span>
        <input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Пошук за номером авто, VIN, маркою, моделлю або власником..." />
        {query && <button type="button" onClick={() => changeQuery("")} aria-label="Очистити пошук">×</button>}
      </label>
    </div>

    <div className={styles.summary}>Знайдено автомобілів: <b>{total}</b>{total > 0 && <span> · сторінка {page} з {pages}</span>}</div>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Завантажую автомобілі…</div> : !vehicles.length ? <div className={styles.state}>Нічого не знайдено.</div> : <div className={styles.grid}>
      {vehicles.map((vehicle, index) => <button key={vehicle.id} className={styles.card} onClick={() => openVehicle(vehicle.id)}>
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
          </div>
          <VehicleImage vehicle={vehicle} size="card" eager={index < 6} />
          <span className={styles.chevron}>›</span>
        </div>
        <div className={styles.ownerLine}>
          <span><small>Власник</small><b>{vehicle.client.name?.trim() || "Клієнт без імені"}</b></span>
          <span>{vehicle.client.phone}</span>
        </div>
        <div className={styles.stats}>
          <span><small>Замовлення</small><b>{vehicle._count.workOrders}</b></span>
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
              <h3>Власник</h3>
              <button className={styles.ownerButton} onClick={() => navigateCrm("Клієнти", { clientId: vehicleCard.client.id })}>
                <span><strong>{vehicleCard.client.name || "Клієнт без імені"}</strong><small>{vehicleCard.client.phone}</small></span><span>›</span>
              </button>
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
                <strong>{workOrder.status}</strong>
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
      const data = await response.json() as { ok?: boolean; error?: string; vehicle?: Partial<VehicleCard> & { updatedAt?: string } };
      if (!response.ok || !data.ok || !data.vehicle) throw new Error(data.error || "Не вдалося зберегти колір");
      const next = { ...vehicle, ...data.vehicle } as VehicleCard;
      onSaved(next);
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
      const data = await response.json() as { ok?: boolean; error?: string; fallback?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося оновити зображення");
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
