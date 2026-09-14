"use client";

import { useEffect } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";

const PLANNER_DIALOG = '[role="dialog"][aria-label="Інформація про запис"]';

function closeAppointment() {
  const route = readCrmRoute();
  if (!route.appointmentId) return;
  const { appointmentId: _appointmentId, ...rest } = route;
  navigateCrm("Планувальник", rest);
}

function isPlannerCloseButton(target: EventTarget | null) {
  const button = target instanceof Element ? target.closest('button[aria-label="Закрити"]') : null;
  return Boolean(button?.closest(PLANNER_DIALOG));
}

export function PlannerModalCloseBehavior() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (!document.querySelector(PLANNER_DIALOG)) return;
      closeAppointment();
    };

    const onClick = (event: MouseEvent) => {
      if (!isPlannerCloseButton(event.target)) return;
      queueMicrotask(() => {
        if (readCrmRoute().appointmentId) closeAppointment();
      });
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return null;
}
