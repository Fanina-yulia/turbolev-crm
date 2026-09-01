"use client";

import { useEffect, useState } from "react";
import type { VehicleCardContract, WorkOrderListItemContract } from "@/src/lib/contracts/crm-core";
import { parseWorkOrderListPayload } from "@/src/lib/contracts/work-order-payload.parsers";
import { navigateCrm, readCrmRoute } from "./crm-route";
import { ServiceTimeline } from "./service-timeline";
import { VehicleDiagnosticsTab } from "./vehicle-diagnostics-tab";
import { VehicleBrandLogo } from "./vehicle-brand-logo";
import { getVehicleTabStatus, vehicleTabToneClass, type VehicleTabKey } from "./vehicle-process-status";
import { VehicleRender } from "./vehicle-render";
import { WorkOrderCommercialPanel } from "./work-order-commercial-panel";
import { CopyableValue } from "./copyable-value";
import styles from "./vehicle-record-workspace.module.css";

export type VehicleRecordPage = "diagnostic-card" | "commercial-offer" | "service-history";

type Props = { vehicle: VehicleCardContract | null; loading: boolean; page: VehicleRecordPage; diagnosticId?: string | null; onClose: () => void; };

function title(vehicle: VehicleCardContract) { return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль"; }

function pageTitle(page: VehicleRecordPage) { if (page === "diagnostic-card") return "Діагностична карта"; if (page === "commercial-offer") return "Комерційна пропозиція"; return "Сервісна історія"; }

function dateText(value: string | null | undefined) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date); }

function pageDescription(page: VehicleRecordPage) { if (page === "diagnostic-card") return "Результати та історія діагностичних перевірок цього автомобіля."; if (page === "commercial-offer") return "Підбір робіт і запчастин для ремонту цього автомобіля."; return "Повна хронологія обслуговування, ремонтів і оплат цього автомобіля."; }

export function VehicleRecordWorkspace({ vehicle, loading, page, diagnosticId, onClose }: Props) {
  const [workOrders, setWorkOrders] = useState<WorkOrderListItemContract[]>([]);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState("");

  useEffect(() => {
    if (page !== "commercial-offer" || !vehicle) { setWorkOrders([]); setSelectedWorkOrderId(null); setProposalLoading(false); return; }
    const controller = new AbortController(); setProposalLoading(true); setProposalError("");
    void fetch("/api/work-orders?limit=500", { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        const parsed = parseWorkOrderListPayload(payload);
        if (!response.ok || !parsed) throw new Error((payload as { error?: string } | null)?.error || "Не вдалося завантажити комерційні пропозиції.");
        const rows = parsed.workOrders.filter((item) => item.vehicle.id === vehicle.id);
        const routeWorkOrderId = readCrmRoute().workOrderId;
        setWorkOrders(rows); setSelectedWorkOrderId(routeWorkOrderId && rows.some((item) => item.id === routeWorkOrderId) ? routeWorkOrderId : rows[0]?.id || null);
      })
      .catch((cause) => { if (!controller.signal.aborted) setProposalError(cause instanceof Error ? cause.message : "Не вдалося завантажити комерційні пропозиції."); })
      .finally(() => { if (!controller.signal.aborted) setProposalLoading(false); });
    return () => controller.abort();
  }, [page, vehicle]);

  if (!vehicle) return <div className={styles.page}><div className={styles.loading}>Завантажую автомобіль…</div></div>;

  const links: Array<[VehicleRecordPage, string, VehicleTabKey]> = [
    ["diagnostic-card", "Діагностична карта", "diagnostics"],
    ["commercial-offer", "Комерційна пропозиція", "proposal"],
    ["service-history", "Сервісна історія", "history"],
  ];

  return <div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.vehicleIdentity}><VehicleBrandLogo brand={vehicle.brand} size={48} /><div><span className={styles.eyebrow}>АВТОМОБІЛЬ · ПЕРСОНАЛЬНИЙ РОЗДІЛ</span><h1>{title(vehicle)}</h1><span className={styles.plate}>{vehicle.plateNumber ? <CopyableValue value={vehicle.plateNumber} label="держномер" /> : "Без держномера"}{vehicle.vin ? <> · VIN <CopyableValue value={vehicle.vin} label="VIN" /></> : ""}</span></div></div>
      <div className={styles.headerActions}><button type="button" className={styles.back} onClick={onClose}>← До списку автомобілів</button><VehicleRender id={vehicle.id} brand={vehicle.brand} model={vehicle.model} year={vehicle.year} updatedAt={vehicle.updatedAt} exteriorColorName={vehicle.exteriorColorName} exteriorColorHex={vehicle.exteriorColorHex} exteriorColorConfirmed={vehicle.exteriorColorConfirmed} size="hero" eager /></div>
    </header>

    <div className={styles.ownerLine}><span>Власник: <b>{vehicle.client.name || "Клієнт без імені"}</b></span><span>{vehicle.client.phone}</span><span>VIN: {vehicle.vin ? <CopyableValue value={vehicle.vin} label="VIN" /> : "—"}</span></div>

    <nav className={styles.tabs} aria-label="Розділи автомобіля">{links.map(([target, label, tab]) => {
      const status = getVehicleTabStatus(vehicle, tab);
      return <button type="button" key={target} className={`${styles.tab} ${vehicleTabToneClass(status.tone, styles)} ${page === target ? styles.activeTab : ""}`} title={`${label}: ${status.label}`} onClick={() => navigateCrm("Авто", { vehicleId: vehicle.id, vehiclePage: target })}><i className={styles.statusDot} aria-hidden="true" />{label}</button>;
    })}</nav>

    <section className={styles.content}>
      <div className={styles.contentHeading}><div><span className={styles.eyebrow}>КАРТКА АВТОМОБІЛЯ</span><h2>{pageTitle(page)}</h2><p>{pageDescription(page)}</p></div><button type="button" className={styles.cardLink} onClick={() => navigateCrm("Авто", { vehicleId: vehicle.id })}>← Картка автомобіля</button></div>
      {page === "diagnostic-card" && <VehicleDiagnosticsTab vehicle={vehicle} diagnosticId={diagnosticId} />}
      {page === "service-history" && <ServiceTimeline vehicleId={vehicle.id} />}
      {page === "commercial-offer" && <div className={styles.proposalSection}>
        {proposalLoading && <div className={styles.state}>Завантажую комерційні пропозиції…</div>}
        {proposalError && <div className={styles.error}>{proposalError}</div>}
        {!proposalLoading && !proposalError && !workOrders.length && <div className={styles.empty}><h3>Комерційну пропозицію ще не сформовано</h3><p>Після підтвердження діагностичної карти сервіс-менеджер зможе сформувати пропозицію для цього автомобіля.</p><button type="button" onClick={() => navigateCrm("Авто", { vehicleId: vehicle.id, vehiclePage: "diagnostic-card" })}>Відкрити діагностичну карту</button></div>}
        {!proposalLoading && !proposalError && workOrders.length > 0 && <div className={styles.proposalLayout}>
          <aside className={styles.proposalList}><h3>Пропозиції автомобіля</h3>{workOrders.map((item) => <button type="button" key={item.id} className={selectedWorkOrderId === item.id ? styles.proposalActive : ""} onClick={() => { setSelectedWorkOrderId(item.id); navigateCrm("Авто", { vehicleId: vehicle.id, vehiclePage: "commercial-offer", workOrderId: item.id, workOrderTab: "estimate" }); }}><strong>{item.statusLabel}</strong><span>{item.vehicle.plateNumber || "Без номера"}</span><small>{dateText(item.updatedAt)} · {item.stage || "КП"}</small></button>)}</aside>
          <div className={styles.proposalBody}>{selectedWorkOrderId ? <WorkOrderCommercialPanel workOrderId={selectedWorkOrderId} view="estimate" /> : <div className={styles.state}>Оберіть комерційну пропозицію.</div>}</div>
        </div>}
      </div>}
    </section>
  </div>;
}
