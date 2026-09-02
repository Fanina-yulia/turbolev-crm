"use client";

import { useEffect } from "react";

function enforceMechanicRequired(select: HTMLSelectElement) {
  select.querySelector('option[value="__UNASSIGNED__"]')?.remove();
  const first = select.options[0];
  if (first?.value === "") first.textContent = "Оберіть механіка";
}

function enhanceStepFour() {
  const steps = [...document.querySelectorAll<HTMLElement>(".requestFastStep")];
  const step = steps.find(item => item.textContent?.includes("КРОК 4"));
  if (!step) return;

  const bookingGrid = step.querySelector<HTMLElement>(".bookingGrid");
  const hiddenMechanic = bookingGrid?.querySelectorAll<HTMLSelectElement>("select")[1];
  if (hiddenMechanic) enforceMechanicRequired(hiddenMechanic);

  for (const small of [...step.querySelectorAll<HTMLElement>("small")]) {
    if (small.textContent?.trim() === "Майстер · необов’язково") small.textContent = "Механік *";
  }

  for (const select of [...step.querySelectorAll<HTMLSelectElement>("select")]) {
    const first = select.options[0];
    if (first?.textContent?.trim() === "Призначити пізніше") first.textContent = "Оберіть механіка";
  }
}

export function MechanicBookingRequiredBridge() {
  useEffect(() => {
    enhanceStepFour();
    const observer = new MutationObserver(enhanceStepFour);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
