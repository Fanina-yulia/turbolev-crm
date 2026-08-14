"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
  engine: string;
  mileage: string;
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

type LookupState = "idle" | "searching" | "found" | "not-found";

type ClientLookup = {
  name: string;
  phone: string;
  lastVisit: string;
  vehicles: StoredRequest[];
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
  engine: "",
  mileage: "",
  category: "",
  complaint: "",
  urgency: "Звичайна",
  appointmentDate: "",
  appointmentTime: "",
  preliminaryAmount: "",
  comment: "",
};

const categories = [
  "Ходова",
  "Гальма",
  "Двигун",
  "Електрика",
  "ТО / мастило",
  "Комп. діагностика",
  "Кондиціонер",
  "Інше",
];

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "").slice(0, 10);
}

function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("380")) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `38${digits}`;
  if (digits.length === 9) return `380${digits}`;
  return digits;
}

function formatPhone(value: string) {
  const digits = normalizePhone(value);
  if (digits.length !== 12 || !digits.startsWith("380")) return value;
  return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
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
  for (const item of requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
    const key = normalizeVin(item.vin || "") || normalizePlate(item.plate || "") || `${item.make}-${item.model}-${item.year}`;
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

export function NewRequestWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<RequestForm>(initialForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>("idle");
  const [foundRequest, setFoundRequest] = useState<StoredRequest | null>(null);
  const [phoneLookupState, setPhoneLookupState] = useState<LookupState>("idle");
  const [foundClient, setFoundClient] = useState<ClientLookup | null>(null);

  const status = useMemo(
    () => (form.appointmentDate && form.appointmentTime ? "BOOKED" : "NEW_LEAD"),
    [form.appointmentDate, form.appointmentTime],
  );

  function update<K extends keyof RequestForm>(field: K, value: RequestForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function applyFoundVehicle(request: StoredRequest) {
    setForm((current) => ({
      ...current,
      customerName: request.customerName || current.customerName,
      phone: request.phone || current.phone,
      source: "Повторний клієнт",
      plate: normalizePlate(request.plate),
      vin: normalizeVin(request.vin || ""),
      make: request.make || "",
      model: request.model || "",
      year: request.year || "",
      engine: request.engine || "",
      mileage: request.mileage || "",
    }));
    setStep(2);
  }

  function applyFoundClient(client: ClientLookup) {
    setForm((current) => ({
      ...current,
      customerName: client.name || current.customerName,
      phone: formatPhone(client.phone),
      source: "Повторний клієнт",
    }));
  }

  function lookupByPlate(rawPlate: string, autoApply = true) {
    const plate = normalizePlate(rawPlate);
    setFoundRequest(null);

    if (plate.length < 6) {
      setLookupState("idle");
      return;
    }

    setLookupState("searching");
    const existing = readStoredRequests()
      .filter((item) => normalizePlate(item.plate || "") === plate)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const match = existing[0] ?? null;
    if (match) {
      setFoundRequest(match);
      setLookupState("found");
      if (autoApply) applyFoundVehicle(match);
    } else {
      setLookupState("not-found");
    }
  }

  function lookupByPhone(rawPhone: string, autoApply = true) {
    const phone = normalizePhone(rawPhone);
    setFoundClient(null);

    if (phone.length < 10) {
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
    const client: ClientLookup = {
      name: latest.customerName || existing.find((item) => item.customerName)?.customerName || "Клієнт Turbo LEV",
      phone,
      lastVisit: latest.createdAt,
      vehicles: uniqueVehicles(existing),
    };

    setFoundClient(client);
    setPhoneLookupState("found");
    if (autoApply) applyFoundClient(client);
  }

  useEffect(() => {
    if (!open) return;
    const plate = normalizePlate(form.plate);
    if (plate.length < 6) {
      setLookupState("idle");
      setFoundRequest(null);
      return;
    }
    const timer = window.setTimeout(() => lookupByPlate(plate), 350);
    return () => window.clearTimeout(timer);
  }, [form.plate, open]);

  useEffect(() => {
    if (!open) return;
    const phone = normalizePhone(form.phone);
    if (phone.length < 10) {
      setPhoneLookupState("idle");
      setFoundClient(null);
      return;
    }
    const timer = window.setTimeout(() => lookupByPhone(phone), 350);
    return () => window.clearTimeout(timer);
  }, [form.phone, open]);

  function close() {
    setOpen(false);
    setStep(1);
    setError("");
    setLookupState("idle");
    setFoundRequest(null);
    setPhoneLookupState("idle");
    setFoundClient(null);
  }

  function validateCurrentStep() {
    if (step === 1) {
      if (!form.customerName.trim()) return "Вкажіть ім’я клієнта.";
      if (normalizePhone(form.phone).length < 10) return "Вкажіть коректний номер телефону.";
    }
    if (step === 2) {
      if (!form.plate.trim()) return "Вкажіть державний номер автомобіля.";
      if (form.vin && form.vin.length !== 17) return "VIN має містити 17 символів або залиште поле порожнім.";
    }
    if (step === 3 && !form.complaint.trim()) return "Опишіть проблему або потребу клієнта.";
    return "";
  }

  function next() {
    const message = validateCurrentStep();
    if (message) {
      setError(message);
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  }

  function back() {
    setError("");
    setStep((current) => Math.max(1, current - 1));
  }

  function saveRequest(event: FormEvent) {
    event.preventDefault();
    const message = validateCurrentStep();
    if (message) {
      setError(message);
      return;
    }

    const request: StoredRequest = {
      id: `REQ-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status,
      ...form,
      phone: formatPhone(form.phone),
      plate: normalizePlate(form.plate),
      vin: normalizeVin(form.vin),
    };

    const existing = readStoredRequests();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([request, ...existing]));
    window.dispatchEvent(new CustomEvent("turbolev:new-request", { detail: request }));

    setSuccess(status === "BOOKED" ? "Заявку створено і клієнта записано." : "Нову заявку створено.");
    setForm(initialForm);
    setStep(1);
    setLookupState("idle");
    setFoundRequest(null);
    setPhoneLookupState("idle");
    setFoundClient(null);
    window.setTimeout(() => {
      setSuccess("");
      setOpen(false);
    }, 1200);
  }

  return (
    <>
      <button className="primary" type="button" onClick={() => setOpen(true)}>
        + Нова заявка
      </button>

      {open && (
        <div className="requestModalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <form className="requestModal" onSubmit={saveRequest}>
            <div className="requestModalHead">
              <div>
                <p className="eyebrow">TURBO LEV · РУЧНЕ СТВОРЕННЯ</p>
                <h2>Нова заявка</h2>
                <span>Пошук клієнта / авто → потреба → запис</span>
              </div>
              <button className="requestClose" type="button" onClick={close} aria-label="Закрити">×</button>
            </div>

            <div className="quickLookupGrid">
              <div className="phoneQuickLookup">
                <div className="plateQuickCopy">
                  <b>Пошук клієнта по телефону</b>
                  <span>Якщо клієнт уже є — показуємо картку та всі його автомобілі.</span>
                </div>
                <div className="plateQuickControls">
                  <input value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="+380 67 123 45 67" aria-label="Телефон клієнта" inputMode="tel" autoFocus />
                  <button type="button" onClick={() => lookupByPhone(form.phone)}>Знайти</button>
                </div>

                {phoneLookupState === "searching" && <div className="vehicleLookupState searching">Шукаю клієнта у базі Turbo LEV…</div>}

                {phoneLookupState === "found" && foundClient && (
                  <div className="clientLookupCard">
                    <div className="clientLookupHead">
                      <div className="clientLookupAvatar">{foundClient.name.slice(0, 1).toUpperCase()}</div>
                      <div>
                        <b>{foundClient.name}</b>
                        <span>{formatPhone(foundClient.phone)}</span>
                        <small>Останнє звернення: {formatDate(foundClient.lastVisit)}</small>
                      </div>
                      <button type="button" onClick={() => applyFoundClient(foundClient)}>Використати клієнта</button>
                    </div>
                    <div className="clientVehiclesTitle">
                      <b>Автомобілі клієнта</b>
                      <span>{foundClient.vehicles.length}</span>
                    </div>
                    <div className="clientVehiclesList">
                      {foundClient.vehicles.map((vehicle) => (
                        <button type="button" key={`${vehicle.id}-${vehicle.plate}-${vehicle.vin}`} className="clientVehicleCard" onClick={() => applyFoundVehicle(vehicle)}>
                          <div className="clientVehiclePlate">{normalizePlate(vehicle.plate) || "БЕЗ НОМЕРА"}</div>
                          <div className="clientVehicleInfo">
                            <b>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль"}</b>
                            <span>{vehicle.vin ? `VIN ${vehicle.vin}` : "VIN не вказаний"}</span>
                            <small>{vehicle.engine || "Двигун не вказаний"}{vehicle.mileage ? ` · ${vehicle.mileage} км` : ""}</small>
                          </div>
                          <div className="clientVehicleChoose">Обрати →</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {phoneLookupState === "not-found" && (
                  <div className="vehicleLookupResult empty">
                    <div className="vehicleLookupIcon">+</div>
                    <div><b>Клієнта з таким телефоном ще немає</b><span>Створюємо нову картку клієнта без дублювання існуючих даних.</span></div>
                  </div>
                )}
              </div>

              <div className="plateQuickLookup">
                <div className="plateQuickCopy">
                  <b>Пошук по номеру авто</b>
                  <span>Перевіряємо базу Turbo LEV і підтягуємо клієнта та дані автомобіля.</span>
                </div>
                <div className="plateQuickControls">
                  <input value={form.plate} onChange={(event) => update("plate", normalizePlate(event.target.value))} placeholder="AA1234BB" aria-label="Державний номер автомобіля" />
                  <button type="button" onClick={() => lookupByPlate(form.plate)}>Знайти</button>
                </div>

                {lookupState === "searching" && <div className="vehicleLookupState searching">Шукаю автомобіль у базі Turbo LEV…</div>}

                {lookupState === "found" && foundRequest && (
                  <div className="vehicleLookupResult found">
                    <div className="vehicleLookupIcon">✓</div>
                    <div className="vehicleLookupMain">
                      <b>Автомобіль знайдено</b>
                      <strong>{[foundRequest.make, foundRequest.model, foundRequest.year].filter(Boolean).join(" ") || foundRequest.plate}</strong>
                      <span>{normalizePlate(foundRequest.plate)}{foundRequest.vin ? ` · VIN ${foundRequest.vin}` : ""}</span>
                    </div>
                    <div className="vehicleLookupMeta"><small>Клієнт</small><b>{foundRequest.customerName || "—"}</b><span>{foundRequest.phone || "—"}</span></div>
                    <div className="vehicleLookupMeta"><small>Останнє звернення</small><b>{formatDate(foundRequest.createdAt)}</b><span>{foundRequest.mileage ? `${foundRequest.mileage} км` : "Пробіг не вказаний"}</span></div>
                    <button type="button" className="lookupUseButton" onClick={() => applyFoundVehicle(foundRequest)}>Підтягнути дані</button>
                  </div>
                )}

                {lookupState === "not-found" && (
                  <div className="vehicleLookupResult empty">
                    <div className="vehicleLookupIcon">?</div>
                    <div><b>У базі Turbo LEV такого номера ще немає</b><span>Створюємо нове авто. Зовнішній пошук підключимо окремим рівнем.</span></div>
                  </div>
                )}
              </div>
            </div>

            <div className="requestStepper" aria-label="Кроки створення заявки">
              {["Клієнт", "Автомобіль", "Проблема", "Запис"].map((label, index) => {
                const number = index + 1;
                return (
                  <button type="button" key={label} className={number === step ? "active" : number < step ? "done" : ""} onClick={() => number < step && setStep(number)}>
                    <b>{number < step ? "✓" : number}</b><span>{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="requestBody">
              {step === 1 && (
                <section className="requestStep">
                  <div className="requestStepTitle"><div><small>КРОК 1</small><h3>Клієнт і джерело заявки</h3></div><span className="requestRequired">* обов’язкові поля</span></div>
                  <div className="requestGrid two">
                    <label><span>Ім’я клієнта *</span><input value={form.customerName} onChange={(e) => update("customerName", e.target.value)} placeholder="Наприклад, Олександр" /></label>
                    <label><span>Телефон *</span><input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+380 67 123 45 67" inputMode="tel" /></label>
                    <label><span>Джерело</span><select value={form.source} onChange={(e) => update("source", e.target.value)}><option>Телефон</option><option>Google Maps</option><option>Instagram</option><option>Facebook</option><option>TikTok</option><option>Viber / Telegram / WhatsApp</option><option>Рекомендація</option><option>Повторний клієнт</option><option>Заїхав без запису</option><option>Інше</option></select></label>
                    <label><span>Відповідальний</span><select value={form.responsible} onChange={(e) => update("responsible", e.target.value)}><option>Продавник</option><option>РОП</option><option>Завідуючий</option><option>Не призначено</option></select></label>
                  </div>
                </section>
              )}

              {step === 2 && (
                <section className="requestStep">
                  <div className="requestStepTitle"><div><small>КРОК 2</small><h3>Автомобіль</h3></div><span className="requestHint">VIN можна додати пізніше</span></div>
                  <div className="requestVehicleMain">
                    <label className="plateField"><span>Державний номер *</span><input value={form.plate} onChange={(e) => update("plate", normalizePlate(e.target.value))} placeholder="AA1234BB" /></label>
                    <label className="vinField"><span>VIN</span><input value={form.vin} onChange={(e) => update("vin", normalizeVin(e.target.value))} placeholder="17 символів" /><small>{form.vin ? `${form.vin.length}/17` : "Буде використаний для підбору OE/OEM та історії авто"}</small></label>
                  </div>
                  <div className="requestGrid three">
                    <label><span>Марка</span><input value={form.make} onChange={(e) => update("make", e.target.value)} placeholder="Mazda" /></label>
                    <label><span>Модель</span><input value={form.model} onChange={(e) => update("model", e.target.value)} placeholder="6" /></label>
                    <label><span>Рік</span><input value={form.year} onChange={(e) => update("year", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2016" inputMode="numeric" /></label>
                    <label><span>Двигун</span><input value={form.engine} onChange={(e) => update("engine", e.target.value)} placeholder="2.0 бензин" /></label>
                    <label><span>Пробіг, км</span><input value={form.mileage} onChange={(e) => update("mileage", e.target.value.replace(/\D/g, ""))} placeholder="186000" inputMode="numeric" /></label>
                  </div>
                </section>
              )}

              {step === 3 && (
                <section className="requestStep">
                  <div className="requestStepTitle"><div><small>КРОК 3</small><h3>Що турбує клієнта</h3></div><span className="requestHint">Фіксуємо зі слів клієнта, не ставимо діагноз</span></div>
                  <label className="requestFullField"><span>Категорія звернення</span><input value={form.category} onChange={(e) => update("category", e.target.value)} placeholder="Оберіть нижче або введіть вручну" /></label>
                  <div className="requestTags">{categories.map((item) => <button type="button" key={item} className={form.category === item ? "selected" : ""} onClick={() => update("category", item)}>{item}</button>)}</div>
                  <label className="requestFullField"><span>Проблема / побажання клієнта *</span><textarea value={form.complaint} onChange={(e) => update("complaint", e.target.value)} placeholder="Наприклад: при гальмуванні б’є в кермо, зліва чути стук на нерівностях..." /></label>
                  <div className="requestGrid two compactTop">
                    <label><span>Пріоритет</span><select value={form.urgency} onChange={(e) => update("urgency", e.target.value)}><option>Звичайна</option><option>Терміново</option><option>Авто не на ходу</option></select></label>
                    <label><span>Внутрішній коментар</span><input value={form.comment} onChange={(e) => update("comment", e.target.value)} placeholder="Що важливо знати команді" /></label>
                  </div>
                </section>
              )}

              {step === 4 && (
                <section className="requestStep">
                  <div className="requestStepTitle"><div><small>КРОК 4</small><h3>Запис і підтвердження</h3></div><span className={status === "BOOKED" ? "requestStatus booked" : "requestStatus"}>{status === "BOOKED" ? "Записаний" : "Нова заявка"}</span></div>
                  <div className="requestGrid three">
                    <label><span>Дата заїзду</span><input type="date" value={form.appointmentDate} onChange={(e) => update("appointmentDate", e.target.value)} /></label>
                    <label><span>Час</span><input type="time" value={form.appointmentTime} onChange={(e) => update("appointmentTime", e.target.value)} /></label>
                    <label><span>Попередня сума, грн</span><input value={form.preliminaryAmount} onChange={(e) => update("preliminaryAmount", e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" placeholder="Необов’язково" /></label>
                  </div>
                  <div className="requestSummary">
                    <article><small>Клієнт</small><strong>{form.customerName}</strong><span>{form.phone}</span></article>
                    <article><small>Автомобіль</small><strong>{[form.make, form.model, form.year].filter(Boolean).join(" ") || "Дані не заповнені"}</strong><span>{form.plate}{form.vin ? ` · VIN ${form.vin}` : ""}</span></article>
                    <article><small>Звернення</small><strong>{form.category || "Без категорії"}</strong><span>{form.complaint}</span></article>
                    <article><small>Відповідальний / джерело</small><strong>{form.responsible}</strong><span>{form.source}</span></article>
                  </div>
                  <div className="requestProcessNote"><b>Правило процесу:</b> зараз створюється тільки заявка{status === "BOOKED" ? " + запис" : ""}. Замовлення-наряд на цьому етапі не створюється.</div>
                </section>
              )}

              {error && <div className="requestMessage error">{error}</div>}
              {success && <div className="requestMessage success">{success}</div>}
            </div>

            <div className="requestActions">
              <button type="button" className="ghost" onClick={close}>Скасувати</button>
              <div>{step > 1 && <button type="button" className="ghost" onClick={back}>← Назад</button>}{step < 4 ? <button type="button" className="primary" onClick={next}>Далі →</button> : <button type="submit" className="primary">Створити заявку</button>}</div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
