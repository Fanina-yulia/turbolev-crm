"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./mechanic-mobile-cabinet-v2.module.css";

type MechanicTask = {
  id: string;
  workOrderId: string;
  description: string;
  status: string;
  type: string;
  laborHours: string | null;
  plate: string;
  vehicle: string;
  workOrderStatus: string;
  updatedAt: string;
};

type MechanicAppointment = {
  id: string;
  status: string;
  plannedStartAt: string;
  plannedEndAt: string;
  plate: string;
  vehicle: string;
  problem: string | null;
  post: string | null;
};

type MechanicPayload = {
  linked: boolean;
  mechanic?: { id: string; name: string; station: { id: string; name: string } };
  kpis?: { assigned: number; inProgress: number; completedToday: number; waitingParts: number };
  tasks?: MechanicTask[];
  appointments?: MechanicAppointment[];
};

type DiagnosticQueueItem = {
  id: string;
  status: string;
  workflowState: string;
  reviewState: string;
  plannedStartAt: string;
  plannedEndAt: string;
  post: string | null;
  problem: string | null;
  vehicle: { label: string; plateNumber: string | null };
  client: { name: string | null; phone: string };
};

type Payroll = {
  ok: boolean;
  projection?: { total?: number | string; month?: string };
  summary?: Record<string, unknown>;
};

type Screen = "HOME" | "WORKS" | "WORK_DETAIL" | "DIAGNOSTICS" | "SCHEDULE" | "PAYROLL";

const taskStatusLabel: Record<string, string> = {
  DRAFT: "Заплановано",
  APPROVED: "Погоджено",
  PENDING: "Заплановано",
  READY: "Готово до роботи",
  IN_PROGRESS: "В роботі",
  PAUSED: "Пауза",
  COMPLETED: "Виконано",
  DONE: "Виконано",
  WAITING_PARTS: "Очікує запчастини",
  WAITING_APPROVAL: "Очікує погодження",
  CANCELLED: "Скасовано",
};

const diagnosticStatusLabel: Record<string, string> = {
  PENDING: "Не розпочата",
  IN_PROGRESS: "В роботі",
  SUBMITTED: "Передано менеджеру",
  RETURNED: "Повернено на уточнення",
  CONFIRMED: "Підтверджено",
  CANCELLED: "Скасовано",
};

function kyivDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function time(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateLong(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function duration(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} хв`;
  if (!rest) return `${hours} год`;
  return `${hours} год ${rest} хв`;
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(number)
    : "—";
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 12) return "Доброго ранку";
  if (hour < 18) return "Добрий день";
  return "Добрий вечір";
}

function firstName(value?: string | null) {
  return value?.trim().split(/\s+/)[0] || "майстре";
}

function statusClass(status: string) {
  if (["COMPLETED", "DONE", "CONFIRMED"].includes(status)) return styles.statusDone;
  if (["IN_PROGRESS"].includes(status)) return styles.statusActive;
  if (["WAITING_PARTS", "WAITING_APPROVAL", "RETURNED"].includes(status)) return styles.statusWaiting;
  if (["CANCELLED"].includes(status)) return styles.statusMuted;
  return styles.statusPlanned;
}

function BottomNav({ screen, onChange, onPayroll }: { screen: Screen; onChange: (screen: Screen) => void; onPayroll: () => void }) {
  return <nav className={styles.bottomNav} aria-label="Навігація кабінету механіка">
    <button type="button" className={screen === "HOME" ? styles.navActive : ""} onClick={() => onChange("HOME")}><span>⌂</span><b>Головна</b></button>
    <button type="button" className={screen === "DIAGNOSTICS" ? styles.navActive : ""} onClick={() => onChange("DIAGNOSTICS")}><span>◇</span><b>Діагностика</b></button>
    <button type="button" className={["WORKS", "WORK_DETAIL"].includes(screen) ? styles.navActive : ""} onClick={() => onChange("WORKS")}><span>▤</span><b>Мої роботи</b></button>
    <button type="button" className={screen === "SCHEDULE" ? styles.navActive : ""} onClick={() => onChange("SCHEDULE")}><span>▣</span><b>Графік</b></button>
    <button type="button" className={screen === "PAYROLL" ? styles.navActive : ""} onClick={onPayroll}><span>₴</span><b>Зарплата</b></button>
  </nav>;
}

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return <header className={styles.topBar}>
    <button type="button" className={styles.backButton} onClick={onBack} aria-label="Назад">‹</button>
    <strong>{title}</strong>
    <span className={styles.topBarSpacer} />
  </header>;
}

export function MechanicMobileCabinet({ data, userName }: { data: MechanicPayload; userName?: string | null }) {
  const [screen, setScreen] = useState<Screen>("HOME");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [queue, setQueue] = useState<DiagnosticQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [error, setError] = useState("");

  const tasks = useMemo(() => data.tasks ?? [], [data.tasks]);
  const appointments = useMemo(() => data.appointments ?? [], [data.appointments]);
  const todayKey = kyivDateKey(new Date());
  const todayAppointments = useMemo(() => appointments
    .filter((item) => kyivDateKey(item.plannedStartAt) === todayKey)
    .sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime()), [appointments, todayKey]);

  const selectedTask = useMemo(() => tasks.find((item) => item.id === selectedTaskId) ?? null, [tasks, selectedTaskId]);
  const selectedOrderTasks = useMemo(() => selectedTask ? tasks.filter((item) => item.workOrderId === selectedTask.workOrderId) : [], [tasks, selectedTask]);
  const selectedAppointment = useMemo(() => selectedTask
    ? appointments.find((item) => item.plate === selectedTask.plate || item.vehicle === selectedTask.vehicle) ?? null
    : null, [appointments, selectedTask]);

  const completed = data.kpis?.completedToday ?? tasks.filter((item) => ["COMPLETED", "DONE"].includes(item.status)).length;
  const inProgress = data.kpis?.inProgress ?? tasks.filter((item) => item.status === "IN_PROGRESS").length;
  const cancelled = tasks.filter((item) => item.status === "CANCELLED").length;
  const planned = Math.max(0, (data.kpis?.assigned ?? tasks.length) - completed - cancelled);

  const nextAppointment = useMemo(() => {
    const now = Date.now();
    return todayAppointments.find((item) => new Date(item.plannedEndAt).getTime() >= now) ?? todayAppointments[0] ?? null;
  }, [todayAppointments]);
  const nextTask = useMemo(() => {
    if (!nextAppointment) return tasks.find((item) => !["COMPLETED", "DONE", "CANCELLED"].includes(item.status)) ?? tasks[0] ?? null;
    return tasks.find((item) => item.plate === nextAppointment.plate || item.vehicle === nextAppointment.vehicle) ?? tasks[0] ?? null;
  }, [nextAppointment, tasks]);

  const loadDiagnostics = useCallback(async () => {
    setQueueLoading(true);
    setError("");
    try {
      const response = await fetch("/api/diagnostics/me", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити діагностики");
      setQueue(body.items || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити діагностики");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => { void loadDiagnostics(); }, [loadDiagnostics]);

  async function openPayroll() {
    setScreen("PAYROLL");
    setError("");
    try {
      const response = await fetch("/api/me/compensation", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити зарплату");
      setPayroll(body as Payroll);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити зарплату");
    }
  }

  function openTask(task: MechanicTask) {
    setSelectedTaskId(task.id);
    setScreen("WORK_DETAIL");
  }

  function openProduction(task?: MechanicTask | null) {
    if (task) {
      navigateCrm("Виробництво", { scope: "mechanics", workOrderId: task.workOrderId });
      return;
    }
    navigateCrm("Виробництво", { scope: "mechanics" });
  }

  if (!data.linked || !data.mechanic) {
    return <div className={styles.linkState}><strong>Кабінет механіка ще не прив’язаний</strong><span>Призначте працівнику ресурс автомеханіка і станцію в «Персонал».</span></div>;
  }

  const mechanicName = userName || data.mechanic.name;
  const currentPost = nextAppointment?.post || todayAppointments.find((item) => item.post)?.post || "Пост не призначено";

  return <div className={styles.app}>
    <div className={styles.phoneShell}>
      {screen === "HOME" && <>
        <header className={styles.heroHeader}>
          <div className={styles.brandRow}><div className={styles.brand}><span>ТУРБО</span><b>ЛЕВ</b></div><button type="button" className={styles.bell} aria-label="Сповіщення">♢<em>{data.kpis?.waitingParts || 0}</em></button></div>
          <p>Кабінет механіка</p>
        </header>

        <main className={styles.content}>
          <section className={styles.greetingCard}>
            <div className={styles.avatar}>{firstName(mechanicName).slice(0, 1).toUpperCase()}</div>
            <div><h1>{greeting()}, {firstName(mechanicName)}!</h1><p>{currentPost}</p><span>{data.mechanic.station.name}</span></div>
          </section>

          <section className={styles.dayCard}>
            <div className={styles.sectionHeading}><div><h2>Сьогодні, {new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long" }).format(new Date())}</h2><span>{new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date())}</span></div></div>
            <div className={styles.metrics}>
              <div><b className={styles.metricOrange}>{planned}</b><span>Заплановано</span></div>
              <div><b className={styles.metricBlue}>{inProgress}</b><span>В роботі</span></div>
              <div><b className={styles.metricGreen}>{completed}</b><span>Завершено</span></div>
              <div><b>{cancelled}</b><span>Скасовано</span></div>
            </div>
          </section>

          <section className={styles.nextSection}>
            <div className={styles.sectionHeading}><div><h2>Наступна робота</h2><span>{nextAppointment ? `о ${time(nextAppointment.plannedStartAt)}` : "за планом"}</span></div>{nextAppointment && <em>{new Date(nextAppointment.plannedStartAt).getTime() > Date.now() ? "Незабаром" : "Зараз"}</em>}</div>
            {nextTask ? <article className={styles.nextCard}>
              <div className={styles.vehicleRow}><div className={styles.carBadge}>🚗</div><div><h3>{nextTask.vehicle}</h3><p>{nextTask.plate || "Без номера"}</p></div><span className={`${styles.statusPill} ${statusClass(nextTask.status)}`}>{taskStatusLabel[nextTask.status] || nextTask.status}</span></div>
              <div className={styles.workText}>🔧 {nextTask.description}</div>
              {nextAppointment?.problem && <p className={styles.problemText}>+ {nextAppointment.problem}</p>}
              <div className={styles.jobMeta}><div><span>Час</span><b>{time(nextAppointment?.plannedStartAt)}</b></div><div><span>Пост</span><b>{nextAppointment?.post || "—"}</b></div><div><span>Тривалість</span><b>{duration(nextAppointment?.plannedStartAt, nextAppointment?.plannedEndAt)}</b></div></div>
              <button type="button" className={styles.primaryButton} onClick={() => openTask(nextTask)}>▶ Відкрити роботу</button>
            </article> : <div className={styles.emptyCard}><strong>Активних робіт немає</strong><span>Нові призначення з’являться тут автоматично.</span></div>}
          </section>

          <section className={styles.todayWorks}>
            <div className={styles.sectionHeading}><div><h2>Мої роботи на сьогодні</h2></div><button type="button" onClick={() => setScreen("WORKS")}>Всі роботи ›</button></div>
            <div className={styles.workList}>{tasks.slice(0, 5).map((task) => <button type="button" key={task.id} onClick={() => openTask(task)}><time>{time(appointments.find((item) => item.plate === task.plate)?.plannedStartAt)}</time><div><strong>{task.vehicle}</strong><small>{task.description}</small></div><span className={`${styles.miniStatus} ${statusClass(task.status)}`}>{taskStatusLabel[task.status] || task.status}</span></button>)}</div>
            {!tasks.length && <div className={styles.emptyInline}>На сьогодні робіт немає.</div>}
          </section>
        </main>
      </>}

      {screen === "WORKS" && <>
        <TopBar title="Мої роботи" onBack={() => setScreen("HOME")} />
        <main className={styles.content}>
          <div className={styles.pageIntro}><h1>Призначені роботи</h1><p>Тільки ваші замовлення-наряди та операції.</p></div>
          <div className={styles.cardList}>{tasks.map((task) => <button type="button" key={task.id} className={styles.taskCard} onClick={() => openTask(task)}><div><strong>{task.vehicle}</strong><b>{task.plate || "Без номера"}</b></div><p>{task.description}</p><span className={`${styles.statusPill} ${statusClass(task.status)}`}>{taskStatusLabel[task.status] || task.status}</span></button>)}</div>
          {!tasks.length && <div className={styles.emptyCard}>Призначених робіт немає.</div>}
        </main>
      </>}

      {screen === "WORK_DETAIL" && selectedTask && <>
        <TopBar title={`Робота · ${selectedTask.plate || selectedTask.vehicle}`} onBack={() => setScreen("WORKS")} />
        <main className={styles.content}>
          <section className={styles.vehicleDetail}>
            <div className={styles.vehicleRow}><div className={styles.carBadge}>🚗</div><div><h1>{selectedTask.vehicle}</h1><p>{selectedTask.plate || "Без номера"}</p></div><span className={`${styles.statusPill} ${statusClass(selectedTask.status)}`}>{taskStatusLabel[selectedTask.status] || selectedTask.status}</span></div>
            <div className={styles.detailMeta}><div><span>Пост</span><b>{selectedAppointment?.post || "—"}</b></div><div><span>Початок</span><b>{time(selectedAppointment?.plannedStartAt)}</b></div><div><span>Тривалість</span><b>{duration(selectedAppointment?.plannedStartAt, selectedAppointment?.plannedEndAt)}</b></div></div>
          </section>

          <section className={styles.workOrderCard}>
            <div className={styles.sectionHeading}><div><h2>Роботи за нарядом</h2></div><span>{selectedOrderTasks.filter((item) => ["COMPLETED", "DONE"].includes(item.status)).length} з {selectedOrderTasks.length}</span></div>
            <div className={styles.progress}><i style={{ width: `${selectedOrderTasks.length ? Math.round(selectedOrderTasks.filter((item) => ["COMPLETED", "DONE"].includes(item.status)).length / selectedOrderTasks.length * 100) : 0}%` }} /></div>
            <div className={styles.orderLines}>{selectedOrderTasks.map((item) => <div key={item.id}><span className={statusClass(item.status)}>●</span><div><strong>{item.description}</strong><small>{item.laborHours ? `${item.laborHours} нормо-год` : item.type}</small></div><em>{taskStatusLabel[item.status] || item.status}</em></div>)}</div>
          </section>

          <div className={styles.actionStack}>
            <button type="button" className={styles.primaryButton} onClick={() => openProduction(selectedTask)}>▶ Почати / відкрити роботу</button>
            <button type="button" className={styles.secondaryButton} onClick={() => openProduction(selectedTask)}>◉ Оновити статус роботи</button>
            <button type="button" className={styles.secondaryButton} onClick={() => setScreen("DIAGNOSTICS")}>＋ Додати виявлену несправність</button>
          </div>
          <p className={styles.safeNote}>Статус і виявлені несправності зберігаються через чинні модулі «Виробництво» та «Діагностика», без дублювання даних.</p>
        </main>
      </>}

      {screen === "DIAGNOSTICS" && <>
        <TopBar title="Діагностика" onBack={() => setScreen("HOME")} />
        <main className={styles.content}>
          <div className={styles.pageIntro}><h1>Мої діагностики</h1><p>Черга авто, призначених саме на вас.</p></div>
          {queueLoading && <div className={styles.emptyCard}>Завантажую діагностики…</div>}
          {!queueLoading && <div className={styles.cardList}>{queue.map((item) => <button type="button" key={item.id} className={styles.diagnosticCard} onClick={() => navigateCrm("Діагностика", { diagnosticId: item.id })}><div><time>{time(item.plannedStartAt)}</time><strong>{item.vehicle.label}</strong><b>{item.vehicle.plateNumber || "Без номера"}</b></div><p>{item.problem || "Планова діагностика"}</p><small>{item.client.name || item.client.phone}{item.post ? ` · ${item.post}` : ""}</small><span className={`${styles.statusPill} ${statusClass(item.workflowState)}`}>{diagnosticStatusLabel[item.workflowState] || item.workflowState}</span></button>)}</div>}
          {!queueLoading && !queue.length && <div className={styles.emptyCard}>Призначених діагностик немає.</div>}
          <button type="button" className={styles.primaryButton} onClick={() => navigateCrm("Діагностика")}>Відкрити повну діагностику →</button>
        </main>
      </>}

      {screen === "SCHEDULE" && <>
        <TopBar title="Мій графік" onBack={() => setScreen("HOME")} />
        <main className={styles.content}>
          <div className={styles.pageIntro}><h1>Записи та роботи</h1><p>Ваше персональне завантаження за планувальником СТО.</p></div>
          <div className={styles.scheduleList}>{appointments.sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime()).map((item) => <article key={item.id}><div className={styles.scheduleDate}><b>{new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit" }).format(new Date(item.plannedStartAt))}</b><span>{new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", month: "short" }).format(new Date(item.plannedStartAt))}</span></div><div><strong>{item.vehicle}</strong><p>{item.plate || "Без номера"} · {item.problem || "Запис на СТО"}</p><small>{time(item.plannedStartAt)}–{time(item.plannedEndAt)}{item.post ? ` · ${item.post}` : ""}</small></div></article>)}</div>
          {!appointments.length && <div className={styles.emptyCard}>Запланованих робіт немає.</div>}
          <button type="button" className={styles.secondaryButton} onClick={() => navigateCrm("Планувальник")}>Відкрити планувальник →</button>
        </main>
      </>}

      {screen === "PAYROLL" && <>
        <TopBar title="Моя зарплата" onBack={() => setScreen("HOME")} />
        <main className={styles.content}>
          <section className={styles.salaryHero}><span>Прогноз за місяць</span><strong>{money(payroll?.projection?.total)}</strong><small>{payroll?.projection?.month || "Поточний місяць"}</small></section>
          <section className={styles.workOrderCard}><h2>Мої показники</h2><div className={styles.salaryStats}><div><span>Призначено</span><b>{data.kpis?.assigned ?? tasks.length}</b></div><div><span>В роботі</span><b>{inProgress}</b></div><div><span>Завершено сьогодні</span><b>{completed}</b></div><div><span>Очікує запчастини</span><b>{data.kpis?.waitingParts ?? 0}</b></div></div></section>
          <p className={styles.safeNote}>Фінанси СТО та чужі нарахування в кабінеті механіка не відображаються.</p>
        </main>
      </>}

      {error && <div className={styles.toast}><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}
      <BottomNav screen={screen} onChange={(next) => { setError(""); setScreen(next); }} onPayroll={() => void openPayroll()} />
    </div>
  </div>;
}
