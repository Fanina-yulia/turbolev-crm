"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AvailabilityPicker, type AvailabilitySelection } from "./availability-picker";
import styles from "./diagnostic-booking-enhancer.module.css";

type WizardControls = {
  date: HTMLInputElement;
  time: HTMLInputElement;
  post: HTMLSelectElement;
  mechanic: HTMLSelectElement;
  location: HTMLSelectElement | null;
};

type SelectOption = { id: string; name: string };
type Snapshot = {
  date: string;
  time: string;
  postId: string;
  mechanicId: string;
  locationId: string;
  locations: SelectOption[];
  posts: SelectOption[];
  mechanics: SelectOption[];
};

type PlannerBookingContext = {
  date: string;
  time: string;
  durationMinutes: number;
  locationId: string;
  postId: string;
};

type OpenRequestEventDetail = {
  appointmentDate?: string;
  appointmentTime?: string;
};

const CONTEXT_COOKIE = "turbolev_booking_context";
const DURATION_COOKIE = "turbolev_booking_duration_minutes";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readCookie(name: string) {
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function readPlannerContext(): PlannerBookingContext | null {
  const raw = readCookie(CONTEXT_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlannerBookingContext>;
    const durationMinutes = Number(parsed.durationMinutes);
    if (!parsed.date || !parsed.time || !Number.isFinite(durationMinutes) || durationMinutes < 30) return null;
    return {
      date: parsed.date,
      time: parsed.time,
      durationMinutes,
      locationId: parsed.locationId || "",
      postId: parsed.postId || "",
    };
  } catch {
    return null;
  }
}

function contextForOpenRequest(detail: OpenRequestEventDetail | null) {
  if (!detail?.appointmentDate || !detail.appointmentTime) return null;
  const context = readPlannerContext();
  if (!context) return null;
  return context.date === detail.appointmentDate && context.time === detail.appointmentTime ? context : null;
}

function clearPlannerContext() {
  document.cookie = `${CONTEXT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  document.cookie = `${DURATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  if (element.value === value) return;
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function options(select: HTMLSelectElement | null | undefined): SelectOption[] {
  if (!select) return [];
  return [...select.options]
    .map((option) => ({ id: option.value, name: option.textContent?.trim() || option.value }))
    .filter((item) => item.id);
}

function readControls(step: HTMLElement): WizardControls | null {
  const grid = step.querySelector<HTMLElement>(".bookingGrid");
  if (!grid) return null;
  const inputs = grid.querySelectorAll<HTMLInputElement>("input");
  const selects = grid.querySelectorAll<HTMLSelectElement>("select");
  if (inputs.length < 2 || selects.length < 2) return null;
  return {
    date: inputs[0],
    time: inputs[1],
    post: selects[0],
    mechanic: selects[1],
    location: step.querySelector<HTMLSelectElement>(".fastLocationSelect select"),
  };
}

function snapshot(step: HTMLElement): Snapshot {
  const controls = readControls(step);
  return {
    date: controls?.date.value || todayKey(),
    time: controls?.time.value || "",
    postId: controls?.post.value || "",
    mechanicId: controls?.mechanic.value || "",
    locationId: controls?.location?.value || "",
    locations: options(controls?.location),
    posts: options(controls?.post),
    mechanics: options(controls?.mechanic),
  };
}

function summary(step: HTMLElement) {
  const articles = [...step.querySelectorAll<HTMLElement>(".fastBookingSummary article")];
  return articles.slice(0, 4).map((article) => {
    const originalLabel = article.querySelector("small")?.textContent?.trim() || "";
    return {
      label: originalLabel === "Діагностика" ? "Звернення" : originalLabel,
      title: article.querySelector("strong")?.textContent?.trim() || "—",
      text: article.querySelector("span")?.textContent?.trim() || "",
    };
  });
}

function formatDate(day: string) {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = Math.max(0, hour * 60 + minute + minutes);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} год ${rest} хв` : `${hours} год`;
}

function normalizeWizardLanguage(context: PlannerBookingContext | null) {
  const modal = document.querySelector<HTMLElement>(".requestFastIntake");
  if (!modal) return;

  const head = modal.querySelector<HTMLElement>(".requestModalHead");
  const title = head?.querySelector<HTMLElement>("h2");
  const subtitle = head?.querySelector<HTMLElement>("span");
  if (title && title.textContent !== "Нова заявка") title.textContent = "Нова заявка";
  if (subtitle) {
    const next = context
      ? `${formatDate(context.date)} · ${context.time}–${addMinutes(context.time, context.durationMinutes)} · час обрано в Планувальнику`
      : "4 короткі кроки: авто → клієнт → роботи → запис";
    if (subtitle.textContent !== next) subtitle.textContent = next;
  }

  const stepLabels = [...modal.querySelectorAll<HTMLElement>(".requestStepper button span")];
  const labels = ["Автомобіль", "Клієнт", "Роботи", "Запис"];
  stepLabels.forEach((node, index) => {
    if (labels[index] && node.textContent !== labels[index]) node.textContent = labels[index];
  });

  const step3 = [...modal.querySelectorAll<HTMLElement>(".requestFastStep")]
    .find((item) => item.textContent?.includes("КРОК 3"));
  if (step3) {
    const heading = step3.querySelector<HTMLElement>(".requestStepTitle h3");
    const hint = step3.querySelector<HTMLElement>(".requestHint");
    const complaint = step3.querySelector<HTMLElement>(".fastComplaint > span");
    if (heading && heading.textContent !== "Що потрібно зробити?") heading.textContent = "Що потрібно зробити?";
    if (hint && hint.textContent !== "Додайте роботи або коротко опишіть потребу клієнта") hint.textContent = "Додайте роботи або коротко опишіть потребу клієнта";
    if (complaint && complaint.textContent !== "Роботи / побажання клієнта") complaint.textContent = "Роботи / побажання клієнта";
  }

  const submit = modal.querySelector<HTMLButtonElement>(".fastBookButton");
  if (submit?.textContent?.includes("Записати на діагностику")) submit.textContent = "Створити запис";

  modal.querySelectorAll<HTMLElement>(".fastBookingSummary article small").forEach((label) => {
    if (label.textContent?.trim() === "Діагностика") label.textContent = "Звернення";
  });

  const success = modal.querySelector<HTMLElement>(".requestMessage.success");
  if (success?.textContent?.includes("записано на діагностику")) {
    success.textContent = "Запис на СТО створено. Він уже в Планувальнику.";
  }
}

export function DiagnosticBookingEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [step, setStep] = useState<HTMLElement | null>(null);
  const [plannerContext, setPlannerContext] = useState<PlannerBookingContext | null>(null);

  useEffect(() => {
    const capture = (event: Event) => {
      const detail = (event as CustomEvent<OpenRequestEventDetail>).detail || null;
      setPlannerContext(contextForOpenRequest(detail));
    };
    window.addEventListener("turbolev:open-new-request", capture as EventListener);
    return () => window.removeEventListener("turbolev:open-new-request", capture as EventListener);
  }, []);

  useEffect(() => {
    const resolve = () => {
      normalizeWizardLanguage(plannerContext);
      const candidate = [...document.querySelectorAll<HTMLElement>(".requestFastStep")]
        .find((item) => item.textContent?.includes("КРОК 4")) || null;
      if (!candidate) {
        setHost(null);
        setStep(null);
        return;
      }
      candidate.classList.add("diagnosticSchedulerActive");
      let nextHost = candidate.querySelector<HTMLElement>("[data-diagnostic-scheduler-host]");
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.diagnosticSchedulerHost = "true";
        const marker = candidate.querySelector(".requestHiddenPricingField");
        candidate.insertBefore(nextHost, marker || null);
      }
      setStep(candidate);
      setHost(nextHost);
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll(".diagnosticSchedulerActive").forEach((node) => node.classList.remove("diagnosticSchedulerActive"));
    };
  }, [plannerContext]);

  return host && step ? createPortal(<Scheduler step={step} host={host} plannerContext={plannerContext} />, host) : null;
}

function Scheduler({ step, host, plannerContext }: { step: HTMLElement; host: HTMLElement; plannerContext: PlannerBookingContext | null }) {
  const [state, setState] = useState<Snapshot>(() => snapshot(step));
  const [editingSlot, setEditingSlot] = useState(false);

  useEffect(() => {
    const sync = () => setState(snapshot(step));
    sync();
    const observer = new MutationObserver((mutations) => {
      if (mutations.every((mutation) => host.contains(mutation.target))) return;
      sync();
    });
    observer.observe(step, { childList: true, subtree: true, attributes: true, attributeFilter: ["value"] });
    return () => observer.disconnect();
  }, [step, host]);

  const lockedContext = useMemo(() => {
    if (!plannerContext || editingSlot) return null;
    return plannerContext.date === state.date && plannerContext.time === state.time ? plannerContext : null;
  }, [plannerContext, editingSlot, state.date, state.time]);

  useEffect(() => {
    if (!plannerContext || editingSlot) return;
    let attempts = 0;
    const apply = () => {
      const controls = readControls(step);
      if (!controls) return;
      setNativeValue(controls.date, plannerContext.date);
      setNativeValue(controls.time, plannerContext.time);
      if (plannerContext.locationId && controls.location && [...controls.location.options].some((option) => option.value === plannerContext.locationId)) {
        setNativeValue(controls.location, plannerContext.locationId);
      }
      if (plannerContext.postId && [...controls.post.options].some((option) => option.value === plannerContext.postId)) {
        setNativeValue(controls.post, plannerContext.postId);
      }
      setState(snapshot(step));
    };
    apply();
    const timer = window.setInterval(() => {
      attempts += 1;
      apply();
      if (attempts >= 12) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [plannerContext, editingSlot, step]);

  const details = useMemo(() => summary(step), [step, state.date, state.time, state.postId, state.mechanicId]);

  function changeDate(value: string) {
    const controls = readControls(step);
    if (!controls) return;
    setNativeValue(controls.date, value);
    setNativeValue(controls.time, "");
    setNativeValue(controls.post, "");
    setNativeValue(controls.mechanic, "");
    setState((current) => ({ ...current, date: value, time: "", postId: "", mechanicId: "" }));
  }

  function changeLocation(value: string) {
    const controls = readControls(step);
    if (!controls?.location) return;
    setNativeValue(controls.location, value);
    setState((current) => ({ ...current, locationId: value, time: "", postId: "", mechanicId: "" }));
    window.setTimeout(() => setState(snapshot(step)), 0);
  }

  function changeMechanic(value: string) {
    const controls = readControls(step);
    if (!controls) return;
    setNativeValue(controls.mechanic, value);
    setState((current) => ({ ...current, mechanicId: value }));
  }

  function changePost(value: string) {
    const controls = readControls(step);
    if (!controls) return;
    setNativeValue(controls.post, value);
    setState((current) => ({ ...current, postId: value }));
  }

  function select(selection: AvailabilitySelection) {
    const controls = readControls(step);
    if (!controls) return;
    setNativeValue(controls.time, selection.time);
    setNativeValue(controls.post, selection.postId);
    setNativeValue(controls.mechanic, selection.mechanicId);
    setState((current) => ({ ...current, time: selection.time, postId: selection.postId, mechanicId: selection.mechanicId }));
  }

  function editSlot() {
    clearPlannerContext();
    setEditingSlot(true);
  }

  if (lockedContext) {
    const locationName = state.locations.find((item) => item.id === (lockedContext.locationId || state.locationId))?.name || "СТО";
    const postName = state.posts.find((item) => item.id === (lockedContext.postId || state.postId))?.name || (lockedContext.postId ? "Обраний пост" : "Без поста");
    const end = addMinutes(lockedContext.time, lockedContext.durationMinutes);
    const needsPost = !lockedContext.postId;

    return <div className={styles.scheduler}>
      <div className={styles.headingRow}>
        <div><small>КРОК 4 · ПІДТВЕРДЖЕННЯ</small><h3>Запис на СТО</h3><p>Дата, час і пост уже вибрані у Планувальнику. Залишилось призначити майстра та підтвердити запис.</p></div>
        <button className={styles.editSlot} type="button" onClick={editSlot}>Змінити час / пост</button>
      </div>

      <div className={styles.lockedSlot}>
        <article><small>Дата</small><strong>{formatDate(lockedContext.date)}</strong><span>{locationName}</span></article>
        <article><small>Час</small><strong>{lockedContext.time}–{end}</strong><span>{durationLabel(lockedContext.durationMinutes)}</span></article>
        <article><small>Пост</small><strong>{postName}</strong><span>{needsPost ? "Потрібно призначити робочий пост" : "Зафіксовано в Планувальнику"}</span></article>
      </div>

      <div className={styles.assignment}>
        {needsPost && <label><span>Пост *</span><select value={state.postId} onChange={(event) => changePost(event.target.value)}><option value="">Оберіть пост</option>{state.posts.map((post) => <option key={post.id} value={post.id}>{post.name}</option>)}</select></label>}
        <label><span>Майстер *</span><select value={state.mechanicId} onChange={(event) => changeMechanic(event.target.value)}><option value="">Оберіть майстра</option>{state.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select></label>
        <div className={styles.lockNotice}><b>✓ Час зарезервовано</b><span>При збереженні CRM ще раз перевірить конфлікти по посту та майстру.</span></div>
      </div>

      {details.length > 0 && <div className={styles.summary}>{details.map((item, index) => <article key={`${item.label}-${index}`}><small>{item.label}</small><strong>{item.title}</strong><span>{item.text}</span></article>)}</div>}
    </div>;
  }

  return <div className={styles.scheduler}>
    <div className={styles.headingRow}>
      <div><small>КРОК 4 · ЗАПИС</small><h3>Оберіть вільний пост і час</h3><p>CRM показує реальну зайнятість. Інтервал — 30 хвилин, базова тривалість нового запису — 60 хв.</p></div>
      <div className={styles.rules}><b>Правила запису</b><span>тільки робочі години</span><span>без накладення по посту</span><span>до 2 авто на майстра</span></div>
    </div>

    <div className={styles.controls}>
      <label><span>Дата</span><input type="date" min={todayKey()} value={state.date} onChange={(event) => changeDate(event.target.value)} /></label>
      {state.locations.length > 1 && <label><span>Локація</span><select value={state.locationId} onChange={(event) => changeLocation(event.target.value)}>{state.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
      <div className={styles.duration}><span>Тривалість</span><b>60 хв</b></div>
    </div>

    <AvailabilityPicker
      date={state.date}
      locationId={state.locationId}
      durationMinutes={60}
      selectedTime={state.time}
      selectedPostId={state.postId}
      selectedMechanicId={state.mechanicId}
      onChange={select}
    />

    {details.length > 0 && <div className={styles.summary}>{details.map((item, index) => <article key={`${item.label}-${index}`}><small>{item.label}</small><strong>{item.title}</strong><span>{item.text}</span></article>)}</div>}
  </div>;
}
