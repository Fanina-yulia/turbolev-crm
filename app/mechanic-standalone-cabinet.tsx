"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./mechanic-standalone-cabinet.module.css";

type MechanicTask = {
  id: string;
  workOrderId: string;
  description: string;
  status: string;
  lineStatus?: string;
  type: string;
  laborHours: string | null;
  plate: string;
  vehicle: string;
  workOrderStatus: string;
  startedAt?: string | null;
  completedAt?: string | null;
  pausedAt?: string | null;
  findingCount?: number;
  openFindingCount?: number;
};

type Appointment = {
  id: string;
  status: string;
  plannedStartAt: string;
  plannedEndAt: string;
  plate: string;
  vehicle: string;
  problem: string | null;
  post: string | null;
};

type HomePayload = {
  ok: boolean;
  cabinet?: "MECHANIC";
  linked?: boolean;
  reason?: string;
  mechanic?: { id: string; name: string; station: { id: string; name: string } };
  kpis?: { assigned: number; inProgress: number; completedToday: number; waitingParts: number };
  tasks?: MechanicTask[];
  appointments?: Appointment[];
  message?: string;
  error?: string;
};

type TaskFeed = {
  ok: boolean;
  linked: boolean;
  items?: MechanicTask[];
  kpis?: { assigned: number; inProgress: number; paused: number; completedToday: number };
  message?: string;
  error?: string;
};

type DiagnosticItem = {
  id: string;
  status: string;
  workflowState: string;
  reviewState: string;
  plannedStartAt: string;
  plannedEndAt: string;
  post: string | null;
  problem: string | null;
  vehicle: { label: string; plateNumber: string | null };
};

type Clarification = {
  id: string;
  findingText: string;
  recommendation: string | null;
  managerComment: string | null;
  workDescription: string;
  plate: string;
  vehicle: string;
  reviewedAt: string | null;
};

type Payroll = { ok: boolean; projection?: { total?: number | string; month?: string } };
type Screen = "HOME" | "WORKS" | "WORK_DETAIL" | "FINDING" | "DIAGNOSTICS" | "NOTIFICATIONS" | "PROFILE" | "SCHEDULE" | "PAYROLL" | "SUPPORT";
type WorkAction = "START" | "PAUSE" | "RESUME" | "COMPLETE";
type ThemeChoice = "system" | "light" | "dark";
type SupportKind = "QUESTION" | "PART_REQUEST";
type FindingUrgency = "INFO" | "SOON" | "CRITICAL";

const statusLabel: Record<string, string> = {
  DRAFT: "Очікує погодження",
  APPROVED: "Готово до роботи",
  PENDING: "Заплановано",
  READY: "Готово до роботи",
  IN_PROGRESS: "В роботі",
  PAUSED: "Пауза",
  COMPLETED: "Завершено",
  DONE: "Завершено",
  WAITING_PARTS: "Очікує запчастини",
  WAITING_APPROVAL: "Очікує погодження",
  CANCELLED: "Скасовано",
  SUBMITTED: "Передано менеджеру",
  RETURNED: "Повернено на уточнення",
  CONFIRMED: "Підтверджено",
};

function time(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function duration(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  if (minutes < 60) return `${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} год ${rest} хв` : `${hours} год`;
}

function firstName(value?: string | null) {
  return value?.trim().split(/\s+/)[0] || "майстре";
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 12) return "Доброго ранку";
  if (hour < 18) return "Добрий день";
  return "Добрий вечір";
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(number) : "—";
}

function isDone(status: string) {
  return status === "COMPLETED" || status === "DONE";
}

function statusTone(status: string) {
  if (isDone(status) || status === "CONFIRMED") return styles.good;
  if (status === "IN_PROGRESS") return styles.info;
  if (["PAUSED", "WAITING_PARTS", "WAITING_APPROVAL", "RETURNED"].includes(status)) return styles.warn;
  if (status === "CANCELLED") return styles.mutedPill;
  return styles.accentPill;
}

function BottomNav({ screen, onChange }: { screen: Screen; onChange: (screen: Screen) => void }) {
  const workActive = ["WORKS", "WORK_DETAIL", "FINDING", "SUPPORT"].includes(screen);
  const profileActive = ["PROFILE", "SCHEDULE", "PAYROLL"].includes(screen);
  return <nav className={styles.bottomNav} aria-label="Навігація механіка">
    <button type="button" className={screen === "HOME" ? styles.navActive : ""} onClick={() => onChange("HOME")}><span>⌂</span><b>Головна</b></button>
    <button type="button" className={workActive ? styles.navActive : ""} onClick={() => onChange("WORKS")}><span>▤</span><b>Роботи</b></button>
    <button type="button" className={screen === "DIAGNOSTICS" ? styles.navActive : ""} onClick={() => onChange("DIAGNOSTICS")}><span>◇</span><b>Діагностика</b></button>
    <button type="button" className={screen === "NOTIFICATIONS" ? styles.navActive : ""} onClick={() => onChange("NOTIFICATIONS")}><span>◉</span><b>Сповіщення</b></button>
    <button type="button" className={profileActive ? styles.navActive : ""} onClick={() => onChange("PROFILE")}><span>●</span><b>Профіль</b></button>
  </nav>;
}

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return <header className={styles.topBar}>
    <button type="button" onClick={onBack} aria-label="Назад">‹</button>
    <strong>{title}</strong>
    <span />
  </header>;
}

export function MechanicStandaloneCabinet({ userName }: { userName?: string | null }) {
  const [home, setHome] = useState<HomePayload | null>(null);
  const [tasks, setTasks] = useState<MechanicTask[]>([]);
  const [taskKpis, setTaskKpis] = useState<TaskFeed["kpis"] | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [screen, setScreen] = useState<Screen>("HOME");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("system");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [findingText, setFindingText] = useState("");
  const [findingRecommendation, setFindingRecommendation] = useState("");
  const [findingUrgency, setFindingUrgency] = useState<FindingUrgency>("INFO");
  const [findingFiles, setFindingFiles] = useState<File[]>([]);
  const [supportKind, setSupportKind] = useState<SupportKind>("QUESTION");
  const [supportText, setSupportText] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [payroll, setPayroll] = useState<Payroll | null>(null);

  const loadHome = useCallback(async () => {
    const response = await fetch("/api/cabinet/home", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as HomePayload | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкрити кабінет механіка");
    setHome(body);
    if (body.tasks) setTasks(body.tasks);
  }, []);

  const loadTasks = useCallback(async () => {
    const response = await fetch("/api/cabinet/mechanic/tasks", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as TaskFeed | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити роботи");
    if (body.linked) {
      setTasks(body.items ?? []);
      setTaskKpis(body.kpis ?? null);
    }
  }, []);

  const loadDiagnostics = useCallback(async () => {
    const response = await fetch("/api/diagnostics/me", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok) setDiagnostics(body.items ?? []);
  }, []);

  const loadNotifications = useCallback(async () => {
    const response = await fetch("/api/cabinet/mechanic/findings", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok) setClarifications(body.items ?? []);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("turbolev:mechanic-theme");
    if (stored === "light" || stored === "dark" || stored === "system") setThemeChoice(stored);
    void Promise.all([loadHome(), loadTasks(), loadDiagnostics(), loadNotifications()]).catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося завантажити кабінет"));
  }, [loadDiagnostics, loadHome, loadNotifications, loadTasks]);

  const appointments = home?.appointments ?? [];
  const selectedTask = tasks.find((item) => item.id === selectedTaskId) ?? null;
  const selectedOrderTasks = selectedTask ? tasks.filter((item) => item.workOrderId === selectedTask.workOrderId) : [];
  const selectedAppointment = selectedTask ? appointments.find((item) => item.plate === selectedTask.plate || item.vehicle === selectedTask.vehicle) ?? null : null;
  const activeTask = tasks.find((item) => item.status === "IN_PROGRESS" || item.status === "PAUSED") ?? tasks.find((item) => !isDone(item.status) && item.status !== "CANCELLED") ?? null;
  const currentPost = activeTask ? appointments.find((item) => item.plate === activeTask.plate)?.post : appointments.find((item) => item.post)?.post;
  const planned = tasks.filter((item) => ["DRAFT", "APPROVED", "PENDING", "READY"].includes(item.status)).length;
  const inProgress = (taskKpis?.inProgress ?? tasks.filter((item) => item.status === "IN_PROGRESS").length) + (taskKpis?.paused ?? tasks.filter((item) => item.status === "PAUSED").length);
  const completed = taskKpis?.completedToday ?? tasks.filter((item) => isDone(item.status)).length;
  const notificationCount = clarifications.length + (home?.kpis?.waitingParts ?? 0);
  const mechanicName = userName || home?.mechanic?.name || "Автомеханік";

  const todayLabel = useMemo(() => new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long" }).format(new Date()), []);

  function changeTheme(next: ThemeChoice) {
    setThemeChoice(next);
    window.localStorage.setItem("turbolev:mechanic-theme", next);
  }

  function openTask(task: MechanicTask) {
    setSelectedTaskId(task.id);
    setScreen("WORK_DETAIL");
    setError("");
    setMessage("");
  }

  async function runAction(action: WorkAction) {
    if (!selectedTask) return;
    if (action === "COMPLETE" && !window.confirm("Завершити цю роботу?")) return;
    setBusy(action); setError("");
    try {
      const response = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(selectedTask.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити роботу");
      await Promise.all([loadTasks(), loadHome()]);
      setMessage(action === "START" ? "Роботу розпочато." : action === "PAUSE" ? "Роботу поставлено на паузу." : action === "RESUME" ? "Роботу продовжено." : "Роботу завершено.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося оновити роботу"); }
    finally { setBusy(""); }
  }

  async function submitFinding() {
    if (!selectedTask) return;
    if (findingText.trim().length < 3 || !findingFiles.length) { setError("Опишіть несправність і додайте хоча б одне фото."); return; }
    setBusy("finding"); setError("");
    try {
      const form = new FormData();
      form.append("lineId", selectedTask.id);
      form.append("findingText", findingText.trim());
      form.append("recommendation", findingRecommendation.trim());
      form.append("urgency", findingUrgency);
      findingFiles.forEach((file) => form.append("photos", file));
      const response = await fetch("/api/cabinet/mechanic/findings", { method: "POST", credentials: "include", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати несправність");
      setFindingText(""); setFindingRecommendation(""); setFindingFiles([]); setFindingUrgency("INFO");
      await Promise.all([loadTasks(), loadNotifications()]);
      setScreen("WORK_DETAIL"); setMessage(body.message || "Несправність передано сервіс-менеджеру.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося передати несправність"); }
    finally { setBusy(""); }
  }

  async function submitSupport() {
    if (!selectedTask || supportText.trim().length < 3) { setError("Опишіть запит."); return; }
    setBusy("support"); setError("");
    try {
      const response = await fetch("/api/cabinet/mechanic/support", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: selectedTask.id, kind: supportKind, text: supportText.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати запит");
      setSupportText(""); setScreen("WORK_DETAIL"); setMessage(body.message || "Запит передано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося передати запит"); }
    finally { setBusy(""); }
  }

  async function replyClarification(item: Clarification) {
    const reply = (replyDrafts[item.id] || "").trim();
    if (reply.length < 3) return;
    setBusy(`reply:${item.id}`); setError("");
    try {
      const response = await fetch("/api/cabinet/mechanic/findings", {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: item.id, reply }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати відповідь");
      setReplyDrafts((current) => ({ ...current, [item.id]: "" }));
      await loadNotifications(); setMessage(body.message || "Відповідь передано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося передати відповідь"); }
    finally { setBusy(""); }
  }

  async function openPayroll() {
    setScreen("PAYROLL"); setError("");
    try {
      const response = await fetch("/api/me/compensation", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити зарплату");
      setPayroll(body as Payroll);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося завантажити зарплату"); }
  }

  if (!home) return <div className={styles.loading} data-theme-choice={themeChoice}><strong>ТУРБО <b>ЛЕВ</b></strong><span>Завантажую кабінет механіка…</span></div>;
  if (!home.linked || !home.mechanic) return <div className={styles.loading} data-theme-choice={themeChoice}><strong>Кабінет механіка не прив’язаний</strong><span>Призначте працівнику станцію та роль «Автомеханік».</span></div>;

  return <div className={styles.app} data-theme-choice={themeChoice} data-mechanic-cabinet="true">
    <div className={styles.shell}>
      {screen === "HOME" && <>
        <header className={styles.hero}>
          <div><div className={styles.brand}><span>ТУРБО</span> <b>ЛЕВ</b></div><small>Кабінет механіка</small></div>
          <button type="button" className={styles.iconButton} onClick={() => setScreen("NOTIFICATIONS")} aria-label="Сповіщення">◉{notificationCount > 0 && <em>{notificationCount}</em>}</button>
        </header>
        <main className={styles.content}>
          <section className={styles.profileCard}><div className={styles.avatar}>{firstName(mechanicName).slice(0, 1).toUpperCase()}</div><div><h1>{greeting()}, {firstName(mechanicName)}!</h1><p>{currentPost || "Пост не призначено"}</p><span>{home.mechanic.station.name}</span></div></section>
          <section className={styles.card}><div className={styles.sectionHead}><div><h2>Сьогодні, {todayLabel}</h2><p>Ваш персональний план робіт</p></div></div><div className={styles.metrics}><div><b>{planned}</b><span>Заплановано</span></div><div><b>{inProgress}</b><span>В роботі</span></div><div><b>{completed}</b><span>Завершено</span></div><div><b>{home.kpis?.waitingParts ?? 0}</b><span>Очікує деталей</span></div></div></section>
          <section><div className={styles.sectionHead}><div><h2>{activeTask?.status === "IN_PROGRESS" ? "Поточна робота" : activeTask?.status === "PAUSED" ? "Робота на паузі" : "Наступна робота"}</h2><p>Найближче завдання</p></div></div>{activeTask ? <article className={styles.taskHero}><div className={styles.taskTop}><div className={styles.carIcon}>🚗</div><div><h3>{activeTask.vehicle}</h3><p>{activeTask.plate}</p></div><span className={`${styles.pill} ${statusTone(activeTask.status)}`}>{statusLabel[activeTask.status] || activeTask.status}</span></div><strong>🔧 {activeTask.description}</strong><div className={styles.meta}><span>Пост <b>{appointments.find((item) => item.plate === activeTask.plate)?.post || "—"}</b></span><span>Час <b>{time(appointments.find((item) => item.plate === activeTask.plate)?.plannedStartAt)}</b></span></div><button type="button" className={styles.primary} onClick={() => openTask(activeTask)}>Відкрити роботу →</button></article> : <div className={styles.empty}>Активних робіт немає.</div>}</section>
          <section className={styles.card}><div className={styles.sectionHead}><div><h2>Мої роботи</h2><p>Сьогодні та активні</p></div><button type="button" className={styles.textButton} onClick={() => setScreen("WORKS")}>Всі ›</button></div><div className={styles.compactList}>{tasks.slice(0, 4).map((task) => <button type="button" key={task.id} onClick={() => openTask(task)}><div><strong>{task.vehicle}</strong><small>{task.description}</small></div><span className={`${styles.pill} ${statusTone(task.status)}`}>{statusLabel[task.status] || task.status}</span></button>)}</div>{!tasks.length && <div className={styles.emptyInline}>Робіт немає.</div>}</section>
        </main>
      </>}

      {screen === "WORKS" && <><TopBar title="Мої роботи" onBack={() => setScreen("HOME")} /><main className={styles.content}><div className={styles.pageTitle}><h1>Призначені роботи</h1><p>Тільки ваші замовлення-наряди та операції.</p></div><div className={styles.stack}>{tasks.map((task) => <button type="button" className={styles.listCard} key={task.id} onClick={() => openTask(task)}><div><h3>{task.vehicle}</h3><b>{task.plate}</b></div><p>{task.description}</p><span className={`${styles.pill} ${statusTone(task.status)}`}>{statusLabel[task.status] || task.status}</span></button>)}</div>{!tasks.length && <div className={styles.empty}>Призначених робіт немає.</div>}</main></>}

      {screen === "WORK_DETAIL" && selectedTask && <><TopBar title="Робота" onBack={() => setScreen("WORKS")} /><main className={styles.content}><section className={styles.card}><div className={styles.taskTop}><div className={styles.carIcon}>🚗</div><div><h2>{selectedTask.vehicle}</h2><p>{selectedTask.plate}</p></div><span className={`${styles.pill} ${statusTone(selectedTask.status)}`}>{statusLabel[selectedTask.status] || selectedTask.status}</span></div><div className={styles.metaGrid}><span>Пост<b>{selectedAppointment?.post || "—"}</b></span><span>Початок<b>{time(selectedTask.startedAt || selectedAppointment?.plannedStartAt)}</b></span><span>Тривалість<b>{duration(selectedAppointment?.plannedStartAt, selectedAppointment?.plannedEndAt)}</b></span></div></section><section className={styles.card}><div className={styles.sectionHead}><div><h2>Роботи за нарядом</h2><p>{selectedOrderTasks.filter((item) => isDone(item.status)).length} з {selectedOrderTasks.length} виконано</p></div></div><div className={styles.orderLines}>{selectedOrderTasks.map((item) => <div key={item.id}><i className={statusTone(item.status)}>●</i><div><strong>{item.description}</strong><small>{item.laborHours ? `${item.laborHours} нормо-год` : item.type}</small></div><span>{statusLabel[item.status] || item.status}</span></div>)}</div></section><section className={styles.card}><div className={styles.sectionHead}><div><h2>Керування роботою</h2><p>Фіксується в історії замовлення</p></div></div>{selectedTask.status === "APPROVED" && <button className={styles.primary} disabled={Boolean(busy)} onClick={() => void runAction("START")}>▶ Почати роботу</button>}{selectedTask.status === "IN_PROGRESS" && <div className={styles.twoButtons}><button className={styles.secondary} disabled={Boolean(busy)} onClick={() => void runAction("PAUSE")}>Ⅱ Пауза</button><button className={styles.successButton} disabled={Boolean(busy)} onClick={() => void runAction("COMPLETE")}>✓ Завершити</button></div>}{selectedTask.status === "PAUSED" && <div className={styles.twoButtons}><button className={styles.primary} disabled={Boolean(busy)} onClick={() => void runAction("RESUME")}>▶ Продовжити</button><button className={styles.successButton} disabled={Boolean(busy)} onClick={() => void runAction("COMPLETE")}>✓ Завершити</button></div>}{isDone(selectedTask.status) && <div className={styles.doneBox}>✓ Роботу завершено</div>}<div className={styles.actionList}><button type="button" onClick={() => setScreen("FINDING")}>📷 Додати фото / виявлений дефект <span>›</span></button><button type="button" onClick={() => { setSupportKind("PART_REQUEST"); setSupportText(""); setScreen("SUPPORT"); }}>⚙ Запросити запчастину <span>›</span></button><button type="button" onClick={() => { setSupportKind("QUESTION"); setSupportText(""); setScreen("SUPPORT"); }}>💬 Поставити питання менеджеру <span>›</span></button></div></section></main></>}

      {screen === "FINDING" && selectedTask && <><TopBar title="Виявлений дефект" onBack={() => setScreen("WORK_DETAIL")} /><main className={styles.content}><section className={styles.card}><h2>{selectedTask.vehicle} · {selectedTask.plate}</h2><p className={styles.subtle}>🔧 {selectedTask.description}</p></section><section className={styles.formCard}><label><span>Що виявлено *</span><textarea value={findingText} onChange={(event) => setFindingText(event.target.value)} rows={4} placeholder="Опишіть дефект або несправність" /></label><label><span>Рекомендація</span><textarea value={findingRecommendation} onChange={(event) => setFindingRecommendation(event.target.value)} rows={3} placeholder="Що рекомендуєте зробити" /></label><div><span className={styles.label}>Терміновість</span><div className={styles.segmented}>{(["INFO", "SOON", "CRITICAL"] as FindingUrgency[]).map((value) => <button type="button" key={value} className={findingUrgency === value ? styles.segmentActive : ""} onClick={() => setFindingUrgency(value)}>{value === "INFO" ? "Рекомендація" : value === "SOON" ? "Скоро" : "Критично"}</button>)}</div></div><label className={styles.photoButton}>📷 Додати фото (1–3)<input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type)); setFindingFiles((current) => [...current, ...files].slice(0, 3)); event.currentTarget.value = ""; }} /></label>{findingFiles.length > 0 && <div className={styles.fileList}>{findingFiles.map((file, index) => <div key={`${file.name}-${index}`}><span>{file.name || `Фото ${index + 1}`}</span><button type="button" onClick={() => setFindingFiles((current) => current.filter((_, i) => i !== index))}>×</button></div>)}</div>}<button type="button" className={styles.primary} disabled={busy === "finding"} onClick={() => void submitFinding()}>{busy === "finding" ? "Передаю…" : "Передати сервіс-менеджеру →"}</button></section></main></>}

      {screen === "SUPPORT" && selectedTask && <><TopBar title={supportKind === "PART_REQUEST" ? "Запит на запчастину" : "Питання менеджеру"} onBack={() => setScreen("WORK_DETAIL")} /><main className={styles.content}><section className={styles.card}><h2>{selectedTask.vehicle} · {selectedTask.plate}</h2><p className={styles.subtle}>{selectedTask.description}</p></section><section className={styles.formCard}><label><span>{supportKind === "PART_REQUEST" ? "Яка запчастина потрібна?" : "Ваше питання"}</span><textarea rows={5} value={supportText} onChange={(event) => setSupportText(event.target.value)} placeholder={supportKind === "PART_REQUEST" ? "Назва, сторона, кількість, уточнення…" : "Опишіть, що потрібно уточнити…"} /></label><button type="button" className={styles.primary} disabled={busy === "support"} onClick={() => void submitSupport()}>{busy === "support" ? "Передаю…" : "Передати сервіс-менеджеру →"}</button></section></main></>}

      {screen === "DIAGNOSTICS" && <><TopBar title="Діагностика" onBack={() => setScreen("HOME")} /><main className={styles.content}><div className={styles.pageTitle}><h1>Мої діагностики</h1><p>Лише автомобілі, призначені вам.</p></div><div className={styles.stack}>{diagnostics.map((item) => <article className={styles.listCard} key={item.id}><div><h3>{item.vehicle.label}</h3><b>{item.vehicle.plateNumber || "Без номера"}</b></div><p>{item.problem || "Планова діагностика"}</p><div className={styles.meta}><span>Час <b>{time(item.plannedStartAt)}</b></span><span>Пост <b>{item.post || "—"}</b></span></div><span className={`${styles.pill} ${statusTone(item.workflowState)}`}>{statusLabel[item.workflowState] || item.workflowState}</span></article>)}</div>{!diagnostics.length && <div className={styles.empty}>Призначених діагностик немає.</div>}</main></>}

      {screen === "NOTIFICATIONS" && <><TopBar title="Сповіщення" onBack={() => setScreen("HOME")} /><main className={styles.content}><div className={styles.pageTitle}><h1>Потребує вашої уваги</h1><p>Уточнення сервіс-менеджера та робочі повідомлення.</p></div>{clarifications.map((item) => <section className={styles.noticeCard} key={item.id}><div><strong>{item.vehicle} · {item.plate}</strong><span>{item.workDescription}</span></div><p>{item.managerComment || "Сервіс-менеджер просить уточнення."}</p><blockquote>{item.findingText}</blockquote><textarea rows={3} value={replyDrafts[item.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Відповідь сервіс-менеджеру…" /><button type="button" className={styles.primary} disabled={busy === `reply:${item.id}`} onClick={() => void replyClarification(item)}>Відповісти →</button></section>)}{!clarifications.length && <div className={styles.empty}>Нових запитів немає.</div>}</main></>}

      {screen === "PROFILE" && <><TopBar title="Профіль" onBack={() => setScreen("HOME")} /><main className={styles.content}><section className={styles.profileLarge}><div className={styles.avatar}>{firstName(mechanicName).slice(0, 1).toUpperCase()}</div><div><h1>{mechanicName}</h1><p>Автомеханік</p><span>{home.mechanic.station.name} · {currentPost || "пост не призначено"}</span></div></section><section className={styles.card}><div className={styles.sectionHead}><div><h2>Оформлення</h2><p>Тема цього мобільного кабінету</p></div></div><div className={styles.themePicker}><button type="button" className={themeChoice === "system" ? styles.themeActive : ""} onClick={() => changeTheme("system")}>Як у системі</button><button type="button" className={themeChoice === "light" ? styles.themeActive : ""} onClick={() => changeTheme("light")}>Світла</button><button type="button" className={themeChoice === "dark" ? styles.themeActive : ""} onClick={() => changeTheme("dark")}>Темна</button></div></section><section className={styles.card}><div className={styles.actionList}><button type="button" onClick={() => setScreen("SCHEDULE")}>▣ Мій графік <span>›</span></button><button type="button" onClick={() => void openPayroll()}>₴ Моя зарплата <span>›</span></button></div></section></main></>}

      {screen === "SCHEDULE" && <><TopBar title="Мій графік" onBack={() => setScreen("PROFILE")} /><main className={styles.content}><div className={styles.stack}>{appointments.map((item) => <article className={styles.scheduleCard} key={item.id}><time>{time(item.plannedStartAt)}–{time(item.plannedEndAt)}</time><div><strong>{item.vehicle}</strong><p>{item.plate} · {item.problem || "Запис на СТО"}</p><small>{item.post || "Пост не призначено"}</small></div></article>)}</div>{!appointments.length && <div className={styles.empty}>Запланованих робіт немає.</div>}</main></>}

      {screen === "PAYROLL" && <><TopBar title="Моя зарплата" onBack={() => setScreen("PROFILE")} /><main className={styles.content}><section className={styles.payHero}><span>Прогноз за місяць</span><strong>{money(payroll?.projection?.total)}</strong><small>{payroll?.projection?.month || "Поточний місяць"}</small></section><section className={styles.card}><div className={styles.metrics}><div><b>{taskKpis?.assigned ?? tasks.length}</b><span>Призначено</span></div><div><b>{inProgress}</b><span>В роботі</span></div><div><b>{completed}</b><span>Завершено</span></div><div><b>{home.kpis?.waitingParts ?? 0}</b><span>Очікує деталей</span></div></div></section></main></>}

      {message && <div className={styles.toastGood}><span>{message}</span><button type="button" onClick={() => setMessage("")}>×</button></div>}
      {error && <div className={styles.toastBad}><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}
      <BottomNav screen={screen} onChange={(next) => { setScreen(next); setError(""); setMessage(""); }} />
    </div>
  </div>;
}
