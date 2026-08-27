"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CabinetHomePayload, StationManagerAttentionContract, StationManagerCabinetPayload } from "@/src/lib/contracts/cabinet-home";
import { cabinetHomePayloadMessage, parseCabinetHomePayload } from "@/src/lib/contracts/cabinet-home-payload.parsers";
import { navigateCrm, type CrmRouteParams } from "./crm-route";
import type { CrmAccessSnapshot } from "./use-crm-access";
import { StationOverview } from "./station-overview";
import { OwnerControlCenter } from "./owner-dashboard";
import { MechanicMobileCabinet } from "./mechanic-mobile-cabinet";
import { ServiceAdvisorCabinetHome } from "./service-advisor-cabinet-home";
import { PartsRoleCabinetHome } from "./parts-role-cabinet-home";
import type { CrmSectionLabel } from "./crm-navigation";
import styles from "./role-cabinet.module.css";

type FlowRoute = { label: string; value: number; section: CrmSectionLabel; params?: CrmRouteParams };
type LinkedStationManagerCabinet = Extract<StationManagerCabinetPayload, { linked: true }>;
type ManagerAttentionFilter = "ALL" | "MISSED_CALL" | "NEW_INQUIRY" | "STUCK_CARS" | "COMMERCIAL_PROPOSAL_NOT_SENT" | "CUSTOMER_DECISION_WAIT" | "PARTS_BLOCKING" | "NO_SHOW" | "NO_MECHANIC";

const STUCK_CAR_CODES = new Set([
  "ARRIVED_STALLED",
  "PARTS_SELECTION_STALLED",
  "CALCULATION_STALLED",
  "APPROVAL_STALLED",
  "PARTS_ETA_OVERDUE",
  "PARTS_ETA_MISSING",
  "READY_FOR_REPAIR_STALLED",
  "REPAIR_OVERRUN",
  "QC_STALLED",
  "PAYMENT_STALLED",
  "PICKUP_STALLED",
  "PAUSED_STALLED",
  "PLAN_OVERRUN",
]);

const PARTS_BLOCKING_CODES = new Set(["PARTS_SELECTION_STALLED", "PARTS_ETA_OVERDUE", "PARTS_ETA_MISSING"]);

function Loading() {
  return <div className={styles.state}><strong>Завантажую робочий кабінет…</strong><span>Дані беруться з поточного профілю доступу.</span></div>;
}

function LinkRequired() {
  return <div className={styles.state}>
    <strong>Кабінет Керівника станції створений, але станція ще не призначена</strong>
    <span>Призначте станцію працівнику в «Персонал». Після цього пульт покаже тільки її операційні дані.</span>
  </div>;
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

function attentionMatches(item: StationManagerAttentionContract, filter: ManagerAttentionFilter) {
  if (filter === "ALL") return true;
  if (filter === "STUCK_CARS") return STUCK_CAR_CODES.has(item.code);
  if (filter === "PARTS_BLOCKING") return PARTS_BLOCKING_CODES.has(item.code);
  return item.code === filter;
}

function attentionContext(item: StationManagerAttentionContract) {
  if (item.plate) return item.plate;
  if (item.sourceType === "INQUIRY") return "Звернення";
  if (item.sourceType === "ESTIMATE") return "КП";
  return "Авто";
}

function openManagerAttention(item: StationManagerAttentionContract) {
  navigateCrm(item.action.section as CrmSectionLabel, (item.action.params ?? {}) as CrmRouteParams);
}

function StationManagerLinkedCabinet({ data, userName }: { data: LinkedStationManagerCabinet; userName?: string | null }) {
  const [attentionFilter, setAttentionFilter] = useState<ManagerAttentionFilter>("ALL");
  const flow: FlowRoute[] = [
    { label: "Заплановано сьогодні", value: data.flow.booked, section: "Планувальник", params: { status: "BOOKED" } },
    { label: "Приймання / діагностика", value: data.flow.diagnostics, section: "Діагностика" },
    { label: "Погодження", value: data.flow.approval, section: "Комерційна пропозиція", params: { status: "WAITING_APPROVAL" } },
    { label: "Очікують деталі", value: data.flow.waitingParts, section: "Виробництво", params: { status: "WAITING_PARTS" } },
    { label: "Готові до ремонту", value: data.flow.readyForRepair, section: "Виробництво", params: { status: "READY_FOR_REPAIR" } },
    { label: "У ремонті", value: data.flow.inRepair, section: "Виробництво", params: { status: "IN_REPAIR" } },
    { label: "Контроль якості", value: data.flow.qc, section: "Контроль якості", params: { scope: "waiting" } },
    { label: "Готові до видачі", value: data.flow.ready, section: "Комерційна пропозиція", params: { status: "READY_FOR_PICKUP" } },
  ];

  const filteredAttention = useMemo(
    () => data.attention.filter((item) => attentionMatches(item, attentionFilter)),
    [data.attention, attentionFilter],
  );

  const filterLabels: Record<ManagerAttentionFilter, string> = {
    ALL: "Усі сигнали",
    MISSED_CALL: "Пропущені дзвінки",
    NEW_INQUIRY: "Нові звернення",
    STUCK_CARS: "Завислі авто",
    COMMERCIAL_PROPOSAL_NOT_SENT: "КП не відправлена",
    CUSTOMER_DECISION_WAIT: "Очікуємо рішення клієнта",
    PARTS_BLOCKING: "Запчастини блокують ремонт",
    NO_SHOW: "Не прибули",
    NO_MECHANIC: "Без механіка",
  };

  const selectFilter = (filter: ManagerAttentionFilter) => {
    setAttentionFilter(filter);
    window.setTimeout(() => document.getElementById("station-manager-attention")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const roleKpis: Array<{ label: string; value: number; hint: string; filter: ManagerAttentionFilter; critical?: boolean }> = [
    { label: "Пропущені дзвінки", value: data.kpis.missedCalls, hint: "ще не опрацьовані", filter: "MISSED_CALL", critical: true },
    { label: "Нові звернення", value: data.kpis.newInquiries, hint: "очікують першої реакції", filter: "NEW_INQUIRY" },
    { label: "Завислі авто", value: data.kpis.stuckCars, hint: "процес не рухається", filter: "STUCK_CARS", critical: true },
    { label: "КП не відправлена", value: data.kpis.proposalsNotSent, hint: "кошторис готовий як DRAFT", filter: "COMMERCIAL_PROPOSAL_NOT_SENT", critical: true },
    { label: "Очікуємо рішення", value: data.kpis.waitingCustomerDecision, hint: "КП відправлена клієнту", filter: "CUSTOMER_DECISION_WAIT" },
    { label: "Блокують запчастини", value: data.kpis.partsBlocking, hint: "підбір, ETA або поставка", filter: "PARTS_BLOCKING" },
    { label: "Не прибули", value: data.kpis.noShow, hint: "потребують рішення по запису", filter: "NO_SHOW" },
    { label: "Без механіка", value: data.kpis.unassigned, hint: "активні авто без виконавця", filter: "NO_MECHANIC" },
  ];

  return <>
    <header className={styles.header}>
      <div><p className="eyebrow">TURBO LEV · КАБІНЕТ КЕРІВНИКА СТАНЦІЇ</p><h1>Операційний пульт станції</h1><span className="muted">{userName || "Керівник станції"} · {data.station.name} · усе, що зараз потребує управлінської дії</span></div>
      <button className={styles.primaryAction} type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}>Виробництво зараз →</button>
    </header>

    <section className={styles.managerKpis} aria-label="Ключові показники керівника станції">
      {roleKpis.map((item) => <button
        type="button"
        key={item.filter}
        className={`${item.value > 0 ? styles.managerKpiActive : ""} ${item.critical && item.value > 0 ? styles.managerKpiCritical : ""} ${attentionFilter === item.filter ? styles.managerKpiSelected : ""}`}
        aria-pressed={attentionFilter === item.filter}
        onClick={() => selectFilter(item.filter)}
      >
        <span>{item.label}</span><strong>{item.value}</strong><small>{item.hint}</small>
      </button>)}
    </section>

    <section className={styles.managerSummary} aria-label="Стан виробництва">
      <button type="button" onClick={() => navigateCrm("Планувальник")}><span>Авто сьогодні</span><strong>{data.kpis.carsToday}</strong><small>{data.kpis.carsOnStation} зараз у потоці</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}><span>У ремонті</span><strong>{data.kpis.inRepair}</strong><small>активних авто</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}><span>Пости</span><strong>{data.kpis.postsOccupied}/{data.kpis.postsTotal}</strong><small>зайнято зараз</small></button>
      <button type="button" className={data.kpis.needsAction ? styles.kpiAlert : ""} onClick={() => selectFilter("ALL")}><span>Всього сигналів</span><strong>{data.kpis.needsAction}</strong><small>{data.kpis.overdue} уже прострочено</small></button>
    </section>

    <section className={styles.panel} id="station-manager-attention">
      <div className={styles.panelHead}>
        <div><p className="eyebrow">ЦЕНТР УВАГИ</p><h2>{filterLabels[attentionFilter]}</h2><span className="muted">Натисніть на сигнал — CRM відкриє саме той етап, де потрібно виправити проблему.</span></div>
        <div className={styles.attentionToolbar}><span className={styles.badge}>{filteredAttention.length}</span>{attentionFilter !== "ALL" && <button type="button" className={styles.filterReset} onClick={() => setAttentionFilter("ALL")}>Показати всі</button>}</div>
      </div>
      {filteredAttention.length ? <div className={styles.list}>{filteredAttention.map((item) => <button
        className={`${styles.attention} ${item.priority === "CRITICAL" ? styles.attentionCritical : item.priority === "HIGH" ? styles.attentionHigh : ""}`}
        type="button"
        key={item.id}
        onClick={() => openManagerAttention(item)}
      >
        <b className={styles.attentionContext}>{attentionContext(item)}</b>
        <div className={styles.attentionMain}>
          <strong>{item.title}</strong>
          <span>{item.description || item.reason}</span>
          <small>{[item.customer, item.vehicle].filter(Boolean).join(" · ") || "Операційний сигнал"} · {item.overdue ? "прострочено" : "очікує"} {waitingLabel(item.waitingMinutes)}</small>
        </div>
        <em className={styles.attentionAction}>{item.action.label} →</em>
      </button>)}</div> : <div className={styles.empty}>За цим показником активних проблем немає.</div>}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><p className="eyebrow">ВИРОБНИЧИЙ ПОТІК</p><h2>Де зараз автомобілі станції</h2></div><span className="muted">кожен етап відкривається окремо</span></div>
      <div className={styles.flow}>{flow.map((item) => <button type="button" key={item.label} onClick={() => navigateCrm(item.section, item.params)}><span>{item.label}</span><strong>{item.value}</strong><em>Відкрити →</em></button>)}</div>
    </section>

    <div className={styles.twoColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ШВИДКИЙ ДОСТУП</p><h2>Керування процесом</h2></div></div>
        <div className={styles.quickGrid}>
          <button type="button" onClick={() => navigateCrm("Нові звернення")}>Нові звернення<span>дзвінки та вхідні запити →</span></button>
          <button type="button" onClick={() => navigateCrm("Діагностика")}>Діагностика<span>черга та підтвердження →</span></button>
          <button type="button" onClick={() => navigateCrm("Комерційна пропозиція")}>Комерційна пропозиція<span>КП, погодження та статуси →</span></button>
          <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}>Ремонт у роботі<span>пости та активні роботи →</span></button>
          <button type="button" onClick={() => navigateCrm("Контроль якості")}>Контроль якості<span>черга QC та результати →</span></button>
          <button type="button" onClick={() => navigateCrm("Підбір запчастин")}>Запчастини<span>підбір і постачання →</span></button>
          <button type="button" onClick={() => navigateCrm("Планувальник")}>Планувальник<span>запис і майбутнє завантаження →</span></button>
        </div>
      </section>
      <aside className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">КОНТРОЛЬ СТАНЦІЇ</p><h2>Що бачить керівник</h2></div></div>
        <div className={styles.controlFacts}>
          <div><span>Механіків</span><strong>{data.kpis.mechanicsTotal}</strong></div>
          <div><span>Авто на станції</span><strong>{data.kpis.carsOnStation}</strong></div>
          <div><span>Прострочені сигнали</span><strong>{data.kpis.overdue}</strong></div>
          <div><span>Потребують дії</span><strong>{data.kpis.needsAction}</strong></div>
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

function StationManagerCabinet({ data, userName }: { data: StationManagerCabinetPayload; userName?: string | null }) {
  if (!data.linked) return <LinkRequired />;
  return <StationManagerLinkedCabinet data={data} userName={userName} />;
}

export function RoleAwareOverview({ access }: { access: CrmAccessSnapshot | null }) {
  const roleCodes = useMemo(() => new Set((access?.roles ?? []).map((role) => role.code).filter(Boolean)), [access?.roles]);
  const primaryRoleCode = access?.roles.find((role) => role.isPrimary)?.code || access?.roles[0]?.code || null;
  const specialRole = roleCodes.has("STATION_MANAGER") ? "STATION_MANAGER" : roleCodes.has("MECHANIC") ? "MECHANIC" : null;
  const ownerRole = roleCodes.has("OWNER") || roleCodes.has("EXECUTIVE_DIRECTOR");
  const serviceAdvisorRole = primaryRoleCode === "SERVICE_ADVISOR";
  const partsRole = primaryRoleCode === "PARTS_SPECIALIST" ? "PARTS_SPECIALIST" : primaryRoleCode === "WAREHOUSE_KEEPER" ? "WAREHOUSE_KEEPER" : null;
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

  useEffect(() => {
    void load();
    const handler = () => void load();
    window.addEventListener("turbolev:data-changed", handler);
    return () => window.removeEventListener("turbolev:data-changed", handler);
  }, [load]);

  if (ownerRole && access?.provisioningState === "ACTIVE") return <OwnerControlCenter userName={access?.user?.name} />;
  if (serviceAdvisorRole && access?.provisioningState === "ACTIVE") return <ServiceAdvisorCabinetHome userName={access?.user?.name} />;
  if (partsRole && access?.provisioningState === "ACTIVE") return <PartsRoleCabinetHome role={partsRole} userName={access?.user?.name} />;
  if (!specialRole || access?.provisioningState !== "ACTIVE") return <StationOverview />;
  if (loading && !data) return <Loading />;
  if (error && !data) return <div className={styles.state}><strong>Не вдалося відкрити кабінет</strong><span>{error}</span><button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!data) return <Loading />;
  if (data.cabinet === "MECHANIC") return <MechanicMobileCabinet data={data} userName={access?.user?.name} />;
  return <StationManagerCabinet data={data} userName={access?.user?.name} />;
}
