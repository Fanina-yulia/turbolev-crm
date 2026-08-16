"use client";

import { useState } from "react";
import styles from "./global-vehicle-search.module.css";

type VehicleResult = {
  vin?: string | null;
  wmi?: string | null;
  region?: string | null;
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
  transmission?: string | null;
  plantCountry?: string | null;
  turboLevClass?: string | null;
  turboLevClassLabel?: string | null;
  priceCoefficient?: number | null;
  classificationConfidence?: number | null;
  classificationReason?: string | null;
};

type Validation = {
  region?: string;
  wmi?: string | null;
  checkDigit?: { status?: string; actual?: string | null; expected?: string | null };
  warnings?: string[];
};

type ClassificationResult = {
  turboLevClass?: string;
  label?: string;
  priceCoefficient?: number;
  confidence?: number;
  reason?: string;
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
  const [confidence, setConfidence] = useState<number | null>(null);
  const [fieldConfidence, setFieldConfidence] = useState<Record<string, number>>({});
  const [validation, setValidation] = useState<Validation | null>(null);
  const [cached, setCached] = useState(false);

  async function lookupPlate() {
    const normalized = normalizePlate(plate);
    if (normalized.length < 6) return setMessage("Вкажіть державний номер.");
    setBusy(true); setMessage(""); setResult(null); setAskVin(false); setConfidence(null); setValidation(null);
    try {
      const response = await fetch(`/api/vehicles/lookup?plate=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.status === "FOUND" && data.vehicle) {
        setResult(data.vehicle);
        setVin(data.vehicle.vin ?? "");
        setSource(data.lookupLevel ?? data.vehicle.vehicleDataSource ?? "CRM");
        setConfidence(data.vehicle.vehicleDataConfidence ?? null);
        setAskVin(false);
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
    setBusy(true); setMessage(""); setResult(null); setConfidence(null); setFieldConfidence({}); setValidation(null);
    try {
      const response = await fetch(`/api/vehicles/vin?vin=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const data = await response.json();
      setValidation(data.validation ?? null);
      if (response.ok && data.status === "FOUND" && data.vehicle) {
        const classification = (data.classification ?? {}) as ClassificationResult;
        setResult({
          ...data.vehicle,
          turboLevClass: classification.turboLevClass ?? null,
          turboLevClassLabel: classification.label ?? null,
          priceCoefficient: classification.priceCoefficient ?? 1,
          classificationConfidence: classification.confidence ?? null,
          classificationReason: classification.reason ?? null,
        });
        setSource(data.sourceDetail ?? data.source ?? "NHTSA_VPIC_API");
        setConfidence(typeof data.confidence === "number" ? data.confidence : null);
        setFieldConfidence(data.fieldConfidence ?? {});
        setCached(Boolean(data.cached));
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
    setOpen(false); setMessage(""); setResult(null); setAskVin(false); setConfidence(null); setFieldConfidence({}); setValidation(null); setCached(false);
  }

  return <div className={styles.wrap}>
    <button className={styles.button} type="button" onClick={() => setOpen(true)}>Пошук VIN / номер</button>
    {open && <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={styles.modal}>
        <div className={styles.head}><div><p>TURBO LEV · VEHICLE ID</p><h2>Ідентифікація автомобіля</h2></div><button className={styles.close} onClick={close}>×</button></div>
        <div className={styles.body}>
          <label className={styles.label}><span>Державний номер</span><div className={styles.row}><input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="AA1234BB / AB1234" /><button type="button" onClick={lookupPlate} disabled={busy}>{busy ? "Шукаю…" : "Знайти"}</button></div></label>
          {askVin && !result && <div className={styles.askVin}><b>Авто не знайдено за держномером</b><span>Введіть VIN, щоб продовжити ідентифікацію автомобіля.</span></div>}
          <label className={styles.label}><span>VIN</span><div className={styles.row}><input value={vin} onChange={(e) => setVin(normalizeVin(e.target.value))} placeholder="17 символів" /><button type="button" onClick={lookupVin} disabled={busy}>{busy ? "Декодую…" : "Декодувати VIN"}</button></div></label>

          {validation && <div className={styles.validation}>
            <div><small>WMI</small><b>{validation.wmi ?? "—"}</b></div>
            <div><small>Регіон</small><b>{validation.region ?? "—"}</b></div>
            <div><small>Контроль VIN</small><b>{validation.checkDigit?.status ?? "—"}</b></div>
          </div>}

          {message && <div className={styles.hint}>{message}</div>}
          {result && <div className={styles.result}>
            <div className={styles.resultHead}><div><strong>{[result.make, result.model, result.year].filter(Boolean).join(" ") || "Автомобіль знайдено"}</strong>{result.vin && <span>VIN {result.vin}</span>}</div>{confidence != null && <div className={styles.score}><small>Довіра даних</small><b>{confidence}%</b></div>}</div>
            {result.turboLevClassLabel && <div className={styles.validation}>
              <div><small>Категорія Turbo LEV</small><b>{result.turboLevClassLabel}</b></div>
              <div><small>Коефіцієнт робіт</small><b>×{Number(result.priceCoefficient ?? 1).toFixed(2)}</b></div>
              <div><small>Довіра категорії</small><b>{result.classificationConfidence ?? "—"}%</b></div>
            </div>}
            {result.classificationReason && <div className={styles.hint}>{result.classificationReason}</div>}
            <div className={styles.meta}>{result.engineVolumeL && <span>{result.engineVolumeL} л · {fieldConfidence.engineVolumeL ?? "—"}%</span>}{result.engine && <span>{result.engine} · {fieldConfidence.engine ?? "—"}%</span>}{result.fuelType && <span>{result.fuelType} · {fieldConfidence.fuelType ?? "—"}%</span>}{result.bodyType && <span>{result.bodyType} · {fieldConfidence.bodyType ?? "—"}%</span>}{result.driveType && <span>{result.driveType} · {fieldConfidence.driveType ?? "—"}%</span>}{result.transmission && <span>{result.transmission}</span>}{result.trim && <span>{result.trim}</span>}{result.plantCountry && <span>{result.plantCountry}</span>}</div>
            <small className={styles.source}>Джерело: {source}{cached ? " · кеш Turbo LEV" : ""}</small>
          </div>}
          <div className={styles.hint}>Каскад: український номер → локальний МВС → VIN → кеш Turbo LEV → локальний vPIC → NHTSA API. Категорія Turbo LEV визначається окремим класифікатором. Коефіцієнт призначений тільки для робіт, не для запчастин; низька впевненість потребує підтвердження менеджера.</div>
        </div>
      </div>
    </div>}
  </div>;
}
