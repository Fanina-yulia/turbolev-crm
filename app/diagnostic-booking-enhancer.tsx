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

type Snapshot = {
  date: string;
  time: string;
  postId: string;
  mechanicId: string;
  locationId: string;
  locations: Array<{ id: string; name: string }>;
};

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
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
  const locations = controls?.location
    ? [...controls.location.options].map((option) => ({ id: option.value, name: option.textContent?.trim() || option.value })).filter((item) => item.id)
    : [];
  return {
    date: controls?.date.value || todayKey(),
    time: controls?.time.value || "",
    postId: controls?.post.value || "",
    mechanicId: controls?.mechanic.value || "",
    locationId: controls?.location?.value || "",
    locations,
  };
}

function summary(step: HTMLElement) {
  const articles = [...step.querySelectorAll<HTMLElement>(".fastBookingSummary article")];
  return articles.slice(0, 4).map((article) => ({
    label: article.querySelector("small")?.textContent?.trim() || "",
    title: article.querySelector("strong")?.textContent?.trim() || "—",
    text: article.querySelector("span")?.textContent?.trim() || "",
  }));
}

export function DiagnosticBookingEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [step, setStep] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const resolve = () => {
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
  }, []);

  return host && step ? createPortal(<Scheduler step={step} host={host} />, host) : null;
}

function Scheduler({ step, host }: { step: HTMLElement; host: HTMLElement }) {
  const [state, setState] = useState<Snapshot>(() => snapshot(step));

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

  function select(selection: AvailabilitySelection) {
    const controls = readControls(step);
    if (!controls) return;
    setNativeValue(controls.time, selection.time);
    setNativeValue(controls.post, selection.postId);
    setNativeValue(controls.mechanic, selection.mechanicId);
    setState((current) => ({ ...current, time: selection.time, postId: selection.postId, mechanicId: selection.mechanicId }));
  }

  return <div className={styles.scheduler}>
    <div className={styles.headingRow}>
      <div><small>КРОК 4 · ЗАПИС</small><h3>Оберіть вільний пост і час</h3><p>CRM показує реальну зайнятість. Інтервал — 30 хвилин, тривалість діагностики — 60 хв.</p></div>
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
