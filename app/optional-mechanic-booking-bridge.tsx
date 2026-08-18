"use client";

import { useEffect } from "react";

const UNASSIGNED = "__UNASSIGNED__";

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function ensureUnassignedOption(select: HTMLSelectElement) {
  let option = [...select.options].find(item => item.value === UNASSIGNED);
  if (!option) {
    option = document.createElement("option");
    option.value = UNASSIGNED;
    option.textContent = "Призначити пізніше";
    select.insertBefore(option, select.options[1] || null);
  }
  if (!select.value) setNativeSelectValue(select, UNASSIGNED);
}

function enhanceStepFour() {
  const steps = [...document.querySelectorAll<HTMLElement>(".requestFastStep")];
  const step = steps.find(item => item.textContent?.includes("КРОК 4"));
  if (!step) return;

  const bookingGrid = step.querySelector<HTMLElement>(".bookingGrid");
  const hiddenMechanic = bookingGrid?.querySelectorAll<HTMLSelectElement>("select")[1];
  if (hiddenMechanic) {
    ensureUnassignedOption(hiddenMechanic);
    if (hiddenMechanic.dataset.optionalMechanicBound !== "true") {
      hiddenMechanic.dataset.optionalMechanicBound = "true";
      hiddenMechanic.addEventListener("change", () => {
        if (!hiddenMechanic.value) queueMicrotask(() => ensureUnassignedOption(hiddenMechanic));
      });
    }
  }

  for (const small of [...step.querySelectorAll<HTMLElement>("small")]) {
    if (small.textContent?.trim() === "Майстер *") small.textContent = "Майстер · необов’язково";
  }

  for (const select of [...step.querySelectorAll<HTMLSelectElement>("select")]) {
    const first = select.options[0];
    if (first?.textContent?.trim() === "Оберіть майстра") first.textContent = "Призначити пізніше";
  }
}

export function OptionalMechanicBookingBridge() {
  useEffect(() => {
    enhanceStepFour();
    const observer = new MutationObserver(enhanceStepFour);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
