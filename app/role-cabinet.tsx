"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CabinetHomePayload, StationManagerAttentionContract, StationManagerCabinetPayload } from "@/src/lib/contracts/cabinet-home";
import { cabinetHomePayloadMessage, parseCabinetHomePayload } from "@/src/lib/contracts/cabinet-home-payload.parsers";
import { navigateCrm, type CrmRouteParams } from "./crm-route";
import type { CrmAccessSnapshot } from "./use-crm-access";
import { StationOverview } from "./station-overview";
import { MechanicMobileCabinet } from "./mechanic-mobile-cabinet";
import type { CrmSectionLabel } from "./crm-navigation";
import styles from "./role-cabinet.module.css";

type FlowRoute = { label: string; value: number; section: CrmSectionLabel; params?: CrmRouteParams };

const statusLabels: Record<string, string> = {
  DRAFT: "Очікує погодження",
  APPROVED: "Готовий до ремонту",
  IN_PROGRESS: "В роботі",
  COMPLETED: "Видано",
  BOOKED: "Заплановано",
  ARRIVED: "В роботі",
  DIAGNOSTICS: "В роботі",
  WAITING_APPROVAL: "Очікує погодження",
  WAITING_PARTS: "Очікує деталі",
  READY_FOR_REPAIR: "Готовий до ремонту",
  IN_REPAIR: "У ремонті",
  WAITING_QC: "Контроль якості",
  WAITING_PAYMENT: "Очікує оплату",
  READY_FOR_PICKUP: "Готовий до видачі",
  PAUSED: "У ремонті",
  NO_SHOW: "Скасовано",
  CANCELLED: "Скасовано",
};

function Loading() {
  return <div className={styles.state}><strong>Завантажую робочий кабінет…</strong><span>Дані беруться з поточного профілю доступу.</span></div>;
}

function LinkRequired() {
  return <div className={styles.state}>
    <strong>Кабінет Керівника станції створений, але станція ще не призначена</strong>
    <span>Призначте станцію працівнику в «Персонал». Після цього пульт покаже тільки її операційні дані.</span>
  </div>;
}

function attentionLabel(item: StationManagerAttentionContract) {
  if (!item.lifecycle) return statusLabels[item.status] || item.status;
  return item.lifecycle.flags.includes("OVERDUE") ? `Протерміновано · ${item.lifecycle.label}` : item.lifecycle.label;
}

function attentionRoute(item: StationManagerAttentionContract): { section: CrmSectionLabel; params: CrmRouteParams } {
  const code = item.lifecycle?.code;
  if (item.status === "NO_SHOW" || code === "CANCELLED") return { section: "Планувальник", params: { appointmentId: item.id } };
  if (code === "PLANNED") return { section: "Планувальник", params: { appointmentId: item.id } };
  if (["IN_WORK", "DIAGNOSTIC_COMPLETED", "MANAGER_REVIEW", "CLIENT_DECISION"].includes(code || "")) {
    return { section: "Діагностика", params: { plate: item.plate } };
  }
  if (["PARTS_SELECTION", "WAITING_PARTS"].includes(code || "")) return { section: "Підбір запчастин", params: { plate: item.plate } };
  if (code === "QUALITY_CONTROL") return { section: "Замовлення-наряди", params: { scope: "qc", plate: item.plate } };
  return { section: "Замовлення-наряди", params: { plate: item.plate } };
}

function StationManagerCabinet({ data, userName }: { data: StationManagerCabinetPayload; userName?: string | null }) {
  if (!data.linked) return <LinkRequired />;
  const flow: FlowRoute[] = [
    { label: "Заплановано", value: data.flow.booked, section: "Планувальник", params: { status: "PLANNED" } },
    { label: "В роботі / діагностика", value: data.flow.diagnostics, section: "Діагностика" },
    { label: "Очікує рішення / погодження", value: data.flow.approval, section: "Замовлення-наряди" },
    { label: "Підбір / очікування деталей", value: data.flow.waitingParts, section: "Підбір запчастин" },
    { label: "Готовий до ремонту", value: data.flow.readyForRepair, section: "Виробництво", params: { status: "READY_FOR_REPAIR" } },
    { label: "У ремонті", value: data.flow.inRepair, section: "Виробництво", params: { status: "IN_REPAIR" } },
    { label: "Контроль якості", value: data.flow.qc, section: "Контроль якості", params: { scope: "waiting" } },
    { label: "Оплата / видача", value: data.flow.ready, section: "Замовлення-наряди" },
  ];
  const attention = data.attention;
  return <>
    <header className={styles.header}>
      <div><p className="eyebrow">TURBO LEV · КАБІНЕТ КЕРІВНИКА СТАНЦІЇ</p><h1>Операційний пульт станції</h1><span className="muted">{userName || "Керівник станції"} · {data.station.name} · єдиний статус авто в усій CRM</span></div>
      <button className={styles.primaryAction} type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}>Виробництво зараз →</button>
    </header>

    <section className={styles.kpis}>
      <button type="button" onClick={() => navigateCrm("Планувальник")}><span>Авто сьогодні</span><strong>{data.kpis.carsToday}</strong><small>{data.kpis.carsOnStation} у потоці станції</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}><span>У ремонті</span><strong>{data.kpis.inRepair}</strong><small>активних авто</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}><span>Пости</span><strong>{data.kpis.postsOccupied}/{data.kpis.postsTotal}</strong><small>зайнято зараз</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}><span>Механіки</span><strong>{data.kpis.mechanicsTotal}</strong><small>активних на станції</small></button>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><p className="eyebrow">ВИРОБНИЧИЙ ПОТІК</p><h2>Що відбувається на станції</h2></div><span className="muted">статуси розраховані з фактичних дій у CRM</span></div>
      <div className={styles.flow}>{flow.map((item) => <button type="button" key={item.label} onClick={() => navigateCrm(item.section, item.params)}><span>{item.label}</span><strong>{item.value}</strong><em>Відкрити →</em></button>)}</div>
    </section>

    <div className={styles.twoColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ПОТРЕБУЄ УВАГИ</p><h2>Блокери та контрольні точки</h2></div><span className={styles.badge}>{attention.length}</span></div>
        {attention.length ? <div className={styles.list}>{attention.map((item) => {
          const route = attentionRoute(item);
          return <button className={styles.attention} type="button" key={item.id} onClick={() => navigateCrm(route.section, route.params)}>
            <b>{item.plate}</b><div><strong>{item.vehicle}</strong><span>{item.problem || "Без примітки"}</span><small>{item.mechanic || "Механік не призначений"}{item.post ? ` · ${item.post}` : ""}</small></div><em>{attentionLabel(item)}</em>
          </button>;
        })}</div> : <div className={styles.empty}>Критичних блокерів на сьогодні немає.</div>}
      </section>

      <aside className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ШВИДКИЙ ДОСТУП</p><h2>Керування станцією</h2></div></div>
        <div className={styles.quickGrid}>
          <button type="button" onClick={() => navigateCrm("Діагностика")}>Діагностика<span>завершення та перевірка →</span></button>
          <button type="button" onClick={() => navigateCrm("Замовлення-наряди")}>Замовлення-наряди<span>кошториси та ремонт →</span></button>
          <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}>Ремонт у роботі<span>пости та активні роботи →</span></button>
          <button type="button" onClick={() => navigateCrm("Контроль якості")}>Контроль якості<span>черга QC та результати →</span></button>
          <button type="button" onClick={() => navigateCrm("Підбір запчастин")}>Запчастини<span>підбір і постачальники →</span></button>
          <button type="button" onClick={() => navigateCrm("Планувальник")}>Планувальник<span>запис і майбутнє завантаження →</span></button>
        </div>
      </aside>
    </div>
  </>;
}

export function RoleAwareOverview({ access }: { access: CrmAccessSnapshot | null }) {
  const roleCodes = useMemo(() => new Set((access?.roles ?? []).map((role) => role.code).filter(Boolean)), [access?.roles]);
  const specialRole = roleCodes.has("STATION_MANAGER") ? "STATION_MANAGER" : roleCodes.has("MECHANIC") ? "MECHANIC" : null;
  const [data, setData] = useState<CabinetHomePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!specialRole || access?.provisioningState !== "ACTIVE") return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/cabinet/home", { cache: "no-store", credentials: "include" });
      const raw = await response.json().catch(() => null);
      const body = parseCabinetHomePayload(raw);
      if (!response.ok || !body) throw new Error(cabinetHomePayloadMessage(raw));
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка кабінету");
    } finally {
      setLoading(false);
    }
  }, [specialRole, access?.provisioningState]);

  useEffect(() => { void load(); const handler = () => void load(); window.addEventListener("turbolev:data-changed", handler); return () => window.removeEventListener("turbolev:data-changed", handler); }, [load]);

  if (roleCodes.has("OWNER") || roleCodes.has("EXECUTIVE_DIRECTOR") || !specialRole || access?.provisioningState !== "ACTIVE") return <StationOverview />;
  if (loading && !data) return <Loading />;
  if (error && !data) return <div className={styles.state}><strong>Не вдалося відкрити кабінет</strong><span>{error}</span><button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!data) return <Loading />;
  if (data.cabinet === "MECHANIC") return <MechanicMobileCabinet data={data} userName={access?.user?.name} />;
  return <StationManagerCabinet data={data} userName={access?.user?.name} />;
}
