"use client";

import { useEffect, useState } from "react";
import type { VehicleCardContract, VehicleDirectoryItem, VehicleStatusSummary } from "@/src/lib/contracts/crm-core";
import {
  parseVehicleAppearancePayload,
  parseVehicleCardPayload,
  parseVehicleDirectoryPayload,
  parseVehicleImageRefreshPayload,
  parseVehicleStatusSummaryPayload,
  payloadMessage,
} from "@/src/lib/contracts/directory-payload.parsers";
import { CustomerCabinetCard } from "./customer-cabinet-card";
import { navigateCrm, readCrmRoute } from "./crm-route";
import { VehicleBrandLogo } from "./vehicle-brand-logo";
import { VehicleRender } from "./vehicle-render";
import { VehicleDiagnosticsTab } from "./vehicle-diagnostics-tab";
import styles from "./directory-pages.module.css";
import tabStyles from "./vehicle-card-tabs.module.css";
import workflowStyles from "./vehicle-workflow.module.css";

type Vehicle = VehicleDirectoryItem;
type VehicleCard = VehicleCardContract;
type VehicleDrawerTab = "overview" | "diagnostics" | "history";

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

function WorkflowIcon({ kind }: { kind: "diagnosticCard" | "commercialProposal" | "repair" }) {
  if (kind === "diagnosticCard") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l3 3V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5"/></svg>;
  if (kind === "commercialProposal") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14v15H5z"/><path d="M8 8h8M8 11.5h8M8 15h4"/><path d="m15.5 15.5 1.2 1.2 2.3-2.5"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13.5h2l2-5h7l2 5h3v4h-2"/><path d="M6 17.5H4v-2M18 17.5h2"/><circle cx="8" cy="17.5" r="1.7"/><circle cx="16" cy="17.5" r="1.7"/><path d="M8 13.5h7"/></svg>;
}

const WORKFLOW_META = [
  { key: "diagnostics", icon: "diagnosticCard", label: "Діагностична карта" },
  { key: "proposal", icon: "commercialProposal", label: "Комерційна пропозиція" },
  { key: "work", icon: "repair", label: "Ремонт" },
] as const;

function fallbackStatusSummary(): VehicleStatusSummary {
  const empty = { state: "not_started", label: "Не розпочато", tone: "danger" as const, targetId: null, updatedAt: null };
  return { diagnostics: { ...empty, label: "Не було" }, proposal: { ...empty, label: "Не відправлена" }, work: empty };
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
  const [drawerTab, setDrawerTab] = useState<VehicleDrawerTab>("overview");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/vehicles?${params}`, { cache: "no-store", signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        const data = parseVehicleDirectoryPayload(payload);
        if (!response.ok || !data) throw new Error(payloadMessage(payload, "Не вдалося завантажити автомобілі"));
        setVehicles(data.vehicles);
        setTotal(data.total);
        setPages(data.pages);
        if (data.vehicles.length) {
          const statusResponse = await fetch(`/api/vehicles/status-summary?ids=${data.vehicles.map((vehicle) => encodeURIComponent(vehicle.id)).join(",")}`, { cache: "no-store", signal: controller.signal });
          const statusPayload: unknown = await statusResponse.json().catch(() => null);
          const statuses = parseVehicleStatusSummaryPayload(statusPayload);
          if (statuses) {
            const byVehicle = new Map(statuses.vehicles.map((item) => [item.vehicleId, item.statusSummary]));
            setVehicles((current) => current.map((vehicle) => ({ ...vehicle, statusSummary: byVehicle.get(vehicle.id) || vehicle.statusSummary })));
          }
        }
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
    setDrawerTab("overview");
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

  function openNewRequestForVehicle(vehicle: Vehicle) {
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", {
      detail: {
        source: "VEHICLES",
        plate: vehicle.plateNumber || "",
        vin: vehicle.vin || "",
        name: vehicle.client.name || "",
        phone: vehicle.client.phone || "",
      },
    }));
  }

  function openWorkflow(vehicle: Vehicle, key: (typeof WORKFLOW_META)[number]["key"], targetId: string | null) {
    if (key === "diagnostics") {
      if (targetId) {
        navigateCrm("Діагностика", { diagnosticId: targetId });
      } else {
        openNewRequestForVehicle(vehicle);
      }
      return;
    }

    if (targetId) {
      navigateCrm("Замовлення-наряди", {
        workOrderId: targetId,
        workOrderTab: key === "proposal" ? "estimate" : "overview",
      });
      return;
    }

    openNewRequestForVehicle(vehicle);
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
      {vehicles.map((vehicle, index) => <article
        key={vehicle.id}
        className={styles.card}
        role="button"
        tabIndex={0}
        onClick={() => openVehicle(vehicle.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openVehicle(vehicle.id);
          }
        }}
      >
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
        <div className={workflowStyles.workflow} aria-label="Статуси автомобіля">
          {WORKFLOW_META.map(({ key, label, icon }) => {
            const status = vehicle.statusSummary?.[key] || fallbackStatusSummary()[key];
            return <button
              type="button"
              className={workflowStyles.workflowItem}
              key={key}
              title={`${label}: ${status.label}`}
              aria-label={`${label}: ${status.label}`}
              onClick={(event) => {
                event.stopPropagation();
                openWorkflow(vehicle, key, status.targetId);
              }}
            >
              <i className={`${workflowStyles.workflowIcon} ${workflowStyles[`workflow_${status.tone}`]}`}><WorkflowIcon kind={icon} /></i>
              <small>{label}</small>
            </button>;
          })}
        </div>
      </article>)}
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

          <nav className={tabStyles.tabs} aria-label="Розділи картки автомобіля">
            <button type="button" className={drawerTab === "overview" ? tabStyles.active : ""} onClick={() => setDrawerTab("overview")}>Огляд</button>
            <button type="button" className={drawerTab === "diagnostics" ? tabStyles.active : ""} onClick={() => setDrawerTab("diagnostics")}>Діагностика</button>
            <button type="button" className={drawerTab === "history" ? tabStyles.active : ""} onClick={() => setDrawerTab("history")}>Сервісна історія</button>
          </nav>

          <div className={styles.drawerBody}>
            {drawerTab === "overview" && <>
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
            </>}

            {drawerTab === "diagnostics" && <section className={styles.panel}>
              <h3>Діагностика</h3>
              <VehicleDiagnosticsTab vehicleId={vehicleCard.id} plateNumber={vehicleCard.plateNumber} vin={vehicleCard.vin}/>
            </section>}

            {drawerTab === "history" && <section className={styles.panel}>
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
            </section>}
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
    <div className={styles.panelTitleRow}><h3>Колір кузова</h3><span>{vehicle.exteriorColorConfirmed ? "Підтверджено" : "Не підтверджено"}</span></div>
    <p className={styles.colorHint}>Якщо колір знайдено у довіднику МВС за держномером або підтверджено вручну, CRM використовує його. Якщо даних немає — показує нейтральний render без вигаданого кольору.</p>
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
