"use client";

import { useState } from "react";
import styles from "./parts-catalog.module.css";

type Part = {
  name?: string;
  slug?: string;
  category?: string;
  description?: string;
  fitment?: { status?: string; confidence?: number; confirmed?: boolean; reason?: string };
};

type VehicleContext = {
  vin?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  engine?: string | null;
  engineVolumeL?: number | null;
  fuelType?: string | null;
  confidence?: number;
  source?: string | null;
  generation?: { name?: string; yearFrom?: number; yearTo?: number | null } | null;
};

function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

export function PartsCatalog() {
  const [q, setQ] = useState("");
  const [vin, setVin] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [vehicle, setVehicle] = useState<VehicleContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Введіть VIN, якщо він є, і назву потрібної деталі.");

  async function search() {
    const query = q.trim();
    if (query.length < 2) return setMessage("Введіть щонайменше 2 символи назви деталі.");
    if (vin && normalizeVin(vin).length !== 17) return setMessage("VIN має містити 17 символів або залиште поле порожнім.");

    setBusy(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (vin) params.set("vin", normalizeVin(vin));
      const response = await fetch(`/api/parts/search?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      setParts(Array.isArray(data.parts) ? data.parts : []);
      setVehicle(data.vehicle ?? null);
      setMessage(data.fitmentPolicy?.message ?? "Готово.");
    } catch {
      setParts([]);
      setVehicle(null);
      setMessage("Каталог тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.page}>
    <div className={styles.head}>
      <div><p>TURBO LEV · PARTS INTELLIGENCE</p><h1>Підбір запчастин</h1></div>
      <span className={styles.badge}>VIN + FREE CATALOG</span>
    </div>

    <section className={styles.panel}>
      <div className={styles.contextGrid}>
        <label className={styles.field}><span>VIN автомобіля</span><input value={vin} onChange={(e) => setVin(normalizeVin(e.target.value))} placeholder="17 символів" /><small>{vin ? `${vin.length}/17` : "Необов’язково, але сильно підвищує якість контексту"}</small></label>
        <label className={styles.field}><span>Що шукаємо</span><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Напр.: амортизатор, колодки, bearing…" /></label>
        <button className={styles.primary} type="button" onClick={search} disabled={busy}>{busy ? "Аналізую…" : "Знайти"}</button>
      </div>

      {vehicle && <div className={styles.vehicleCard}>
        <div><small>АВТО ПО VIN</small><strong>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.vin}</strong><span>{vehicle.vin}</span></div>
        <div className={styles.vehicleMeta}>{vehicle.engineVolumeL && <span>{vehicle.engineVolumeL} л</span>}{vehicle.engine && <span>{vehicle.engine}</span>}{vehicle.fuelType && <span>{vehicle.fuelType}</span>}{vehicle.generation?.name && <span>{vehicle.generation.name}</span>}</div>
        <div className={styles.confidence}><small>Довіра до авто</small><b>{vehicle.confidence ?? 0}%</b><span>{vehicle.source ?? "VIN decoder"}</span></div>
      </div>}

      <div className={styles.note}>{message}</div>
      <div className={styles.guard}><b>Hard Gate сумісності:</b> безкоштовний каталог дає лише довідкові кандидати. Кнопка замовлення має бути розблокована тільки після OEM/API підтвердження конкретної деталі під VIN.</div>

      {parts.length ? <div className={styles.grid}>{parts.map((part, index) => <article className={styles.card} key={`${part.slug ?? part.name}-${index}`}>
        <div className={styles.cardTop}><b>{part.name ?? "Деталь"}</b><span className={styles.unverified}>НЕ ПІДТВЕРДЖЕНО</span></div>
        {part.category && <span>{part.category}</span>}
        {part.slug && <small>{part.slug}</small>}
        {part.description && <small>{part.description}</small>}
        {part.fitment && <div className={styles.fitment}><span>Контекст {part.fitment.confidence ?? 0}%</span><small>{part.fitment.reason}</small></div>}
      </article>)}</div> : <div className={styles.empty}>Результати з’являться тут.</div>}
    </section>
  </div>;
}
