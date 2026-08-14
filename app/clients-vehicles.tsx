"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./clients-vehicles.module.css";

type Vehicle = {
  id: string;
  plateNumber?: string | null;
  brand?: string | null;
  model?: string | null;
  vin?: string | null;
  year?: number | null;
  mileageKm?: number | null;
  engineName?: string | null;
  engineVolumeCm3?: number | null;
  fuelType?: string | null;
  bodyType?: string | null;
  driveType?: string | null;
  turboLevClass?: string | null;
  priceCoefficient?: string | number | null;
  vehicleDataSource?: string | null;
  vehicleDataConfidence?: number | null;
};

type Client = {
  id: string;
  name?: string | null;
  phone: string;
  createdAt: string;
  updatedAt: string;
  vehicles: Vehicle[];
};

type Payload = {
  items: Client[];
  stats: { clients: number; vehicles: number; demoClients: number; demoVehicles: number };
};

function formatMileage(value?: number | null) {
  if (!value) return "Пробіг не вказаний";
  return `${new Intl.NumberFormat("uk-UA").format(value)} км`;
}

function coeff(value?: string | number | null) {
  const num = Number(value || 1);
  return Number.isFinite(num) ? num.toFixed(2) : "1.00";
}

function initials(name?: string | null) {
  const parts = String(name || "Клієнт").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "К";
}

export function ClientsVehicles() {
  const [data, setData] = useState<Payload>({ items: [], stats: { clients: 0, vehicles: 0, demoClients: 0, demoVehicles: 0 } });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/clients-vehicles", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося завантажити клієнтів");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.items;
    return data.items.filter((client) => {
      const vehicles = client.vehicles.map((vehicle) => `${vehicle.plateNumber || ""} ${vehicle.brand || ""} ${vehicle.model || ""} ${vehicle.vin || ""}`).join(" ");
      return `${client.name || ""} ${client.phone} ${vehicles}`.toLowerCase().includes(q);
    });
  }, [data.items, query]);

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className="eyebrow">ЄДИНА КАРТКА КЛІЄНТА</p>
        <h1>Клієнти та авто</h1>
        <p className={styles.subtitle}>Клієнт → його автомобілі → технічні дані → наступні операції CRM.</p>
      </div>
      <button className={styles.refresh} type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлення…" : "↻ Оновити"}</button>
    </header>

    <section className={styles.stats}>
      <article><span>Клієнтів</span><strong>{data.stats.clients}</strong><small>{data.stats.demoClients} demo</small></article>
      <article><span>Автомобілів</span><strong>{data.stats.vehicles}</strong><small>{data.stats.demoVehicles} demo</small></article>
      <article><span>У вибірці</span><strong>{filtered.length}</strong><small>за поточним пошуком</small></article>
    </section>

    <div className={styles.toolbar}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук: клієнт, телефон, номер, марка, модель, VIN…" />
      <span>Демо-записи позначені окремо й легко видаляються.</span>
    </div>

    {error && <div className={styles.error}>Не вдалося завантажити дані: {error}</div>}
    {!loading && !error && filtered.length === 0 && <div className={styles.empty}>Нічого не знайдено.</div>}

    <section className={styles.grid}>
      {filtered.map((client) => <article className={styles.clientCard} key={client.id}>
        <header className={styles.clientHead}>
          <div className={styles.avatar}>{initials(client.name)}</div>
          <div className={styles.clientIdentity}>
            <div className={styles.nameLine}><h2>{client.name || "Клієнт без імені"}</h2>{client.id.startsWith("demo_") && <span className={styles.demo}>DEMO</span>}</div>
            <a href={`tel:${client.phone}`}>{client.phone}</a>
          </div>
          <span className={styles.vehicleCount}>{client.vehicles.length} авто</span>
        </header>

        <div className={styles.vehicles}>
          {client.vehicles.length === 0 ? <div className={styles.noVehicle}>Автомобілі ще не додані</div> : client.vehicles.map((vehicle) => <div className={styles.vehicle} key={vehicle.id}>
            <div className={styles.vehicleTop}>
              <div>
                <strong>{[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Автомобіль"}</strong>
                <span>{vehicle.year || "рік ?"} · {vehicle.engineName || vehicle.fuelType || "двигун уточнюється"}</span>
              </div>
              {vehicle.plateNumber && <b className={styles.plate}>{vehicle.plateNumber}</b>}
            </div>
            <div className={styles.vehicleMeta}>
              <span>{formatMileage(vehicle.mileageKm)}</span>
              {vehicle.driveType && <span>{vehicle.driveType}</span>}
              {vehicle.bodyType && <span>{vehicle.bodyType}</span>}
              {vehicle.turboLevClass && <span>Клас {vehicle.turboLevClass}</span>}
              <span>×{coeff(vehicle.priceCoefficient)}</span>
            </div>
            <footer className={styles.vehicleFoot}>
              <span>Джерело: {vehicle.vehicleDataSource || "CRM"}</span>
              {vehicle.vehicleDataConfidence != null && <span>Довіра {vehicle.vehicleDataConfidence}%</span>}
            </footer>
          </div>)}
        </div>
      </article>)}
    </section>
  </div>;
}
