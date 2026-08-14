"use client";

import { useState } from "react";
import styles from "./global-vehicle-search.module.css";

type VehicleResult = {
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  engine?: string | null;
  engineVolumeL?: number | null;
  fuelType?: string | null;
  bodyType?: string | null;
  driveType?: string | null;
  trim?: string | null;
  series?: string | null;
  plantCountry?: string | null;
};

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "").slice(0, 12);
}

function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

export function GlobalVehicleSearch() {
  const [open, setOpen] = useState(false);
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [result, setResult] = useState<VehicleResult | null>(null);
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [askVin, setAskVin] = useState(false);
  const [busy, setBusy] = useState(false);

  async function lookupPlate() {
    const normalized = normalizePlate(plate);
    if (normalized.length < 6) return setMessage("Вкажіть державний номер.");
    setBusy(true); setMessage(""); setResult(null); setAskVin(false);
    try {
      const response = await fetch(`/api/vehicles/lookup?plate=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.status === "FOUND" && data.vehicle) {
        setResult(data.vehicle);
        setVin(data.vehicle.vin ?? "");
        setSource(data.lookupLevel ?? data.vehicle.vehicleDataSource ?? "CRM");
      } else {
        setAskVin(true);
        setMessage("Номер не знайдено в українській базі. Для іноземного або невідомого номера введіть VIN.");
      }
    } catch {
      setAskVin(true);
      setMessage("Пошук по номеру недоступний. Введіть VIN для ідентифікації авто.");
    } finally { setBusy(false); }
  }

  async function lookupVin() {
    const normalized = normalizeVin(vin);
    if (normalized.length !== 17) return setMessage("VIN має містити 17 символів.");
    setBusy(true); setMessage(""); setResult(null);
    try {
      const response = await fetch(`/api/vehicles/vin?vin=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.status === "FOUND" && data.vehicle) {
        setResult(data.vehicle);
        setSource(data.source ?? "NHTSA_VPIC");
        setAskVin(false);
        if (data.warning) setMessage(data.warning);
      } else {
        setMessage(data.message ?? data.warning ?? "VIN не вдалося декодувати автоматично. Дані можна внести вручну.");
      }
    } catch {
      setMessage("VIN-декодер тимчасово недоступний.");
    } finally { setBusy(false); }
  }

  function close() {
    setOpen(false); setMessage(""); setResult(null); setAskVin(false);
  }

  return <div className={styles.wrap}>
    <button className={styles.button} type="button" onClick={() => setOpen(true)}>Пошук VIN / номер</button>
    {open && <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={styles.modal}>
        <div className={styles.head}><div><p>TURBO LEV · VEHICLE ID</p><h2>Ідентифікація автомобіля</h2></div><button className={styles.close} onClick={close}>×</button></div>
        <div className={styles.body}>
          <label className={styles.label}><span>Державний номер</span><div className={styles.row}><input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="AA1234BB / AB1234" /><button type="button" onClick={lookupPlate} disabled={busy}>{busy ? "Шукаю…" : "Знайти"}</button></div></label>
          {(askVin || vin) && <div className={styles.askVin}><b>Не український номер або авто не знайдено?</b><span>Введіть VIN — це наш основний fallback для Латвії, Литви, Польщі, Німеччини та інших країн.</span></div>}
          <label className={styles.label}><span>VIN</span><div className={styles.row}><input value={vin} onChange={(e) => setVin(normalizeVin(e.target.value))} placeholder="17 символів" /><button type="button" onClick={lookupVin} disabled={busy}>{busy ? "Декодую…" : "Декодувати VIN"}</button></div></label>
          {message && <div className={styles.hint}>{message}</div>}
          {result && <div className={styles.result}><strong>{[result.make, result.model, result.year].filter(Boolean).join(" ") || "Автомобіль знайдено"}</strong>{result.vin && <span>VIN {result.vin}</span>}<div className={styles.meta}>{result.engineVolumeL && <span>{result.engineVolumeL} л</span>}{result.engine && <span>{result.engine}</span>}{result.fuelType && <span>{result.fuelType}</span>}{result.bodyType && <span>{result.bodyType}</span>}{result.driveType && <span>{result.driveType}</span>}{result.trim && <span>{result.trim}</span>}{result.plantCountry && <span>{result.plantCountry}</span>}</div><small className={styles.source}>Джерело: {source}</small></div>}
          <div className={styles.hint}>Логіка CRM: український номер → локальний індекс МВС. Не знайдено / іноземний номер → просимо VIN → безкоштовний VIN-декодер.</div>
        </div>
      </div>
    }</div>}
  </div>;
}
