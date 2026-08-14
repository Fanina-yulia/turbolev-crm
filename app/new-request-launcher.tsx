"use client";

import { useEffect, useRef } from "react";
import { NewRequestWizardV3 } from "./new-request-wizard-v3";

type OpenRequestDetail = { appointmentDate?: string; appointmentTime?: string; source?: string };
const PREFILL_KEY = "turbolev-new-request-prefill";

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value); else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function NewRequestLauncher() {
  const host = useRef<HTMLDivElement>(null);
  const wasModalOpen = useRef(false);

  useEffect(() => {
    const applyPrefill = () => {
      const modal = document.querySelector(".requestModal");
      if (!modal) {
        if (wasModalOpen.current) window.sessionStorage.removeItem(PREFILL_KEY);
        wasModalOpen.current = false;
        return;
      }
      wasModalOpen.current = true;

      let detail: OpenRequestDetail | null = null;
      try { detail = JSON.parse(window.sessionStorage.getItem(PREFILL_KEY) || "null") as OpenRequestDetail | null; } catch { detail = null; }
      if (!detail) return;

      const date = modal.querySelector('input[type="date"]') as HTMLInputElement | null;
      const time = modal.querySelector('input[type="time"]') as HTMLInputElement | null;
      if (date && detail.appointmentDate && date.value !== detail.appointmentDate) setNativeInputValue(date, detail.appointmentDate);
      if (time && detail.appointmentTime && time.value !== detail.appointmentTime) setNativeInputValue(time, detail.appointmentTime);
      if (date && (!detail.appointmentTime || time)) window.sessionStorage.removeItem(PREFILL_KEY);
    };

    const openRequest = (event: Event) => {
      const detail = (event as CustomEvent<OpenRequestDetail>).detail || {};
      window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify(detail));
      const button = host.current?.querySelector("button.primary") as HTMLButtonElement | null;
      button?.click();
      window.setTimeout(applyPrefill, 60);
    };

    const timer = window.setInterval(applyPrefill, 250);
    window.addEventListener("turbolev:open-new-request", openRequest as EventListener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("turbolev:open-new-request", openRequest as EventListener);
      window.sessionStorage.removeItem(PREFILL_KEY);
    };
  }, []);

  return <div ref={host}><NewRequestWizardV3 /></div>;
}
