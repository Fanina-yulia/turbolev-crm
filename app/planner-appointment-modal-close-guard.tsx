"use client";

import { useEffect } from "react";

const PLANNER_APPOINTMENT_DIALOG = '[role="dialog"][aria-label="Інформація про запис"]';

function closePlannerAppointmentModal() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("appointmentId")) return;

  url.searchParams.delete("appointmentId");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.pushState({}, "", nextUrl);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isCloseControl(button: HTMLButtonElement | null, dialog: Element) {
  if (!button || !dialog.contains(button)) return false;
  const ariaLabel = button.getAttribute("aria-label")?.trim();
  const text = button.textContent?.trim();
  return ariaLabel === "Закрити" || text === "Закрити" || text === "×";
}

export function PlannerAppointmentModalCloseGuard() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      const dialog = document.querySelector(PLANNER_APPOINTMENT_DIALOG);
      if (!dialog) return;

      event.preventDefault();
      event.stopPropagation();
      closePlannerAppointmentModal();
    };

    const onPointerDown = (event: PointerEvent) => {
      const dialog = document.querySelector(PLANNER_APPOINTMENT_DIALOG);
      if (!dialog) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const closeButton = target.closest("button") as HTMLButtonElement | null;
      const backdrop = dialog.parentElement;
      const shouldClose = isCloseControl(closeButton, dialog) || target === backdrop;
      if (!shouldClose) return;

      event.preventDefault();
      event.stopPropagation();
      closePlannerAppointmentModal();
    };

    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  return null;
}
