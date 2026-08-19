"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { navigateCrm, type CrmRouteParams } from "./crm-route";
import type { CrmAccessSnapshot } from "./use-crm-access";
import { StationOverview } from "./station-overview";
import type { CrmSectionLabel } from "./crm-navigation";
import styles from "./role-cabinet.module.css";

type MechanicPayload = {
  ok: true;
  cabinet: "MECHANIC";
  linked: boolean;
  reason?: string;
  mechanic?: { id: string; name: string; station: { id: string; name: string } };
  kpis?: { assigned: number; inProgress: number; completedToday: number; waitingParts: number };
  tasks?: Array<{ id: string; workOrderId: string; description: string; status: string; type: string; laborHours: string | null; plate: string; vehicle: string; workOrderStatus: string; updatedAt: string }>;
  appointments?: Array<{ id: string; status: string; plannedStartAt: string; plannedEndAt: string; plate: string; vehicle: string; problem: string | null; post: string | null }>;
};

type ManagerPayload = {
  ok: true;
  cabinet: "STATION_MANAGER";
  linked: boolean;
  reason?: string;
  station?: { id: string; name: string };
  kpis?: { carsToday: number; carsOnStation: number; inRepair: number; postsOccupied: number; postsTotal: number; mechanicsTotal: number; noShow: number };
  flow?: { booked: number; diagnostics: number; approval: number; waitingParts: number; readyForRepair: number; inRepair: number; qc: number; ready: number };
  attention?: Array<{ id: string; status: string; plate: string; vehicle: string; problem: string | null; plannedStartAt: string; post: string | null; mechanic: string | null }>;
};

type Payload = MechanicPayload | ManagerPayload;
type FlowRoute = { label: string; value: number; section: CrmSectionLabel; params?: CrmRouteParams };

const statusLabels: Record<string, string> = {
  DRAFT: "Чернетка",
  APPROVED: "Погоджено",
  IN_PROGRESS: "В роботі",
  COMPLETED: "Завершено",
  BOOKED: "Записаний",
  ARRIVED: "Приїхав",
  DIAGNOSTICS: "Діагностика",
  WAITING_APPROVAL: "Очікує погодження",
  WAITING_PARTS: "Очікує деталі",
  READY_FOR_REPAIR: "Готовий до ремонту",
  IN_REPAIR: "У ремонті",
  WAITING_QC: "Очікує QC",
  READY_FOR_PICKUP: "Готовий до видачі",
  PAUSED: "Призупинено",
  NO_SHOW: "Не приїхав",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function Loading() {
  return <div className={styles.state}><strong>Завантажую робочий кабінет…</strong><span>Дані беруться з поточного профілю доступу.</span></div>;
}

function LinkRequired({ role }: { role: "mechanic" | "manager" }) {
  const mechanic = role === "mechanic";
  return <div className={styles.state}>
    <strong>{mechanic ? "Кабінет автомеханіка створений, але профіль ще не прив’язаний" : "Кабінет завідувача створений, але станція ще не призначена"}</strong>
    <span>{mechanic ? "Коли створимо акаунт працівника, прив’яжемо його до ресурсу автомеханіка в Планувальнику — після цього тут автоматично з’являться тільки його роботи." : "При створенні акаунта завідувача призначимо йому станцію Глеваха. Після цього пульт покаже тільки її операційні дані."}</span>
  </div>;
}

function MechanicCabinet({ data, userName }: { data: MechanicPayload; userName?: string | null }) {
  if (!data.linked || !data.mechanic || !data.kpis) return <LinkRequired role="mechanic" />;
  const tasks = data.tasks ?? [];
  const appointments = data.appointments ?? [];
  return <>
    <header className={styles.header}>
      <div><p className="eyebrow">TURBO LEV · ПЕРСОНАЛЬНИЙ КАБІНЕТ</p><h1>Мої роботи</h1><span className="muted">{userName || data.mechanic.name} · Автомеханік · {data.mechanic.station.name}</span></div>
      <button className={styles.primaryAction} type="button" onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}>Відкрити мої роботи →</button>
    </header>

    <section className={styles.kpis}>
      <button type="button" onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}><span>Призначено</span><strong>{data.kpis.assigned}</strong><small>активних робіт</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR", scope: "mechanics" })}><span>Зараз у роботі</span><strong>{data.kpis.inProgress}</strong><small>розпочатих робіт</small></button>
      <button type="button" onClick={() => navigateCrm("Замовлення-наряди", { status: "CLOSED" })}><span>Завершено сьогодні</span><strong>{data.kpis.completedToday}</strong><small>моїх робіт</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { status: "WAITING_PARTS", scope: "mechanics" })}><span>Очікують деталей</span><strong>{data.kpis.waitingParts}</strong><small>нарядів</small></button>
    </section>

    <div className={styles.twoColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">МОЇ ЗАВДАННЯ</p><h2>Роботи в нарядах</h2></div><button type="button" onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}>Виробнича дошка →</button></div>
        {tasks.length ? <div className={styles.list}>{tasks.map((task) => <button className={styles.task} type="button" key={task.id} onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: task.workOrderId, workOrderTab: "works" })}>
          <div><b>{task.plate}</b><span>{task.vehicle}</span></div>
          <div className={styles.taskMain}><strong>{task.description}</strong><span>{task.laborHours ? `${task.laborHours} нормо-год.` : "Без норми часу"}</span></div>
          <em>{statusLabels[task.status] || task.status}</em>
        </button>)}</div> : <div className={styles.empty}>Активних робіт поки немає.</div>}
      </section>

      <aside className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">СЬОГОДНІ</p><h2>Мій графік</h2></div><button type="button" onClick={() => navigateCrm("Планувальник")}>Планувальник →</button></div>
        {appointments.length ? <div className={styles.timeline}>{appointments.map((item) => <div className={styles.timelineItem} key={item.id}><time>{formatTime(item.plannedStartAt)}</time><div><b>{item.plate} · {item.vehicle}</b><span>{item.problem || "Без опису робіт"}</span><small>{item.post || "Пост не призначено"} · {statusLabels[item.status] || item.status}</small></div></div>)}</div> : <div className={styles.empty}>На сьогодні записів не призначено.</div>}
      </aside>
    </div>
  </>;
}

function attentionRoute(item: NonNullable<ManagerPayload["attention"]>[number]): { section: CrmSectionLabel; params: CrmRouteParams } {
  if (item.status === "NO_SHOW") return { section: "Планувальник", params: { appointmentId: item.id, status: "NO_SHOW" } };
  if (item.status === "WAITING_QC") return { section: "Замовлення-наряди", params: { scope: "qc", plate: item.plate } };
  if (["WAITING_APPROVAL", "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "READY_FOR_PICKUP"].includes(item.status)) {
    return { section: "Замовлення-наряди", params: { status: item.status, plate: item.plate } };
  }
  return { section: "Замовлення-наряди", params: { plate: item.plate } };
}

function StationManagerCabinet({ data, userName }: { data: ManagerPayload; userName?: string | null }) {
  if (!data.linked || !data.station || !data.kpis || !data.flow) return <LinkRequired role="manager" />;
  const flow: FlowRoute[] = [
    { label: "Записані", value: data.flow.booked, section: "Планувальник", params: { status: "BOOKED" } },
    { label: "Приймання / діагностика", value: data.flow.diagnostics, section: "Діагностика" },
    { label: "Погодження", value: data.flow.approval, section: "Замовлення-наряди", params: { status: "WAITING_APPROVAL" } },
    { label: "Очікують деталі", value: data.flow.waitingParts, section: "Виробництво", params: { status: "WAITING_PARTS" } },
    { label: "Готові до ремонту", value: data.flow.readyForRepair, section: "Виробництво", params: { status: "READY_FOR_REPAIR" } },
    { label: "У ремонті", value: data.flow.inRepair, section: "Виробництво", params: { status: "IN_REPAIR" } },
    { label: "QC", value: data.flow.qc, section: "Замовлення-наряди", params: { scope: "qc" } },
    { label: "До видачі", value: data.flow.ready, section: "Замовлення-наряди", params: { status: "READY_FOR_PICKUP" } },
  ];
  const attention = data.attention ?? [];
  return <>
    <header className={styles.header}>
      <div><p className="eyebrow">TURBO LEV · КАБІНЕТ ЗАВІДУВАЧА</p><h1>Операційний пульт станції</h1><span className="muted">{userName || "Завідувач станцією"} · {data.station.name} · без глобальних фінансів мережі</span></div>
      <button className={styles.primaryAction} type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}>Виробництво зараз →</button>
    </header>

    <section className={styles.kpis}>
      <button type="button" onClick={() => navigateCrm("Планувальник")}><span>Авто сьогодні</span><strong>{data.kpis.carsToday}</strong><small>{data.kpis.carsOnStation} у потоці станції</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}><span>У ремонті</span><strong>{data.kpis.inRepair}</strong><small>активних авто</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { scope: "posts" })}><span>Пости</span><strong>{data.kpis.postsOccupied}/{data.kpis.postsTotal}</strong><small>зайнято зараз</small></button>
      <button type="button" onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}><span>Автомеханіки</span><strong>{data.kpis.mechanicsTotal}</strong><small>активних на станції</small></button>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><p className="eyebrow">ВИРОБНИЧИЙ ПОТІК</p><h2>Що відбувається на станції</h2></div><span className="muted">без виручки та глобального P&amp;L</span></div>
      <div className={styles.flow}>{flow.map((item) => <button type="button" key={item.label} onClick={() => navigateCrm(item.section, item.params)}><span>{item.label}</span><strong>{item.value}</strong><em>Відкрити →</em></button>)}</div>
    </section>

    <div className={styles.twoColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ПОТРЕБУЄ УВАГИ</p><h2>Блокери та контрольні точки</h2></div><span className={styles.badge}>{attention.length}</span></div>
        {attention.length ? <div className={styles.list}>{attention.map((item) => {
          const route = attentionRoute(item);
          return <button className={styles.attention} type="button" key={item.id} onClick={() => navigateCrm(route.section, route.params)}>
            <b>{item.plate}</b><div><strong>{item.vehicle}</strong><span>{item.problem || "Без примітки"}</span><small>{item.mechanic || "Механік не призначений"}{item.post ? ` · ${item.post}` : ""}</small></div><em>{statusLabels[item.status] || item.status}</em>
          </button>;
        })}</div> : <div className={styles.empty}>Критичних блокерів на сьогодні немає.</div>}
      </section>

      <aside className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ШВИДКИЙ ДОСТУП</p><h2>Керування станцією</h2></div></div>
        <div className={styles.quickGrid}>
          <button type="button" onClick={() => navigateCrm("Діагностика")}>Діагностика<span>черга та підтвердження →</span></button>
          <button type="button" onClick={() => navigateCrm("Замовлення-наряди")}>Замовлення-наряди<span>кошториси та статуси →</span></button>
          <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}>Ремонт у роботі<span>пости та активні роботи →</span></button>
          <button type="button" onClick={() => navigateCrm("Замовлення-наряди", { scope: "qc" })}>Контроль якості<span>QC та видача →</span></button>
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
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!specialRole || access?.provisioningState !== "ACTIVE") return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/cabinet/home", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не вдалося завантажити кабінет");
      setData(body as Payload);
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
  if (data.cabinet === "MECHANIC") return <MechanicCabinet data={data} userName={access?.user?.name} />;
  return <StationManagerCabinet data={data} userName={access?.user?.name} />;
}
