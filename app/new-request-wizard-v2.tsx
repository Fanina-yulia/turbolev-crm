"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  classifyVehicle,
  inferEngineVolume,
  TURBO_LEV_CLASS_COEFFICIENTS,
  TURBO_LEV_CLASS_LABELS,
  type TurboLevClass,
  type VehicleType,
} from "@/src/domain/vehicle-intelligence";

type RequestForm = {
  customerName: string;
  phone: string;
  source: string;
  responsible: string;
  plate: string;
  vin: string;
  make: string;
  model: string;
  year: string;
  mileage: string;
  engine: string;
  engineVolume: string;
  fuelType: string;
  bodyType: string;
  grossWeight: string;
  driveType: string;
  vehicleType: VehicleType;
  turboLevClass: TurboLevClass;
  priceCoefficient: string;
  classificationSource: string;
  classificationConfidence: string;
  classificationReason: string;
  manualClassOverride: boolean;
  category: string;
  complaint: string;
  urgency: string;
  appointmentDate: string;
  appointmentTime: string;
  preliminaryAmount: string;
  comment: string;
};

type StoredRequest = RequestForm & {
  id: string;
  createdAt: string;
  status: "NEW_LEAD" | "BOOKED";
};

type LookupState = "idle" | "searching" | "found" | "not-found" | "unavailable";

type ClientLookup = {
  name: string;
  phone: string;
  lastVisit: string;
  vehicles: StoredRequest[];
};

type VehicleCandidate = Partial<RequestForm> & {
  clientName?: string;
  clientPhone?: string;
  dataSource?: string;
  dataConfidence?: number;
};

const STORAGE_KEY = "turbolev-manual-requests-v1";

const initialForm: RequestForm = {
  customerName: "",
  phone: "",
  source: "Телефон",
  responsible: "Продавник",
  plate: "",
  vin: "",
  make: "",
  model: "",
  year: "",
  mileage: "",
  engine: "",
  engineVolume: "",
  fuelType: "",
  bodyType: "",
  grossWeight: "",
  driveType: "",
  vehicleType: "UNKNOWN",
  turboLevClass: "UNKNOWN",
  priceCoefficient: "1.00",
  classificationSource: "UNKNOWN",
  classificationConfidence: "0",
  classificationReason: "Очікуємо дані автомобіля",
  manualClassOverride: false,
  category: "",
  complaint: "",
  urgency: "Звичайна",
  appointmentDate: "",
  appointmentTime: "",
  preliminaryAmount: "",
  comment: "",
};

const categories = ["Ходова", "Гальма", "Двигун", "Електрика", "ТО / мастило", "Комп. діагностика", "Кондиціонер", "Інше"];

const vehicleTypeLabels: Record<VehicleType, string> = {
  PASSENGER: "Легковий",
  CROSSOVER: "Кросовер",
  SUV: "Позашляховик / SUV",
  MINIVAN: "Мінівен / MPV",
  VAN_SMALL: "Малий бус",
  VAN: "Бус",
  VAN_LARGE: "Великий бус",
  COMMERCIAL_HEAVY: "Дуже великий / комерційний",
  UNKNOWN: "Не визначено",
};

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "").slice(0, 10);
}

function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("380")) return digits.slice(0, 12);
  if (digits.startsWith("0")) return `38${digits}`.slice(0, 12);
  if (digits.length <= 9) return `380${digits}`.slice(0, 12);
  return digits.slice(0, 12);
}

function formatPhone(value: string) {
  const digits = normalizePhone(value);
  if (!digits) return "";
  const local = digits.startsWith("380") ? digits.slice(3, 12) : digits;
  const groups = [local.slice(0, 2), local.slice(2, 5), local.slice(5, 7), local.slice(7, 9)].filter(Boolean);
  return `+380${groups.length ? ` ${groups.join(" ")}` : ""}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function readStoredRequests(): StoredRequest[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqueVehicles(requests: StoredRequest[]) {
  const map = new Map<string, StoredRequest>();
  for (const item of [...requests].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
    const key = normalizeVin(item.vin || "") || normalizePlate(item.plate || "") || `${item.make}-${item.model}-${item.year}`;
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function classificationPatch(input: Partial<RequestForm>) {
  const result = classifyVehicle({
    make: input.make,
    model: input.model,
    year: input.year,
    engine: input.engine,
    engineVolume: input.engineVolume || inferEngineVolume(input.engine),
    fuelType: input.fuelType,
    bodyType: input.bodyType,
    grossWeight: input.grossWeight,
    driveType: input.driveType,
    vehicleType: input.vehicleType,
  });

  return {
    vehicleType: result.vehicleType,
    turboLevClass: result.turboLevClass,
    priceCoefficient: result.priceCoefficient.toFixed(2),
    classificationSource: result.source,
    classificationConfidence: String(result.confidence),
    classificationReason: result.reason,
  };
}

export function NewRequestWizardV2() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<RequestForm>(initialForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [plateLookupState, setPlateLookupState] = useState<LookupState>("idle");
  const [phoneLookupState, setPhoneLookupState] = useState<LookupState>("idle");
  const [foundClient, setFoundClient] = useState<ClientLookup | null>(null);
  const [foundVehicle, setFoundVehicle] = useState<VehicleCandidate | null>(null);

  const status = useMemo(() => (form.appointmentDate && form.appointmentTime ? "BOOKED" : "NEW_LEAD"), [form.appointmentDate, form.appointmentTime]);

  function update<K extends keyof RequestForm>(field: K, value: RequestForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function updatePhone(raw: string) {
    update("phone", formatPhone(raw));
  }

  function applyVehicle(candidate: VehicleCandidate) {
    setForm((current) => {
      const merged: RequestForm = {
        ...current,
        customerName: candidate.clientName || candidate.customerName || current.customerName,
        phone: candidate.clientPhone ? formatPhone(candidate.clientPhone) : candidate.phone ? formatPhone(candidate.phone) : current.phone,
        source: candidate.clientName || candidate.customerName ? "Повторний клієнт" : current.source,
        plate: normalizePlate(candidate.plate || current.plate),
        vin: normalizeVin(candidate.vin || ""),
        make: candidate.make || "",
        model: candidate.model || "",
        year: candidate.year ? String(candidate.year) : "",
        mileage: candidate.mileage ? String(candidate.mileage) : "",
        engine: candidate.engine || "",
        engineVolume: candidate.engineVolume || inferEngineVolume(candidate.engine) || "",
        fuelType: candidate.fuelType || "",
        bodyType: candidate.bodyType || "",
        grossWeight: candidate.grossWeight || "",
        driveType: candidate.driveType || "",
        vehicleType: (candidate.vehicleType as VehicleType) || "UNKNOWN",
        turboLevClass: (candidate.turboLevClass as TurboLevClass) || "UNKNOWN",
        priceCoefficient: candidate.priceCoefficient || "1.00",
        classificationSource: candidate.classificationSource || candidate.dataSource || "CRM",
        classificationConfidence: candidate.classificationConfidence || String(candidate.dataConfidence ?? 100),
        classificationReason: candidate.classificationReason || "Дані автомобіля підтягнуто з історії Turbo LEV",
        manualClassOverride: Boolean(candidate.manualClassOverride),
      };

      if (!merged.manualClassOverride) Object.assign(merged, classificationPatch(merged));
      return merged;
    });
    setStep(2);
  }

  function lookupPhone(rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    setFoundClient(null);
    if (phone.length !== 12) {
      setPhoneLookupState("idle");
      return;
    }

    setPhoneLookupState("searching");
    const existing = readStoredRequests()
      .filter((item) => normalizePhone(item.phone || "") === phone)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (!existing.length) {
      setPhoneLookupState("not-found");
      return;
    }

    const latest = existing[0];
    const client = {
      name: latest.customerName || "Клієнт Turbo LEV",
      phone,
      lastVisit: latest.createdAt,
      vehicles: uniqueVehicles(existing),
    };
    setFoundClient(client);
    setPhoneLookupState("found");
    setForm((current) => ({ ...current, customerName: client.name, phone: formatPhone(phone), source: "Повторний клієнт" }));
  }

  async function lookupPlate(rawPlate: string) {
    const plate = normalizePlate(rawPlate);
    setFoundVehicle(null);
    if (plate.length < 6) {
      setPlateLookupState("idle");
      return;
    }

    setPlateLookupState("searching");

    try {
      const response = await fetch(`/api/vehicles/lookup?plate=${encodeURIComponent(plate)}`, { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.status === "FOUND" && data.vehicle) {
        const vehicle = data.vehicle;
        const candidate: VehicleCandidate = {
          clientName: vehicle.clientName,
          clientPhone: vehicle.clientPhone,
          plate,
          vin: vehicle.vin ?? "",
          make: vehicle.make ?? "",
          model: vehicle.model ?? "",
          year: vehicle.year?.toString() ?? "",
          mileage: vehicle.mileageKm?.toString() ?? "",
          engine: vehicle.engine ?? "",
          engineVolume: vehicle.engineVolumeL?.toString() ?? "",
          fuelType: vehicle.fuelType ?? "",
          bodyType: vehicle.bodyType ?? "",
          grossWeight: vehicle.grossWeightKg?.toString() ?? "",
          driveType: vehicle.driveType ?? "",
          vehicleType: vehicle.vehicleType ?? "UNKNOWN",
          turboLevClass: vehicle.turboLevClass ?? "UNKNOWN",
          priceCoefficient: Number(vehicle.priceCoefficient ?? 1).toFixed(2),
          classificationSource: vehicle.classificationSource ?? "CRM",
          classificationConfidence: String(vehicle.classificationConfidence ?? 100),
          classificationReason: vehicle.classificationReason ?? "Дані знайдено у CRM",
          manualClassOverride: Boolean(vehicle.manualClassOverride),
          dataSource: vehicle.vehicleDataSource ?? "CRM",
          dataConfidence: vehicle.vehicleDataConfidence ?? 100,
        };
        setFoundVehicle(candidate);
        setPlateLookupState("found");
        applyVehicle(candidate);
        return;
      }
    } catch {
      // Local fallback below keeps the demo flow usable before DB/provider deployment.
    }

    const local = readStoredRequests()
      .filter((item) => normalizePlate(item.plate || "") === plate)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (local) {
      setFoundVehicle(local);
      setPlateLookupState("found");
      applyVehicle(local);
      return;
    }

    setPlateLookupState("not-found");
  }

  useEffect(() => {
    if (!open) return;
    const plate = normalizePlate(form.plate);
    if (plate.length < 6) return;
    const timer = window.setTimeout(() => void lookupPlate(plate), 450);
    return () => window.clearTimeout(timer);
  }, [form.plate, open]);

  useEffect(() => {
    if (!open) return;
    const phone = normalizePhone(form.phone);
    if (phone.length !== 12) return;
    const timer = window.setTimeout(() => lookupPhone(phone), 400);
    return () => window.clearTimeout(timer);
  }, [form.phone, open]);

  useEffect(() => {
    if (form.manualClassOverride) return;
    const patch = classificationPatch(form);
    if (
      patch.vehicleType === form.vehicleType &&
      patch.turboLevClass === form.turboLevClass &&
      patch.priceCoefficient === form.priceCoefficient &&
      patch.classificationReason === form.classificationReason
    ) return;
    setForm((current) => ({ ...current, ...patch }));
  }, [form.make, form.model, form.engine, form.engineVolume, form.bodyType, form.grossWeight, form.driveType, form.vehicleType, form.manualClassOverride]);

  function setManualClass(value: TurboLevClass) {
    setForm((current) => ({
      ...current,
      turboLevClass: value,
      priceCoefficient: TURBO_LEV_CLASS_COEFFICIENTS[value].toFixed(2),
      classificationSource: "MANUAL",
      classificationConfidence: "100",
      classificationReason: "Клас підтверджено або змінено менеджером",
      manualClassOverride: true,
    }));
  }

  function close() {
    setOpen(false);
    setStep(1);
    setError("");
    setPlateLookupState("idle");
    setPhoneLookupState("idle");
    setFoundClient(null);
    setFoundVehicle(null);
  }

  function validateStep() {
    if (step === 1) {
      if (!form.customerName.trim()) return "Вкажіть ім’я клієнта.";
      if (normalizePhone(form.phone).length !== 12) return "Вкажіть коректний номер телефону.";
    }
    if (step === 2) {
      if (!form.plate.trim()) return "Вкажіть державний номер автомобіля.";
      if (form.vin && form.vin.length !== 17) return "VIN має містити 17 символів або залиште поле порожнім.";
    }
    if (step === 3 && !form.complaint.trim()) return "Опишіть проблему або потребу клієнта.";
    return "";
  }

  function next() {
    const message = validateStep();
    if (message) return setError(message);
    setStep((current) => Math.min(4, current + 1));
  }

  function saveRequest(event: FormEvent) {
    event.preventDefault();
    const message = validateStep();
    if (message) return setError(message);

    const request: StoredRequest = {
      ...form,
      id: `REQ-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status,
      phone: formatPhone(form.phone),
      plate: normalizePlate(form.plate),
      vin: normalizeVin(form.vin),
    };

    const existing = readStoredRequests();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([request, ...existing]));
    window.dispatchEvent(new CustomEvent("turbolev:new-request", { detail: request }));
    setSuccess(status === "BOOKED" ? "Заявку створено і клієнта записано." : "Нову заявку створено.");
    setForm(initialForm);
    window.setTimeout(() => {
      setSuccess("");
      setOpen(false);
      setStep(1);
    }, 1200);
  }

  return (
    <>
      <button className="primary" type="button" onClick={() => setOpen(true)}>+ Нова заявка</button>

      {open && (
        <div className="requestModalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <form className="requestModal" onSubmit={saveRequest}>
            <div className="requestModalHead">
              <div><p className="eyebrow">TURBO LEV · НОВА ЗАЯВКА</p><h2>Клієнт + автомобіль</h2><span>Телефон / держномер → дані авто → клас Turbo LEV → заявка</span></div>
              <button className="requestClose" type="button" onClick={close} aria-label="Закрити">×</button>
            </div>

            <div className="quickLookupGrid">
              <div className="phoneQuickLookup">
                <div className="plateQuickCopy"><b>Клієнт по телефону</b><span>Номер автоматично приводиться до +380 XX XXX XX XX.</span></div>
                <div className="plateQuickControls"><input value={form.phone} onChange={(event) => updatePhone(event.target.value)} placeholder="0 67 123 45 67" inputMode="tel" autoFocus /><button type="button" onClick={() => lookupPhone(form.phone)}>Знайти</button></div>
                {phoneLookupState === "searching" && <div className="vehicleLookupState searching">Шукаю клієнта…</div>}
                {phoneLookupState === "found" && foundClient && (
                  <div className="clientLookupCard">
                    <div className="clientLookupHead"><div className="clientLookupAvatar">{foundClient.name.slice(0, 1).toUpperCase()}</div><div><b>{foundClient.name}</b><span>{formatPhone(foundClient.phone)}</span><small>Останнє звернення: {formatDate(foundClient.lastVisit)}</small></div></div>
                    <div className="clientVehiclesTitle"><b>Усі автомобілі клієнта</b><span>{foundClient.vehicles.length}</span></div>
                    <div className="clientVehiclesList">{foundClient.vehicles.map((vehicle) => <button type="button" key={`${vehicle.id}-${vehicle.plate}`} className="clientVehicleCard" onClick={() => applyVehicle(vehicle)}><div className="clientVehiclePlate">{normalizePlate(vehicle.plate) || "БЕЗ НОМЕРА"}</div><div className="clientVehicleInfo"><b>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль"}</b><span>{vehicle.vin ? `VIN ${vehicle.vin}` : "VIN не вказаний"}</span></div><div className="clientVehicleChoose">Обрати →</div></button>)}</div>
                  </div>
                )}
              </div>

              <div className="plateQuickLookup">
                <div className="plateQuickCopy"><b>Глобальний пошук авто</b><span>Спочатку CRM, далі — зовнішній провайдер після підключення API.</span></div>
                <div className="plateQuickControls"><input value={form.plate} onChange={(event) => update("plate", normalizePlate(event.target.value))} placeholder="AA1234BB" /><button type="button" onClick={() => void lookupPlate(form.plate)}>Знайти</button></div>
                {plateLookupState === "searching" && <div className="vehicleLookupState searching">Шукаю автомобіль…</div>}
                {plateLookupState === "found" && foundVehicle && <div className="vehicleLookupResult found"><div className="vehicleLookupIcon">✓</div><div className="vehicleLookupMain"><b>Автомобіль знайдено</b><strong>{[form.make, form.model, form.year].filter(Boolean).join(" ") || form.plate}</strong><span>{form.vin ? `VIN ${form.vin}` : "VIN поки не знайдений"}</span></div><div className="vehicleLookupMeta"><small>Клас</small><b>{TURBO_LEV_CLASS_LABELS[form.turboLevClass]}</b><span>×{form.priceCoefficient}</span></div></div>}
                {plateLookupState === "not-found" && <div className="vehicleLookupResult empty"><div className="vehicleLookupIcon">→</div><div><b>У CRM авто ще немає</b><span>Поля готові для зовнішнього API: VIN, марка, модель, рік, двигун і класифікація.</span></div></div>}
              </div>
            </div>

            <div className="requestStepper">{["Клієнт", "Автомобіль", "Проблема", "Запис"].map((label, index) => { const number = index + 1; return <button type="button" key={label} className={number === step ? "active" : number < step ? "done" : ""} onClick={() => number < step && setStep(number)}><b>{number < step ? "✓" : number}</b><span>{label}</span></button>; })}</div>

            <div className="requestBody">
              {step === 1 && <section className="requestStep"><div className="requestStepTitle"><div><small>КРОК 1</small><h3>Картка клієнта</h3></div></div><div className="requestGrid two"><label><span>Ім’я клієнта *</span><input value={form.customerName} onChange={(e) => update("customerName", e.target.value)} /></label><label><span>Телефон *</span><input value={form.phone} onChange={(e) => updatePhone(e.target.value)} inputMode="tel" /></label><label><span>Джерело</span><select value={form.source} onChange={(e) => update("source", e.target.value)}><option>Телефон</option><option>Google Maps</option><option>Instagram</option><option>Facebook</option><option>TikTok</option><option>Рекомендація</option><option>Повторний клієнт</option><option>Заїхав без запису</option><option>Інше</option></select></label><label><span>Відповідальний</span><select value={form.responsible} onChange={(e) => update("responsible", e.target.value)}><option>Продавник</option><option>РОП</option><option>Завідуючий</option><option>Не призначено</option></select></label></div></section>}

              {step === 2 && <section className="requestStep"><div className="requestStepTitle"><div><small>КРОК 2</small><h3>Технічний профіль автомобіля</h3></div><span className="requestHint">Автокласифікація для прайсу</span></div><div className="requestVehicleMain"><label className="plateField"><span>Державний номер *</span><input value={form.plate} onChange={(e) => update("plate", normalizePlate(e.target.value))} /></label><label className="vinField"><span>VIN</span><input value={form.vin} onChange={(e) => update("vin", normalizeVin(e.target.value))} placeholder="17 символів" /><small>{form.vin ? `${form.vin.length}/17` : "Після отримання VIN запускаємо VIN-декодер"}</small></label></div><div className="requestGrid three"><label><span>Марка</span><input value={form.make} onChange={(e) => update("make", e.target.value)} /></label><label><span>Модель</span><input value={form.model} onChange={(e) => update("model", e.target.value)} /></label><label><span>Рік</span><input value={form.year} onChange={(e) => update("year", e.target.value.replace(/\D/g, "").slice(0, 4))} /></label><label><span>Двигун</span><input value={form.engine} onChange={(e) => update("engine", e.target.value)} placeholder="2.0 TDI" /></label><label><span>Об’єм двигуна, л</span><input value={form.engineVolume} onChange={(e) => update("engineVolume", e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="2.0" /></label><label><span>Паливо</span><input value={form.fuelType} onChange={(e) => update("fuelType", e.target.value)} placeholder="Дизель" /></label><label><span>Тип кузова</span><input value={form.bodyType} onChange={(e) => update("bodyType", e.target.value)} placeholder="SUV / Van / Sedan" /></label><label><span>Повна маса, кг</span><input value={form.grossWeight} onChange={(e) => update("grossWeight", e.target.value.replace(/\D/g, ""))} /></label><label><span>Привід</span><input value={form.driveType} onChange={(e) => update("driveType", e.target.value)} placeholder="FWD / RWD / AWD" /></label><label><span>Пробіг, км</span><input value={form.mileage} onChange={(e) => update("mileage", e.target.value.replace(/\D/g, ""))} /></label><label><span>Тип ТЗ</span><select value={form.vehicleType} onChange={(e) => update("vehicleType", e.target.value as VehicleType)}>{Object.entries(vehicleTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="vehicleIntelligenceCard"><div><small>КЛАС TURBO LEV</small><strong>{TURBO_LEV_CLASS_LABELS[form.turboLevClass]}</strong><span>{form.classificationReason}</span></div><div className="vehicleCoefficient"><small>Коефіцієнт прайсу</small><b>×{form.priceCoefficient}</b><span>Впевненість {form.classificationConfidence}%</span></div><label><span>Якщо система помилилась</span><select value={form.turboLevClass} onChange={(e) => setManualClass(e.target.value as TurboLevClass)}>{Object.entries(TURBO_LEV_CLASS_LABELS).map(([value, label]) => <option key={value} value={value}>{value} — {label}</option>)}</select></label></div></section>}

              {step === 3 && <section className="requestStep"><div className="requestStepTitle"><div><small>КРОК 3</small><h3>Що турбує клієнта</h3></div></div><label className="requestFullField"><span>Категорія звернення</span><input value={form.category} onChange={(e) => update("category", e.target.value)} /></label><div className="requestTags">{categories.map((item) => <button type="button" key={item} className={form.category === item ? "selected" : ""} onClick={() => update("category", item)}>{item}</button>)}</div><label className="requestFullField"><span>Проблема / побажання клієнта *</span><textarea value={form.complaint} onChange={(e) => update("complaint", e.target.value)} /></label><div className="requestGrid two compactTop"><label><span>Пріоритет</span><select value={form.urgency} onChange={(e) => update("urgency", e.target.value)}><option>Звичайна</option><option>Терміново</option><option>Авто не на ходу</option></select></label><label><span>Внутрішній коментар</span><input value={form.comment} onChange={(e) => update("comment", e.target.value)} /></label></div></section>}

              {step === 4 && <section className="requestStep"><div className="requestStepTitle"><div><small>КРОК 4</small><h3>Запис і підтвердження</h3></div><span className={status === "BOOKED" ? "requestStatus booked" : "requestStatus"}>{status === "BOOKED" ? "Записаний" : "Нова заявка"}</span></div><div className="requestGrid three"><label><span>Дата заїзду</span><input type="date" value={form.appointmentDate} onChange={(e) => update("appointmentDate", e.target.value)} /></label><label><span>Час</span><input type="time" value={form.appointmentTime} onChange={(e) => update("appointmentTime", e.target.value)} /></label><label><span>Попередня сума, грн</span><input value={form.preliminaryAmount} onChange={(e) => update("preliminaryAmount", e.target.value.replace(/[^0-9.,]/g, ""))} /></label></div><div className="requestSummary"><article><small>Клієнт</small><strong>{form.customerName}</strong><span>{form.phone}</span></article><article><small>Автомобіль</small><strong>{[form.make, form.model, form.year].filter(Boolean).join(" ") || form.plate}</strong><span>{form.vin || "VIN не вказаний"}</span></article><article><small>Клас / прайс</small><strong>{TURBO_LEV_CLASS_LABELS[form.turboLevClass]}</strong><span>Коефіцієнт ×{form.priceCoefficient}</span></article><article><small>Звернення</small><strong>{form.category || "Без категорії"}</strong><span>{form.complaint}</span></article></div></section>}

              {error && <div className="requestMessage error">{error}</div>}
              {success && <div className="requestMessage success">{success}</div>}
            </div>

            <div className="requestActions"><button type="button" className="ghost" onClick={close}>Скасувати</button><div>{step > 1 && <button type="button" className="ghost" onClick={() => setStep((current) => Math.max(1, current - 1))}>← Назад</button>}{step < 4 ? <button type="button" className="primary" onClick={next}>Далі →</button> : <button type="submit" className="primary">Створити заявку</button>}</div></div>
          </form>
        </div>
      )}
    </>
  );
}
