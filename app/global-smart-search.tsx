"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./global-smart-search.module.css";

type ClientResult = {
  id: string;
  name: string | null;
  phone: string;
  vehicles: Array<{ id: string; plateNumber: string | null; brand: string | null; model: string | null }>;
};

type VehicleResult = {
  id: string;
  plateNumber: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  client: { id: string; name: string | null; phone: string };
};

type WorkOrderResult = {
  id: string;
  number: number | null;
  numberLabel: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
  client: { id: string; name: string | null; phone: string };
  vehicle: { id: string; plateNumber: string | null; vin: string | null; brand: string | null; model: string | null; year: number | null };
};

type DiagnosticResult = {
  id: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
  technicalConclusion: string | null;
  client: { id: string; name: string | null; phone: string };
  vehicle: { id: string; plateNumber: string | null; vin: string | null; brand: string | null; model: string | null; year: number | null };
};

type AppointmentResult = {
  id: string;
  status: string;
  statusLabel: string;
  customerName: string | null;
  phone: string | null;
  vehicleLabel: string | null;
  plateNumber: string | null;
  problem: string | null;
  plannedStartAt: string;
  clientId: string | null;
  vehicleId: string | null;
  location: { id: string; name: string };
};

type SearchResponse = {
  ok: boolean;
  clients?: ClientResult[];
  vehicles?: VehicleResult[];
  workOrders?: WorkOrderResult[];
  diagnostics?: DiagnosticResult[];
  appointments?: AppointmentResult[];
  error?: string;
};

type FlatResult =
  | { key: string; type: "client"; row: ClientResult }
  | { key: string; type: "vehicle"; row: VehicleResult }
  | { key: string; type: "workOrder"; row: WorkOrderResult }
  | { key: string; type: "diagnostic"; row: DiagnosticResult }
  | { key: string; type: "appointment"; row: AppointmentResult };

function carLabel(vehicle: { brand: string | null; model: string | null; year?: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function shortVin(vin: string | null) {
  if (!vin) return "VIN не вказано";
  return vin.length > 12 ? `VIN …${vin.slice(-8)}` : `VIN ${vin}`;
}

function appointmentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function GlobalSmartSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse>({ ok: true, clients: [], vehicles: [], workOrders: [], diagnostics: [], appointments: [] });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onShortcut);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onShortcut);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setData({ ok: true, clients: [], vehicles: [], workOrders: [], diagnostics: [], appointments: [] });
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as SearchResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Пошук недоступний");
        setData(payload);
        setActiveIndex(-1);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setData({ ok: false, clients: [], vehicles: [], workOrders: [], diagnostics: [], appointments: [], error: error instanceof Error ? error.message : "Помилка пошуку" });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const flat = useMemo<FlatResult[]>(() => [
    ...(data.workOrders || []).map((row) => ({ key: `wo-${row.id}`, type: "workOrder" as const, row })),
    ...(data.diagnostics || []).map((row) => ({ key: `diagnostic-${row.id}`, type: "diagnostic" as const, row })),
    ...(data.appointments || []).map((row) => ({ key: `appointment-${row.id}`, type: "appointment" as const, row })),
    ...(data.vehicles || []).map((row) => ({ key: `vehicle-${row.id}`, type: "vehicle" as const, row })),
    ...(data.clients || []).map((row) => ({ key: `client-${row.id}`, type: "client" as const, row })),
  ], [data]);

  const choose = (item: FlatResult) => {
    if (item.type === "workOrder") navigateCrm("Комерційна пропозиція", { workOrderId: item.row.id, workOrderTab: "overview" });
    else if (item.type === "diagnostic") navigateCrm("Діагностика", { diagnosticId: item.row.id });
    else if (item.type === "appointment") navigateCrm("Планувальник", { appointmentId: item.row.id });
    else if (item.type === "vehicle") navigateCrm("Авто", { vehicleId: item.row.id });
    else navigateCrm("Клієнти", { clientId: item.row.id });
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!flat.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => current < flat.length - 1 ? current + 1 : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => current > 0 ? current - 1 : flat.length - 1);
    } else if (event.key === "Enter" && activeIndex >= 0 && flat[activeIndex]) {
      event.preventDefault();
      choose(flat[activeIndex]);
    }
  };

  const hasQuery = query.trim().length > 0;
  const empty = hasQuery && !loading && data.ok && flat.length === 0;

  return <div className={styles.root} ref={wrapperRef}>
    <div className={`${styles.inputWrap} ${open ? styles.inputWrapOpen : ""}`}>
      <span className={styles.searchIcon} aria-hidden="true">⌕</span>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="ПІБ, телефон, номер, VIN, ЗН, ДК, запис"
        aria-label="Глобальний пошук CRM"
        aria-expanded={open}
        aria-controls="crm-global-search-results"
        autoComplete="off"
      />
      {loading ? <span className={styles.spinner} aria-label="Пошук"/> : <kbd className={styles.shortcut}>Ctrl K</kbd>}
    </div>

    {open && hasQuery && <div className={styles.panel} id="crm-global-search-results" role="listbox">
      {!data.ok && <div className={styles.message}>{data.error || "Пошук недоступний"}</div>}
      {empty && <div className={styles.message}><b>Нічого не знайдено</b><span>Перевірте ПІБ, телефон, держномер, VIN, номер ЗН, діагностику або запис.</span></div>}

      {(data.workOrders || []).length > 0 && <ResultGroup title="Комерційна пропозиція">
        {(data.workOrders || []).map((row) => {
          const index = flat.findIndex((item) => item.key === `wo-${row.id}`);
          return <button key={row.id} type="button" role="option" aria-selected={index === activeIndex} className={`${styles.result} ${index === activeIndex ? styles.resultActive : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose({ key: `wo-${row.id}`, type: "workOrder", row })}>
            <span className={styles.badge}>ЗН</span><span className={styles.resultBody}><strong>{row.numberLabel} · {row.vehicle.plateNumber || carLabel(row.vehicle)}</strong><small>{carLabel(row.vehicle)} · {row.client.name || row.client.phone}</small></span><span className={styles.status}>{row.statusLabel}</span>
          </button>;
        })}
      </ResultGroup>}

      {(data.diagnostics || []).length > 0 && <ResultGroup title="Діагностика">
        {(data.diagnostics || []).map((row) => {
          const index = flat.findIndex((item) => item.key === `diagnostic-${row.id}`);
          return <button key={row.id} type="button" role="option" aria-selected={index === activeIndex} className={`${styles.result} ${index === activeIndex ? styles.resultActive : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose({ key: `diagnostic-${row.id}`, type: "diagnostic", row })}>
            <span className={styles.badge}>ДК</span><span className={styles.resultBody}><strong>{row.vehicle.plateNumber || carLabel(row.vehicle)}</strong><small>{carLabel(row.vehicle)} · {row.client.name || row.client.phone}{row.technicalConclusion ? ` · ${row.technicalConclusion.slice(0, 72)}` : ""}</small></span><span className={styles.status}>{row.statusLabel}</span>
          </button>;
        })}
      </ResultGroup>}

      {(data.appointments || []).length > 0 && <ResultGroup title="Планувальник">
        {(data.appointments || []).map((row) => {
          const index = flat.findIndex((item) => item.key === `appointment-${row.id}`);
          return <button key={row.id} type="button" role="option" aria-selected={index === activeIndex} className={`${styles.result} ${index === activeIndex ? styles.resultActive : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose({ key: `appointment-${row.id}`, type: "appointment", row })}>
            <span className={styles.badge}>ПЛ</span><span className={styles.resultBody}><strong>{row.plateNumber || row.vehicleLabel || "Запис на СТО"}</strong><small>{appointmentDate(row.plannedStartAt)} · {row.location.name} · {row.customerName || row.phone || "Клієнт"}{row.problem ? ` · ${row.problem.slice(0, 64)}` : ""}</small></span><span className={styles.status}>{row.statusLabel}</span>
          </button>;
        })}
      </ResultGroup>}

      {(data.vehicles || []).length > 0 && <ResultGroup title="Автомобілі">
        {(data.vehicles || []).map((row) => {
          const index = flat.findIndex((item) => item.key === `vehicle-${row.id}`);
          return <button key={row.id} type="button" role="option" aria-selected={index === activeIndex} className={`${styles.result} ${index === activeIndex ? styles.resultActive : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose({ key: `vehicle-${row.id}`, type: "vehicle", row })}>
            <span className={styles.badge}>АВ</span><span className={styles.resultBody}><strong>{row.plateNumber || carLabel(row)}</strong><small>{carLabel(row)} · {shortVin(row.vin)} · {row.client.name || row.client.phone}</small></span>
          </button>;
        })}
      </ResultGroup>}

      {(data.clients || []).length > 0 && <ResultGroup title="Клієнти">
        {(data.clients || []).map((row) => {
          const index = flat.findIndex((item) => item.key === `client-${row.id}`);
          const vehicle = row.vehicles[0];
          return <button key={row.id} type="button" role="option" aria-selected={index === activeIndex} className={`${styles.result} ${index === activeIndex ? styles.resultActive : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose({ key: `client-${row.id}`, type: "client", row })}>
            <span className={styles.badge}>КЛ</span><span className={styles.resultBody}><strong>{row.name || "Клієнт без імені"}</strong><small>{row.phone}{vehicle ? ` · ${vehicle.plateNumber || carLabel(vehicle)}` : ""}</small></span>
          </button>;
        })}
      </ResultGroup>}
    </div>}
  </div>;
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={styles.group}><div className={styles.groupTitle}>{title}</div>{children}</section>;
}