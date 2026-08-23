"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CabinetHomePayload, StationManagerAttentionContract, StationManagerCabinetPayload } from "@/src/lib/contracts/cabinet-home";
import { cabinetHomePayloadMessage, parseCabinetHomePayload } from "@/src/lib/contracts/cabinet-home-payload.parsers";
import { navigateCrm, type CrmRouteParams } from "./crm-route";
import type { CrmAccessSnapshot } from "./use-crm-access";
import { StationOverview } from "./station-overview";
import { OwnerControlCenter } from "./owner-dashboard";
import { MechanicMobileCabinet } from "./mechanic-mobile-cabinet";
import type { CrmSectionLabel } from "./crm-navigation";
import styles from "./role-cabinet.module.css";

type FlowRoute = { label: string; value: number; section: CrmSectionLabel; params?: CrmRouteParams };

const statusLabels: Record<string, string> = {
  DRAFT: "Чернетка",
  APPROVED: "Погоджено",
  IN_PROGRESS: "В роботі",
  COMPLETED: "Завершено",
  BOOKED: "Записаний",
  ARRIVED: "Приїхав",
  DIAGNOSTICS: "Діагностика",
  WAITING_CALCULATION: "Розрахунок",
  WAITING_APPROVAL: "Очікує погодження",
  WAITING_PARTS: "Очікує деталі",
  READY_FOR_REPAIR: "Готовий до ремонту",
  IN_REPAIR: "У ремонті",
  WAITING_QC: "Очікує QC",
  WAITING_PAYMENT: "Очікує оплату (legacy)",
  READY_FOR_PICKUP: "Готовий до видачі",
  PAUSED: "Призупинено",
  NO_SHOW: "Не приїхав",
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

function attentionRoute(item: StationManagerAttentionContract): { section: CrmSectionLabel; params: CrmRouteParams } {
  if (item.status === "NO_SHOW") return { section: "Планувальник", params: { appointmentId: item.id, status: "NO_SHOW" } };
  if (item.status === "WAITING_QC") return { section: "Контроль якості", params: { scope: "waiting" } };
  if (["WAITING_APPROVAL", "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "READY_FOR_PICKUP"].includes(item.status)) {
    return { section: "Замовлення-наряди", params: { status: item.status, plate: item.plate } };
  }
  return { section: "Замовлення-наряди", params: { plate: item.plate } };
}

function waitingLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(minutes, 1)} хв`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} год ${minutes % 60} хв`;
  return `${Math.floor(minutes / (24 * 60))} дн ${Math.floor((minutes % (24 * 60)) / 60)} год`;
}

function timeLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) : null;
}

function StationManagerCabinet({ data, userName }: { data: StationManagerCabinetPayload; userName?: string | null }) {
  if (!data.linked) return <LinkRequired />;
  const flow: FlowRoute[] = [
    { label: "Заплановано сьогодні", value: data.flow.booked, section: "Планувальник", params: { status: "BOOKED" } },
    { label: "Приймання / діагностика", value: data.flow.diagnostics, section: "Діагностика" },
    { label: "Погодження", value: data.flow.approval, section: "Замовлення-наряди", params: { status: "WAITING_APPROVAL" } },
    { label: "Очікують деталі", value: data.flow.waitingParts, section: "Виробництво", params: { status: "WAITING_PARTS" } },
    { label: "Готові до ремонту", value: data.flow.readyForRepair, section: "Виробництво", params: { status: "READY_FOR_REPAIR" } },
    { label: "У ремонті", value: data.flow.inRepair, section: "Виробництво", params: { status: "IN_REPAIR" } },
    { label: "Контроль якості", value: data.flow.qc, section: "Контроль якості", params: { scope: "waiting" } },
    { label: "Готові до видачі", value: data.flow.ready, section: "Замовлення-наряди", params: { status: "READY_FOR_PICKUP" } },
  ];
  const attention = data.attention;
  return <>
    <header className={styles.header}>
      <div><p className="eyebrow">TURBO LEV · КАБІНЕТ КЕРІВНИКА СТАНЦІЇ</p><h1>Операційний пульт станції</h1><span className="muted">{userName || "Керівник станції"} · {data.station.name} · оперативний контур без глобальних фінансів мережі</span></div>
      <button className={styles.primaryAction} type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}>Виробництво зараз →</button>
    </header>

    <section className={styles.kpis}>
      <button type="button" onClick={() => navigateCrm("Планувальник")}><span>Авто сьогодні</span><strong>{data.kpis.carsToday}</strong><small>{data.kpis.carsOnStation} зараз у потоці станції</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}><span>У ремонті</span><strong>{data.kpis.inRepair}</strong><small>активних авто</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}><span>Пости</span><strong>{data.kpis.postsOccupied}/{data.kpis.postsTotal}</strong><small>зайнято зараз</small></button>
      <button type="button" className={data.kpis.needsAction ? styles.kpiAlert : ""} onClick={() => document.getElementById("station-manager-attention")?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>Потребує моєї дії</span><strong>{data.kpis.needsAction}</strong><small>блокери та контрольні точки</small></button>
    </section>

    <section className={styles.alertStrip} aria-label="Операційні ризики">
      <button type="button" className={data.kpis.overdue ? styles.alertCritical : ""} onClick={() => document.getElementById("station-manager-attention")?.scrollIntoView({ behavior: "smooth" })}><span>Протерміновано</span><strong>{data.kpis.overdue}</strong><small>вийшли за плановий час</small></button>
      <button type="button" className={data.kpis.unassigned ? styles.alertWarning : ""} onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}><span>Без механіка</span><strong>{data.kpis.unassigned}</strong><small>активні авто без виконавця</small></button>
      <button type="button" className={data.kpis.noShow ? styles.alertWarning : ""} onClick={() => navigateCrm("Планувальник", { status: "NO_SHOW" })}><span>Не прибули сьогодні</span><strong>{data.kpis.noShow}</strong><small>потребують рішення по запису</small></button>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><p className="eyebrow">ВИРОБНИЧИЙ ПОТІК</p><h2>Де зараз автомобілі станції</h2></div><span className="muted">статус авто ≠ стан оплати</span></div>
      <div className={styles.flow}>{flow.map((item) => <button type="button" key={item.label} onClick={() => navigateCrm(item.section, item.params)}><span>{item.label}</span><strong>{item.value}</strong><em>Відкрити →</em></button>)}</div>
    </section>

    <div className={styles.twoColumns}>
      <section className={styles.panel} id="station-manager-attention">
        <div className={styles.panelHead}><div><p className="eyebrow">ПОТРЕБУЄ МОЄЇ ДІЇ</p><h2>Що керівник має розблокувати</h2></div><span className={styles.badge}>{data.kpis.needsAction}</span></div>
        {attention.length ? <div className={styles.list}>{attention.map((item) => {
          const route = attentionRoute(item);
          return <button className={`${styles.attention} ${item.priority === "CRITICAL" ? styles.attentionCritical : item.priority === "HIGH" ? styles.attentionHigh : ""}`} type="button" key={item.id} onClick={() => navigateCrm(route.section, route.params)}>
            <b>{item.plate}</b><div><strong>{item.reason}</strong><span>{item.vehicle}{item.problem ? ` · ${item.problem}` : ""}</span><small>{item.mechanic || "Механік не призначений"}{item.post ? ` · ${item.post}` : ""} · без руху {waitingLabel(item.waitingMinutes)}</small></div><em>{item.overdue ? "Протерміновано" : statusLabels[item.status] || item.status}</em>
          </button>;
        })}</div> : <div className={styles.empty}>Немає блокерів, прострочень або авто без виконавця.</div>}
      </section>

      <aside className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ШВИДКИЙ ДОСТУП</p><h2>Керування процесом</h2></div></div>
        <div className={styles.quickGrid}>
          <button type="button" onClick={() => navigateCrm("Діагностика")}>Діагностика<span>черга та підтвердження →</span></button>
          <button type="button" onClick={() => navigateCrm("Замовлення-наряди")}>Замовлення-наряди<span>кошториси та статуси →</span></button>
          <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}>Ремонт у роботі<span>пости та активні роботи →</span></button>
          <button type="button" onClick={() => navigateCrm("Контроль якості")}>Контроль якості<span>черга QC та результати →</span></button>
          <button type="button" onClick={() => navigateCrm("Підбір запчастин")}>Запчастини<span>підбір і постачання →</span></button>
          <button type="button" onClick={() => navigateCrm("Планувальник")}>Планувальник<span>запис і майбутнє завантаження →</span></button>
        </div>
      </aside>
    </div>

    <div className={styles.resourceColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ПОСТИ</p><h2>Завантаження робочих місць</h2></div><button type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}>Всі пости →</button></div>
        <div className={styles.resourceList}>{data.posts.map((post) => <button type="button" key={post.id} className={styles.resourceRow} onClick={() => navigateCrm("Виробництво", { scope: "posts" })}>
          <div><strong>{post.name}</strong><span>{post.occupied ? `${post.plate || "—"} · ${post.vehicle || "Автомобіль"}` : "Вільний"}</span></div>
          <small>{post.occupied ? `${post.mechanic || "Без механіка"}${timeLabel(post.plannedEndAt) ? ` · до ${timeLabel(post.plannedEndAt)}` : ""}` : "Можна ставити авто"}</small>
          <em className={post.occupied ? styles.resourceBusy : styles.resourceFree}>{post.occupied ? "Зайнятий" : "Вільний"}</em>
        </button>)}</div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">МЕХАНІКИ</p><h2>Поточне навантаження</h2></div><button type="button" onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}>Всі механіки →</button></div>
        <div className={styles.resourceList}>{data.mechanics.map((mechanic) => <button type="button" key={mechanic.id} className={styles.resourceRow} onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}>
          <div><strong>{mechanic.name}</strong><span>{mechanic.activeCars ? `${mechanic.activeCars} авто в активному потоці` : "Активних авто немає"}</span></div>
          <small>{mechanic.inRepair} у ремонті · {mechanic.waiting} у черзі/очікуванні</small>
          <em className={mechanic.available ? styles.resourceFree : styles.resourceBusy}>{mechanic.available ? "Доступний" : "Зайнятий"}</em>
        </button>)}</div>
      </section>
    </div>
  </>;
}

export function RoleAwareOverview({ access }: { access: CrmAccessSnapshot | null }) {
  const roleCodes = useMemo(() => new Set((access?.roles ?? []).map((role) => role.code).filter(Boolean)), [access?.roles]);
  const specialRole = roleCodes.has("STATION_MANAGER") ? "STATION_MANAGER" : roleCodes.has("MECHANIC") ? "MECHANIC" : null;
  const ownerRole = roleCodes.has("OWNER") || roleCodes.has("EXECUTIVE_DIRECTOR");
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

  if (ownerRole && access?.provisioningState === "ACTIVE") return <OwnerControlCenter userName={access?.user?.name} />;
  if (!specialRole || access?.provisioningState !== "ACTIVE") return <StationOverview />;
  if (loading && !data) return <Loading />;
  if (error && !data) return <div className={styles.state}><strong>Не вдалося відкрити кабінет</strong><span>{error}</span><button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!data) return <Loading />;
  if (data.cabinet === "MECHANIC") return <MechanicMobileCabinet data={data} userName={access?.user?.name} />;
  return <StationManagerCabinet data={data} userName={access?.user?.name} />;
}