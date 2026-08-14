"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type VehicleConfiguration = {
  id: string;
  generation: string | null;
  modification: string | null;
  engine: string | null;
  engineVolume: string | null;
  fuelType: string | null;
  bodyType: string | null;
  driveType: string | null;
  transmission: string | null;
  source: string;
  confidence: number;
};

type Identity = { make: string; model: string; year: string; vin: string };
type Selection = {
  generation: string;
  modification: string;
  engine: string;
  transmission: string;
  source: string;
  confidence: number;
};

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const STORAGE_KEY = "turbolev-manual-requests-v1";
const emptyIdentity: Identity = { make: "", model: "", year: "", vin: "" };
const emptySelection: Selection = { generation: "", modification: "", engine: "", transmission: "", source: "MANUAL", confidence: 100 };

function findLabel(prefix: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll("label")).find((label) => {
    const caption = label.querySelector("span")?.textContent?.trim() ?? "";
    return caption.startsWith(prefix);
  }) as HTMLLabelElement | undefined;
}

function findControl(prefix: string, root: ParentNode = document): FormControl | null {
  return findLabel(prefix, root)?.querySelector("input,select,textarea") as FormControl | null;
}

function controlValue(control: FormControl | null) {
  return control?.value?.trim() ?? "";
}

function setControlValue(prefix: string, value: string) {
  const modal = document.querySelector(".requestModal");
  if (!modal) return;
  const control = findControl(prefix, modal);
  if (!control || control.value === value) return;

  const prototype = control instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(control, value);
  else control.value = value;

  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  if (!(control instanceof HTMLSelectElement)) control.dispatchEvent(new Event("change", { bubbles: true }));
}

function unique(values: Array<string | null>) {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "uk-UA"));
}

function sameText(left: string | null, right: string) {
  if (!right.trim()) return true;
  return (left ?? "").trim().toLocaleLowerCase("uk-UA") === right.trim().toLocaleLowerCase("uk-UA");
}

function sourceLabel(source: string) {
  if (source.includes("NHTSA") || source.includes("VPIC")) return "VIN Decoder · NHTSA vPIC";
  if (source.includes("TURBO_LEV") || source === "CRM") return "База Turbo LEV";
  if (source === "MANUAL") return "Введено вручну";
  return source || "База Turbo LEV";
}

export function VehicleConfigurationEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [summaryMount, setSummaryMount] = useState<HTMLElement | null>(null);
  const [identity, setIdentity] = useState<Identity>(emptyIdentity);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [items, setItems] = useState<VehicleConfiguration[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogSource, setCatalogSource] = useState("");
  const selectionRef = useRef(selection);
  const identityRef = useRef(identity);
  const wasOpenRef = useRef(false);
  const lastVinRef = useRef("");

  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => { identityRef.current = identity; }, [identity]);

  useEffect(() => {
    const sync = () => {
      const modal = document.querySelector(".requestModal") as HTMLElement | null;
      if (!modal) {
        if (wasOpenRef.current) {
          setIdentity(emptyIdentity);
          setSelection(emptySelection);
          setItems([]);
          setCatalogSource("");
          lastVinRef.current = "";
        }
        wasOpenRef.current = false;
        setMount(null);
        setSummaryMount(null);
        return;
      }
      wasOpenRef.current = true;

      const grid = modal.querySelector(".vehicleCatalogGrid") as HTMLElement | null;
      if (grid) {
        let portal = grid.querySelector(":scope > .vehicleConfigPortalMount") as HTMLElement | null;
        if (!portal) {
          portal = document.createElement("div");
          portal.className = "vehicleConfigPortalMount";
          const originalLabels = Array.from(grid.children).filter((child) => child.tagName === "LABEL");
          const yearLabel = originalLabels[2] ?? null;
          grid.insertBefore(portal, yearLabel?.nextSibling ?? null);
        }
        setMount((current) => current === portal ? current : portal);

        const legacyEngineLabel = findLabel("Двигун / модифікація", modal);
        legacyEngineLabel?.classList.add("vehicleConfigLegacyEngine");

        const header = modal.querySelector(".vehicleManualHeader h4");
        if (header) header.textContent = "Марка → модель → рік → покоління → модифікація → двигун";
        const manualMode = modal.querySelector(".vehicleIdentityMode:nth-child(3) span");
        if (manualMode) manualMode.textContent = "Марка → модель → рік → покоління → модифікація → двигун.";

        const nextIdentity: Identity = {
          make: controlValue(findControl("Марка", modal)),
          model: controlValue(findControl("Модель", modal)),
          year: controlValue(findControl("Рік", modal)),
          vin: controlValue(modal.querySelector(".vinLookupControl input") as HTMLInputElement | null),
        };
        setIdentity((current) => current.make === nextIdentity.make && current.model === nextIdentity.model && current.year === nextIdentity.year && current.vin === nextIdentity.vin ? current : nextIdentity);

        const existingEngine = controlValue(findControl("Двигун / модифікація", modal));
        if (existingEngine && !selectionRef.current.engine) {
          setSelection((current) => ({ ...current, engine: existingEngine }));
        }
      } else {
        setMount(null);
      }

      const summary = modal.querySelector(".requestSummary") as HTMLElement | null;
      if (summary) {
        let portal = summary.querySelector(":scope > .vehicleConfigSummaryMount") as HTMLElement | null;
        if (!portal) {
          portal = document.createElement("div");
          portal.className = "vehicleConfigSummaryMount";
          summary.appendChild(portal);
        }
        setSummaryMount((current) => current === portal ? current : portal);
      } else {
        setSummaryMount(null);
      }
    };

    sync();
    const timer = window.setInterval(sync, 350);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const make = identity.make.trim();
    const model = identity.model.trim();
    const year = Number(identity.year);
    if (!make || !model || !Number.isInteger(year)) {
      setItems([]);
      setCatalogSource("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/vehicles/configurations?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${year}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || "Configuration catalog failed");
        setItems(Array.isArray(data.items) ? data.items : []);
        setCatalogSource(String(data.source ?? ""));
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          setItems([]);
          setCatalogSource("UNAVAILABLE");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 320);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [identity.make, identity.model, identity.year]);

  useEffect(() => {
    const vin = identity.vin.trim().toUpperCase();
    if (vin.length !== 17 || vin === lastVinRef.current) return;
    lastVinRef.current = vin;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/vehicles/vin?vin=${encodeURIComponent(vin)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data?.status !== "FOUND" || !data?.vehicle) return;
        const vehicle = data.vehicle as Record<string, unknown>;
        const next: Selection = {
          generation: String(vehicle.series ?? "").trim(),
          modification: String(vehicle.trim ?? "").trim(),
          engine: String(vehicle.engine ?? "").trim(),
          transmission: String(vehicle.transmission ?? "").trim(),
          source: String(data.sourceDetail ?? data.source ?? "NHTSA_VPIC_API"),
          confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : 80,
        };
        setSelection(next);
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") console.warn("Vehicle configuration VIN enrichment skipped", error);
      }
    })();

    return () => controller.abort();
  }, [identity.vin]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail || typeof detail !== "object") return;
      const current = selectionRef.current;
      const hasConfiguration = Boolean(current.generation || current.modification || current.engine || current.transmission);
      if (!hasConfiguration) return;

      const patch = {
        generation: current.generation || null,
        modification: current.modification || null,
        engine: current.engine || detail.engine || null,
        transmission: current.transmission || null,
        configurationSource: current.source || "MANUAL",
        configurationConfidence: current.confidence,
        vehicleConfiguration: {
          make: identityRef.current.make || detail.make || null,
          model: identityRef.current.model || detail.model || null,
          year: Number(identityRef.current.year || detail.year) || null,
          generation: current.generation || null,
          modification: current.modification || null,
          engine: current.engine || detail.engine || null,
          transmission: current.transmission || null,
          source: current.source || "MANUAL",
          confidence: current.confidence,
        },
      };
      Object.assign(detail, patch);

      const id = String(detail.id ?? "");
      if (!id) return;
      try {
        const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
        if (!Array.isArray(stored)) return;
        const next = stored.map((item: Record<string, unknown>) => String(item?.id ?? "") === id ? { ...item, ...patch } : item);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The original request is already saved; configuration enrichment is best-effort.
      }
    };

    window.addEventListener("turbolev:new-request", handler as EventListener);
    return () => window.removeEventListener("turbolev:new-request", handler as EventListener);
  }, []);

  const generations = useMemo(() => unique(items.map((item) => item.generation)), [items]);
  const generationFiltered = useMemo(() => items.filter((item) => sameText(item.generation, selection.generation)), [items, selection.generation]);
  const modifications = useMemo(() => unique(generationFiltered.map((item) => item.modification)), [generationFiltered]);
  const modificationFiltered = useMemo(() => generationFiltered.filter((item) => sameText(item.modification, selection.modification)), [generationFiltered, selection.modification]);
  const engines = useMemo(() => unique(modificationFiltered.map((item) => item.engine)), [modificationFiltered]);
  const transmissions = useMemo(() => unique(modificationFiltered.map((item) => item.transmission)), [modificationFiltered]);

  function markManual(field: keyof Pick<Selection, "generation" | "modification" | "engine" | "transmission">, value: string) {
    setSelection((current) => ({ ...current, [field]: value, source: "MANUAL", confidence: 100 }));
    if (field === "engine") setControlValue("Двигун / модифікація", value);
  }

  function applyConfiguration(item: VehicleConfiguration) {
    setSelection({
      generation: item.generation ?? selectionRef.current.generation,
      modification: item.modification ?? selectionRef.current.modification,
      engine: item.engine ?? selectionRef.current.engine,
      transmission: item.transmission ?? selectionRef.current.transmission,
      source: item.source || "TURBO_LEV_CRM",
      confidence: item.confidence ?? 80,
    });
    if (item.engine) setControlValue("Двигун / модифікація", item.engine);
    if (item.engineVolume) setControlValue("Об’єм двигуна, л", item.engineVolume);
    if (item.fuelType) setControlValue("Паливо", item.fuelType);
    if (item.bodyType) setControlValue("Тип кузова", item.bodyType);
    if (item.driveType) setControlValue("Привід", item.driveType);
  }

  function chooseEngine(value: string) {
    const match = modificationFiltered
      .filter((item) => (item.engine ?? "").trim().toLocaleLowerCase("uk-UA") === value.trim().toLocaleLowerCase("uk-UA"))
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (match) applyConfiguration(match);
    else markManual("engine", value);
  }

  const statusText = loading
    ? "Шукаю відомі конфігурації…"
    : items.length
      ? `Знайдено ${items.length} конфігурац${items.length === 1 ? "ію" : items.length < 5 ? "ії" : "ій"} у базі Turbo LEV`
      : catalogSource === "UNAVAILABLE"
        ? "Каталог конфігурацій тимчасово недоступний — поля можна заповнити вручну"
        : "Для цієї версії ще немає відомих конфігурацій — введіть вручну або розшифруйте VIN";

  const panel = mount ? createPortal(
    <div className="vehicleConfigPanel">
      <div className="vehicleConfigHead">
        <div><small>ТОЧНА КОНФІГУРАЦІЯ</small><b>Покоління → модифікація → двигун</b></div>
        <span>{statusText}</span>
      </div>
      <div className="vehicleConfigGrid">
        <label><span>Покоління / серія</span><input list="turboLevGenerations" value={selection.generation} onChange={(event) => markManual("generation", event.target.value)} placeholder="Напр. P3 / F15 / W212"/><datalist id="turboLevGenerations">{generations.map((value) => <option key={value} value={value}/>)}</datalist></label>
        <label><span>Модифікація / комплектація</span><input list="turboLevModifications" value={selection.modification} onChange={(event) => markManual("modification", event.target.value)} placeholder="Напр. EX-V6 / B5 AWD"/><datalist id="turboLevModifications">{modifications.map((value) => <option key={value} value={value}/>)}</datalist></label>
        <label><span>Двигун</span><input list="turboLevEngines" value={selection.engine} onChange={(event) => chooseEngine(event.target.value)} placeholder="Код / назва двигуна"/><datalist id="turboLevEngines">{engines.map((value) => <option key={value} value={value}/>)}</datalist></label>
        <label><span>КПП</span><input list="turboLevTransmissions" value={selection.transmission} onChange={(event) => markManual("transmission", event.target.value)} placeholder="Автомат / механіка / DSG"/><datalist id="turboLevTransmissions">{transmissions.map((value) => <option key={value} value={value}/>)}</datalist></label>
      </div>
      <div className="vehicleConfigMeta"><span>Джерело: <b>{sourceLabel(selection.source)}</b></span><span>Довіра: <b>{selection.confidence}%</b></span>{items.length > 0 && <span>Вибір двигуна автоматично підставляє об’єм, паливо, кузов і привід, якщо вони відомі.</span>}</div>
    </div>,
    mount,
  ) : null;

  const summary = summaryMount && (selection.generation || selection.modification || selection.engine || selection.transmission) ? createPortal(
    <article className="vehicleConfigSummaryCard"><small>Конфігурація</small><strong>{[selection.generation, selection.modification, selection.engine].filter(Boolean).join(" · ") || "Уточнюється"}</strong><span>{selection.transmission || sourceLabel(selection.source)}</span></article>,
    summaryMount,
  ) : null;

  return <>{panel}{summary}</>;
}
